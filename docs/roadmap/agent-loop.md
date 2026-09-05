# Agent Loop — Future Roadmap

## Current State: Pipeline

The system runs a fixed pipeline when triggered (manually or via cron):

```
Trigger → Context Build → Planning → Generation → Review → Post Production → Schedule Suggest → Log → Deliver → STOP
```

It produces output and stops. It doesn't observe the results of its own actions or decide what to do next. The pipeline always does the same thing: generate a batch of daily content.

## Target State: Autonomous Agent Loop

```
LOOP (daily or continuous):

  1. OBSERVE
     - What's on the calendar this week? Any gaps?
     - What feedback came in since last run?
     - Which campaigns are behind on their content plan?
     - What performed well / poorly (ratings, engagement)?
     - Are there time-sensitive opportunities (trends, events)?
     - What's the content quota status (weekly targets vs actual)?

  2. REASON
     - "Campaign X needs 2 more posts this week, only 1 is scheduled"
     - "Last 3 posts got low ratings — I should adjust tone"
     - "Client has no content scheduled for Thursday — gap"
     - "Feedback says hooks are too generic — be more specific"
     - "Weekly quota is 3 posts but only 1 produced so far"

  3. DECIDE (the key differentiator from a pipeline)
     - Evaluate all possible actions and pick the highest priority:
       a) Generate content for a campaign that's behind
       b) Revise an asset that got bad feedback
       c) Fill a calendar gap
       d) Propose a new campaign idea
       e) Adjust strategy based on accumulated feedback
       f) Do nothing — everything is on track

  4. ACT
     - Execute the chosen action (generate, revise, schedule, propose)
     - May chain multiple actions in one loop iteration

  5. REFLECT
     - Did it work? Log what happened and why.
     - Update memory summaries with learnings.
     - Store what to do differently next time.

  → BACK TO 1
```

## What Makes It an Agent (vs a Pipeline)

| Pipeline (current) | Agent (target) |
|---|---|
| Fixed sequence of steps | Dynamic action selection |
| Always generates content | Sometimes generates, sometimes revises, sometimes does nothing |
| Triggered externally | Self-directed (decides when and what to do) |
| Same behavior every run | Adapts based on feedback and outcomes |
| No memory across runs (beyond context window) | Accumulates knowledge and changes strategy |
| Human decides what to prioritize | Agent reasons about priorities |

## Implementation Phases

### Phase 1: Observation Layer
- Build a "state of the world" snapshot that the agent reads on each loop:
  - Calendar coverage (gaps per day/week)
  - Campaign progress (planned vs produced per campaign)
  - Content quota status (weekly targets vs actual)
  - Recent feedback summary (avg rating, common themes)
  - Unscheduled assets backlog
  - Days since last run per client

### Phase 2: Decision Engine
- Replace the fixed "planning" step with a reasoning step:
  - Input: the observation snapshot
  - Output: a ranked list of actions with reasoning
  - LLM prompt: "Given this state, what's the single highest-impact thing to do right now?"
- Action types: generate, revise, schedule, propose_campaign, adjust_strategy, skip

### Phase 3: Action Execution
- Map each action type to existing pipeline steps (most already exist):
  - `generate` → existing generation pipeline
  - `revise` → new step: takes an existing asset + feedback, produces improved version
  - `schedule` → existing schedule flow
  - `propose_campaign` → existing campaign generation
  - `adjust_strategy` → new step: proposes strategy changes based on feedback patterns
  - `skip` → log that nothing was needed, update memory

### Phase 4: Reflection & Memory
- After each action, run a reflection step:
  - What did I do and why?
  - What was the outcome?
  - What would I do differently?
- Feed reflections into memory summaries (weekly)
- Memory influences future decisions (not just context — actual behavioral change)

### Phase 5: Multi-Client Orchestration
- Agent manages multiple clients in priority order
- Decides which client needs attention most (behind on quota, recent bad feedback, approaching campaign deadline)
- Balances time across clients based on urgency

### Phase 6: Continuous Loop
- Move from daily cron to continuous monitoring
- Event-driven triggers: new feedback → re-evaluate, campaign deadline approaching → prioritize
- Rate limiting to avoid over-generation (respect quotas, human review capacity)

---

## Mapping to Current System

How each phase aligns with what's already built, what's missing, and where the code lives.

### Phase 1: Observation Layer — ~70% built

**Have:**
- `app/services/pipeline/steps/context_build.py` — loads strategy, recent 14 runs, feedback, memory summaries, active campaigns with asset counts
- Content quota on Strategy model (`strategy.content_quota` — weekly targets per type)
- Campaign content plans with breakdown (planned vs produced) on `campaign.content_plan`
- Calendar data on Asset model (`scheduled_for`, `suggested_scheduled_for`, `posted_at`)
- Feedback collection (`feedback` table — ratings + comments per asset per run)

**Missing:**
- Unified "state snapshot" function that aggregates into a decision-ready summary. `context_build.py` is optimized for feeding generation prompts, not reasoning about priorities
- Calendar gap detection — query which days in the next 7-14 days have no scheduled content
- Quota tracking — count assets produced this week vs `content_quota.weekly` targets
- Trend/opportunity detection (external signals)

**Estimated work:** Add a `build_observation_snapshot()` function to `context_build.py` or a new `observe.py` step that returns a structured summary: quota status, calendar gaps, campaigns behind, feedback trends, unscheduled backlog count.

### Phase 2: Decision Engine — ~20% built

**Have:**
- `app/services/pipeline/steps/planning.py` — LLM decides topic, angle, tone based on context
- Planning reads strategy + recent history to avoid repetition

**Missing:**
- Planning always chooses to **generate**. Never "revise", "schedule backlog", "propose campaign", "adjust strategy", or "skip"
- A meta-reasoning layer that receives the observation snapshot and outputs an action TYPE + reasoning before any pipeline runs
- Priority weighting (urgent campaign deadline > routine daily post > nice-to-have campaign idea)

**Estimated work:** New pipeline step `decide.py` that runs BEFORE planning. Input: observation snapshot. Output: `{action: "generate|revise|schedule|propose_campaign|adjust_strategy|skip", reasoning: "...", target: {campaign_id?, asset_id?}}`. The existing pipeline steps become actions the decision engine dispatches to.

### Phase 3: Action Execution — ~60% built

| Action | Status | Code Location |
|---|---|---|
| Generate content | Built | Full pipeline: `planning.py` → `generation.py` → `review.py` → `post_production.py` |
| Schedule asset | Built | `app/api/routes/schedule.py` + `app/services/google_calendar.py` |
| Suggest schedule | Built | `app/services/pipeline/steps/schedule_suggest.py` |
| Propose campaign | Built | `app/services/campaign_service.py` → `generate_campaign_ideas()` |
| Revise asset | **Not built** | Would take an existing asset + feedback, produce improved version |
| Adjust strategy | **Not built** | Would propose strategy changes based on feedback patterns |
| Skip (do nothing) | **Not built** | Log that nothing was needed, update memory |

**Estimated work:** `revise` is the most valuable missing action — new pipeline step that loads an asset + its feedback, calls LLM to produce an improved version. `adjust_strategy` and `skip` are simpler (LLM call + DB update, and a no-op log respectively).

### Phase 4: Reflection & Memory — ~40% built

**Have:**
- Debrief system on Run model (`run.debrief` — what_i_did, what_i_learned, things_to_improve, what_id_do_differently). Triggered manually via `POST /clients/{id}/feedback/{run_id}/debrief`
- Memory summaries model (`memory_summaries` table — period, summary, insights). Endpoint exists at `app/api/routes/memory.py`
- Feedback loop — ratings + comments from `feedback` table loaded into context for next run via `context_build.py`

**Missing:**
- Auto-debrief: run debrief automatically after every pipeline execution instead of waiting for manual trigger
- Auto-memory: generate weekly memory summaries on a schedule (the model + endpoint exist but nothing triggers it)
- Behavioral change — debriefs and memory are stored and loaded into context, but the planning step doesn't explicitly weight them or change approach based on patterns. A "I keep getting 2-star ratings on hooks — I should change my hook strategy" feedback loop doesn't exist

**Estimated work:** Auto-debrief is easy — add `debrief` as a pipeline step after `log_run`. Auto-memory needs a weekly cron job. Behavioral change requires richer prompts in planning that explicitly reference past debriefs and ask "what should I do differently this time?"

### Phase 5: Multi-Client Orchestration — ~30% built

**Have:**
- Multi-tenant data model: Agency → Client with all data scoped per client (`app/db/models.py`)
- Per-client strategy, campaigns, runs, assets, feedback, memory
- Task configs at agency level (`task_configs` table with `agency_id`)

**Missing:**
- Cross-client prioritization — "Client A has a campaign deadline tomorrow, Client B is on track" → work on Client A first
- Shared scheduler that iterates over all clients and distributes work
- Agency-level dashboard showing which clients need attention

**Estimated work:** New `orchestrator.py` service that: lists all active clients, builds observation snapshot for each, scores urgency, runs agent loop for the highest-priority client(s). Replaces per-client manual triggers.

### Phase 6: Continuous Loop — ~10% built

**Have:**
- Cron schedule field on TaskConfig (`schedule: "0 8 * * *"`)
- Background task execution via FastAPI `BackgroundTasks`
- `app/db/seed.py` seeds daily task with schedule

**Missing:**
- Actual cron runner — the `schedule` field on TaskConfig is stored but nothing reads it or triggers runs on schedule
- Event-driven triggers — new feedback submitted → re-evaluate priorities; campaign deadline approaching → escalate
- Rate limiting — respect content quotas, don't over-generate, queue for human review
- Health monitoring — detect if agent hasn't run, alert if error rate spikes

**Estimated work:** Cron runner using APScheduler or Celery Beat that reads TaskConfig schedules and triggers runs. Event triggers via DB hooks or simple polling. Rate limiting via quota checks in the decision engine.

---

## Shortest Path to Agent Loop

The minimum change to turn the pipeline into an agent:

1. **Build observation snapshot** — extend `context_build.py` with quota status + calendar gaps + feedback trends (~1 day)
2. **Add decision step** — new `decide.py` step before planning that chooses action type based on observations (~1-2 days)
3. **Auto-debrief** — add debrief as automatic pipeline step (~0.5 day)
4. **Wire decision to existing actions** — route "generate" to current pipeline, "propose_campaign" to campaign service, etc. (~1 day)

Total: ~3-5 days to go from pipeline to basic agent loop. The existing infrastructure handles most of the execution.

---

## Key Principle

> The value is not automation alone, but making good daily marketing decisions. The agent should behave like a junior marketer who checks in every morning, looks at the board, and decides what to work on — not a machine that blindly generates content on a timer.
