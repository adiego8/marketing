# Autonomous Marketing Agent — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Approach:** Monolith Agent (single FastAPI service)

---

## 1. Overview

A single FastAPI service that runs an autonomous daily marketing loop. It loads strategy and memory, decides priorities, generates content (copy + visuals), reviews quality, stores outputs, delivers an interactive brief via Slack, collects human feedback, and generates a self-assessment debrief.

### Core Principles

- **LLM-agnostic** — LiteLLM abstracts the provider. Start with OpenAI, swap anytime via config.
- **Business-agnostic** — Business context (ICP, voice, positioning) is configuration in the `strategy` table, not code.
- **Memory-aware** — Each run builds on past context via structured DB queries + rolling weekly summaries.
- **Human-in-the-loop** — Agent generates, humans rate (1-5), save explicitly, and provide feedback via Slack.
- **Configurable pipelines** — Task types define ordered step arrays. Adding/removing/reordering steps is config, not code.

---

## 2. Tech Stack

| Component | Choice | Why |
|---|---|---|
| Runtime | Python 3.12 + FastAPI | Best AI/agent ecosystem, async, clean API layer |
| LLM Abstraction | LiteLLM | OpenAI-compatible interface for any provider |
| LLM (start) | OpenAI (GPT-4o for text + image generation) | Strong quality, image gen built-in |
| Database | Neon (serverless Postgres) | Relational queries for memory/learning, serverless scaling |
| File Storage | Google Cloud Storage (GCS) | Generated images/assets, only for explicitly saved items |
| Hosting | Google Cloud Run | Containerized, scales to zero, already in Google ecosystem |
| Scheduler | Google Cloud Scheduler | Native cron trigger for Cloud Run endpoints |
| Delivery | Slack (Bot API + Block Kit + Interactivity) | Rich messages, buttons, file uploads, webhooks |

---

## 3. Architecture & Data Flow

```
Cloud Scheduler (cron: daily)
        |
        v
   POST /api/v1/runs/tasks/daily
        |
        v
+-------------------------------------+
|        DAILY RUN PIPELINE           |
|                                     |
|  1. Context Build                   |
|     +- Load strategy config         |
|     +- Query last 14 days of runs   |
|     +- Load recent feedback/ratings |
|     +- Load memory summaries        |
|     +- Assemble LLM context         |
|                                     |
|  2. Planning                        |
|     +- LLM decides today's focus    |
|     +- Topic, angle, tone, campaign |
|     +- Checks against recent runs   |
|     +- Output: daily plan (JSON)    |
|                                     |
|  3. Content Generation              |
|     +- LLM generates copy:          |
|        1 post, 2 hooks, 1 CTA,     |
|        1 campaign idea, 1 action    |
|     +- Output: structured JSON      |
|                                     |
|  4. Review                          |
|     +- Separate LLM call            |
|     +- Checks: voice consistency,   |
|        AI tells, repetition,        |
|        quality, CTA clarity         |
|     +- Fail -> regenerate (max 2x)  |
|     +- Output: approved content     |
|                                     |
|  5. Post Production                 |
|     +- Decides format per asset:    |
|        carousel, single image,      |
|        reel, story, static graphic  |
|     +- Generates visuals (GPT-4o)   |
|     +- Writes creative brief:       |
|        WHY this post, WHY this      |
|        format, target moment,       |
|        expected outcome             |
|     +- Output: post-ready assets    |
|        + rationale                  |
|                                     |
|  6. Log Run                         |
|     +- Write to runs table          |
|                                     |
|  7. Deliver to Slack                |
|     +- Block Kit interactive brief  |
|     +- Per-asset: preview, rating   |
|        (1-5), save, feedback input  |
|     +- "Close & Debrief" button     |
+-------------------------------------+
        |
        v
   Human rates, saves, comments (async via Slack)
        |
        v
   Slack webhook -> POST /api/v1/feedback
        |
        v
   Human clicks "Close & Debrief"
        |
        v
+-------------------------------------+
|  8. Daily Debrief                   |
|     +- Collects all ratings +       |
|        comments from this run       |
|     +- LLM generates summary:      |
|        - WHAT I DID                 |
|        - WHAT I LEARNED             |
|        - THINGS TO IMPROVE          |
|        - WHAT I'D DO DIFFERENTLY    |
|     +- Posts to Slack               |
|     +- Saves to run record          |
|     +- Feeds weekly memory summary  |
+-------------------------------------+
```

### Pipeline Configuration

Pipelines are defined as ordered step arrays in the `task_configs` table. The run engine iterates steps, executes each handler, and passes output forward.

```json
{
  "task_type": "daily",
  "pipeline": [
    { "step": "context_build", "config": { "lookback_days": 14 } },
    { "step": "planning", "config": { "prompt": "planning_daily" } },
    { "step": "generation", "config": { "prompt": "generation_daily" } },
    { "step": "review", "config": { "prompt": "review_daily", "max_retries": 2 } },
    { "step": "post_production", "config": { "prompt": "post_production_daily", "image_variants": 2 } },
    { "step": "log_run", "config": {} },
    { "step": "deliver_slack", "config": { "channel": "marketing-agent" } }
  ]
}
```

The debrief step is triggered separately via Slack button, not part of the main pipeline array.

Adding a new task type (e.g., `study`, `theextramile`) means:
1. Write step handlers for any new steps
2. Insert a `task_configs` row with the pipeline definition
3. Optionally add a Cloud Scheduler trigger

---

## 4. Database Schema (Neon Postgres)

### `strategy`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| business_name | varchar | |
| icp | jsonb | Ideal customer profile |
| voice | jsonb | Brand voice profile (traits, vocabulary, do/don't) |
| positioning | jsonb | Active positioning angles |
| messaging | jsonb | Key messages, value props |
| goals | jsonb | Current marketing goals |
| created_at | timestamp | |
| updated_at | timestamp | |

Single-row config for the active business context. Could become multi-row if the agent serves multiple businesses later.

### `task_configs`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| task_type | varchar UNIQUE | e.g., "daily", "study", "theextramile" |
| name | varchar | Human-readable name |
| description | text | What this task does |
| pipeline | jsonb | Ordered array of step definitions |
| schedule | varchar | Cron expression (or null for manual-only) |
| active | boolean | Whether scheduler should trigger this |

### `runs`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| task_type | varchar | FK concept to task_configs.task_type |
| status | varchar | running, completed, failed |
| context_snapshot | jsonb | What was loaded for this run |
| output | jsonb | Full generated output (all assets, rationale) |
| debrief | jsonb | Debrief summary (filled after human triggers it) |
| created_at | timestamp | |
| completed_at | timestamp | |

### `feedback`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK -> runs | |
| asset_index | int | Index of the asset within run output |
| rating | int | 1-5 scale |
| comment | text | Optional feedback text |
| created_at | timestamp | |

Every rating and comment is recorded. This is the primary learning signal.

### `assets`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK -> runs | Which run produced this |
| type | varchar | post, hook, cta, campaign_idea, action |
| content | jsonb | Copy, image URLs, rationale, format |
| rating | int | Rating at time of save (1-5) |
| saved_at | timestamp | |

Only populated when a human explicitly clicks Save. This is the curated library of approved content.

### `memory_summaries`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| period_start | date | |
| period_end | date | |
| summary | text | LLM-generated summary of the period |
| insights | jsonb | Structured learnings (what worked, what didn't, patterns) |
| created_at | timestamp | |

Generated weekly. Synthesizes daily debriefs into patterns and learnings.

---

## 5. API Design

### Run Execution

```
POST   /api/v1/runs/tasks/{task_type}
       Triggers a run for the given task type.
       Returns: { run_id, status }
       Called by Cloud Scheduler or manually.

GET    /api/v1/runs
       List past runs. Filterable by task_type, date range.
       Paginated.

GET    /api/v1/runs/{run_id}
       Full run detail: context snapshot, output, feedback, debrief.
```

### Task Configuration

```
GET    /api/v1/tasks
       List all task types and their configs.

GET    /api/v1/tasks/{task_type}
       Get specific task config (pipeline, schedule, active).

PUT    /api/v1/tasks/{task_type}
       Update task config (pipeline steps, schedule, toggle active).

POST   /api/v1/tasks
       Register a new task type.
```

### Strategy

```
GET    /api/v1/strategy
       Current strategy (voice, ICP, positioning, goals).

PUT    /api/v1/strategy
       Update strategy.
```

### Feedback (Slack webhook target)

```
POST   /api/v1/feedback
       Submit rating (1-5) + optional comment for an asset.
       Links to run_id + asset_index.
       Save is explicit — rating alone does not persist to assets.

POST   /api/v1/feedback/{run_id}/debrief
       Triggered by "Close & Debrief" Slack button.
       Collects all feedback for this run, generates debrief summary,
       posts to Slack, saves to run record.
```

### Assets (only human-saved content)

```
GET    /api/v1/assets
       List saved assets. Filterable by type, rating, date.

GET    /api/v1/assets/{id}
       Single asset detail.

DELETE /api/v1/assets/{id}
       Remove a saved asset.
```

### Memory

```
GET    /api/v1/memory/summaries
       List memory summaries by period.

POST   /api/v1/memory/summaries
       Trigger manual summary generation for a period.
```

---

## 6. Slack Interaction Design

### Daily Brief Message

Each run delivers a Block Kit message to the configured Slack channel. Structure:

```
+---------------------------------------------+
|  Daily Marketing Run — Apr 4, 2026          |
|  Focus: [topic] | Angle: [contrarian]       |
|---------------------------------------------|
|                                             |
|  POST 1 — Instagram Carousel               |
|  [Generated image previews]                |
|                                             |
|  Copy: "Your post content..."              |
|                                             |
|  WHY THIS POST                              |
|  "Targets the pain point of [X] using a    |
|  contrarian angle. Based on last week's     |
|  feedback, direct language scored 4.2 avg.  |
|  Carousel chosen for higher save rates on   |
|  educational content."                      |
|                                             |
|  Expected outcome: Saves + shares           |
|                                             |
|  [1] [2] [3] [4] [5]   [Save]             |
|  [Add feedback...]                          |
|---------------------------------------------|
|                                             |
|  HOOK A                                     |
|  "First hook variation..."                  |
|  [1] [2] [3] [4] [5]   [Save]             |
|  [Add feedback...]                          |
|---------------------------------------------|
|  ... (HOOK B, CTA, CAMPAIGN IDEA, ACTION)  |
|  (same pattern per asset)                   |
|---------------------------------------------|
|                                             |
|  [Overall feedback...]                      |
|  [Close & Debrief]                          |
|                                             |
+---------------------------------------------+
```

### Interaction Flow

1. Human receives brief in Slack
2. Reviews each asset, rates 1-5, optionally saves and/or comments
3. When done reviewing, clicks "Close & Debrief"
4. Agent generates debrief summary, posts it as a thread reply
5. Debrief saves to the run record and feeds weekly memory

### Slack Infrastructure

- **Bot token** with `chat:write`, `files:write`, `commands` scopes
- **Interactivity webhook** pointing to the FastAPI service
- **Block Kit** for rich message formatting
- **Modal** for feedback text input (triggered by feedback button)

---

## 7. Pipeline Step Handler Interface

Every pipeline step implements a common interface:

```python
class PipelineStep:
    """Base class for all pipeline steps."""

    async def execute(
        self,
        context: RunContext,     # accumulated state from prior steps
        config: dict,            # step-specific config from task_configs.pipeline
    ) -> StepResult:
        """Execute this step. Returns output to merge into context."""
        raise NotImplementedError
```

`RunContext` is a dict-like object that accumulates output from each step. Step N can read output from steps 1 through N-1.

### Registered Steps (MVP)

| Step Key | Handler | Description |
|---|---|---|
| `context_build` | `ContextBuildStep` | Loads strategy, recent runs, feedback, memory summaries |
| `planning` | `PlanningStep` | LLM decides today's focus, angle, format |
| `generation` | `GenerationStep` | LLM generates copy for all assets |
| `review` | `ReviewStep` | LLM reviews for quality, voice, repetition |
| `post_production` | `PostProductionStep` | Decides formats, generates visuals, writes rationale |
| `log_run` | `LogRunStep` | Persists run to database |
| `deliver_slack` | `DeliverSlackStep` | Formats and posts Block Kit message |

Future steps (e.g., `research`, `analysis`, `competitor_scan`) follow the same interface.

---

## 8. Memory System

### Three Layers

**Layer 1: Structured Memory (Neon Postgres)**
The database tables — `runs`, `feedback`, `assets`, `strategy`. What happened, what was rated, what was saved.

**Layer 2: Context Window (per-run)**
Each run's Context Build step assembles relevant history into the LLM context:
- Current strategy doc
- Last 14 days of runs (outputs + ratings)
- Recent feedback comments
- Latest 4 weekly memory summaries

**Layer 3: Rolling Summaries (weekly)**
Generated weekly from daily debriefs. Synthesizes patterns:
- What content types/angles scored highest
- What feedback themes emerged
- What to do more of, less of
- Trends over time

### Weekly Summary Generation

Triggered automatically (weekly cron) or manually via `POST /api/v1/memory/summaries`.

Input: all daily debriefs + feedback from the period.

Output structure:
```json
{
  "period": "2026-03-28 to 2026-04-04",
  "summary": "Free-text summary of the week...",
  "insights": {
    "top_performing": ["contrarian angles", "carousel format"],
    "low_performing": ["generic CTAs", "lifestyle tone"],
    "feedback_themes": ["more specific examples", "shorter hooks"],
    "recommendations": ["lean into data-driven posts", "test reel format"]
  }
}
```

### Future: Vector Store

The system is designed so Layer 2 (context window) reads from an abstracted memory interface. Swapping from Postgres queries to vector similarity search is a module change, not a rewrite.

---

## 9. Folder Structure

```
marketing-agent/
  app/
    api/
      routes/
        runs.py            # POST /runs/tasks/{type}, GET /runs, GET /runs/{id}
        tasks.py           # CRUD for task_configs
        strategy.py        # GET/PUT strategy
        feedback.py        # POST feedback, POST debrief
        assets.py          # GET/DELETE saved assets
        memory.py          # GET/POST memory summaries
        slack_webhook.py   # Slack interactivity endpoint
      dependencies.py      # Shared deps (db session, auth)
    services/
      runner.py            # Pipeline execution engine
      context_builder.py   # Assembles LLM context from DB
      planner.py           # Planning step
      generator.py         # Content generation step
      reviewer.py          # Review/quality gate step
      post_producer.py     # Post production (format + visuals + rationale)
      debriefer.py         # Debrief generation
      memory_service.py    # Weekly summary generation
      slack_service.py     # Slack message formatting + delivery
      llm_service.py       # LiteLLM wrapper (provider-agnostic)
    db/
      models.py            # SQLAlchemy models
      migrations/          # Alembic migrations
      session.py           # Neon connection setup
    prompts/
      planning_daily.md    # System prompts per step per task type
      generation_daily.md
      review_daily.md
      post_production_daily.md
      debrief.md
    config/
      settings.py          # Env vars, Neon URL, Slack tokens, LLM config
  tests/
    test_runner.py
    test_context_builder.py
    test_planner.py
    test_generator.py
    test_reviewer.py
    test_post_producer.py
    test_slack.py
  Dockerfile
  docker-compose.yml       # Local dev (API + Postgres)
  requirements.txt
  alembic.ini
  .env.example
  README.md
```

---

## 10. Build Phases

### Phase 1: Core Engine + Daily Generation

- Project scaffolding (FastAPI, Neon connection, Docker)
- Database schema + Alembic migrations
- LLM service (LiteLLM wrapper)
- Pipeline runner engine (step interface, sequential execution)
- Context Build step (strategy loader + recent runs query)
- Planning step (LLM decides focus)
- Content Generation step (LLM generates copy)
- Log Run step (persist to DB)
- Strategy CRUD API
- Runs API (trigger + list + detail)
- Seed strategy with initial business config
- Manual trigger via API (no scheduler yet)

**Milestone:** Hit the API, get generated marketing copy saved to DB.

### Phase 2: Review + Post Production + Slack

- Review step (quality gate with retry logic)
- Post Production step (format selection + image generation + rationale)
- Slack Bot setup (token, scopes, channel)
- Slack Block Kit message builder
- Slack delivery step
- Slack interactivity webhook endpoint
- Feedback API (ratings, comments, explicit save)
- Assets API (list/detail/delete saved assets)
- GCS integration for saved image assets

**Milestone:** Daily run delivers interactive brief to Slack, humans can rate/save/comment.

### Phase 3: Feedback Loop + Memory + Automation

- Debrief step (triggered by Slack "Close & Debrief" button)
- Debrief summary generation + Slack thread reply
- Weekly memory summary generation (cron or manual)
- Memory summaries API
- Context Build enhanced with memory summaries
- Task configs CRUD API (register/update task types)
- Google Cloud Scheduler setup (daily cron trigger)
- Cloud Run deployment (Dockerfile, service config)

**Milestone:** Fully autonomous daily loop with learning. Agent improves based on feedback over time.

---

## 11. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monolith vs microservices | Monolith | MVP speed, single deploy, easy debugging |
| Neon vs Firestore | Neon Postgres | Relational queries needed for memory/learning analytics |
| Save behavior | Explicit only | Rating is for learning, saving is for curation |
| Pipeline steps | Separate LLM calls | Fresh perspective per step (planner, generator, reviewer are different "agents") |
| Image generation | GPT-4o | Same API, no extra infra, good text-in-image |
| Debrief trigger | Manual (Slack button) | Human controls when review is done, no arbitrary timers |
| Memory (MVP) | Summarization | Simple, effective, no vector DB infra needed |
| Memory (future) | Vector store | Designed for swap via abstracted memory interface |
