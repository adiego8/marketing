# Handy Set Go — Autonomous Marketing Agent

## Project Overview

Build an internal autonomous marketing agent for **Handy Set Go** that acts as a virtual CMO — generating daily content, campaign ideas, and strategic recommendations. This is NOT a product for others; it is an internal execution engine focused on awareness, leads, and positioning.

## Goal

A system that runs daily, makes good marketing decisions autonomously, and delivers actionable outputs — posts, hooks, CTAs, campaign ideas, and recommended actions.

---

## Architecture

### Daily Autonomous Loop

1. Load strategy and past context
2. Decide daily marketing priorities
3. Generate content (post, hooks, CTA)
4. Review quality
5. Store outputs
6. Deliver daily brief
7. Capture feedback

### System Components

| Component | Role |
|---|---|
| **Scheduler** | Triggers daily run |
| **Planning Engine** | Decides what to do today based on strategy + context |
| **Content Generator** | Creates marketing assets |
| **Review Engine** | Quality control gate |
| **Persistence Layer** | Database (strategy, runs, assets, campaigns, feedback) |
| **Delivery Layer** | Dashboard or daily brief output |

### Daily Outputs

- 1 main post
- 2 hook variations
- 1 CTA
- 1 campaign idea
- 1 recommended action

### Core Modules

- **Strategy Module** — ICP, messaging, positioning
- **Memory Module** — History, feedback, past performance
- **Daily Run Service** — Orchestration of the full loop
- **Planning Engine** — Priority decisions
- **Content Generator** — Asset creation
- **Review Engine** — Quality gates
- **Feedback Module** — Captures human input to improve over time

### API Endpoints

- `POST /api/v1/runs/daily` — Trigger a daily run
- `GET /api/v1/runs` — List past runs
- `GET /api/v1/assets` — List generated assets
- `PATCH /api/v1/assets/{id}` — Update an asset
- `POST /api/v1/feedback` — Submit feedback on outputs
- `GET /api/v1/strategy` — Read current strategy
- `PUT /api/v1/strategy` — Update strategy

### Database Tables

- `strategy` — ICP, voice, positioning, messaging
- `daily_runs` — Log of each autonomous run
- `assets` — Generated content (posts, hooks, CTAs, etc.)
- `campaigns` — Campaign ideas and status
- `feedback` — Human feedback on outputs

### Folder Structure

```
app/
  api/          # REST endpoints
  services/     # Business logic (planning, generation, review)
  db/           # Database models and migrations
  prompts/      # Prompt templates and skill files
  workers/      # Scheduler and background jobs
tests/          # Test suite
```

### Build Phases

- **Phase 1:** Core generation + strategy loading
- **Phase 2:** Review engine + storage + UI/brief delivery
- **Phase 3:** Feedback loop + full daily automation

---

## Marketing Methodology (Vibe Marketing Framework)

The agent's decision-making and content generation should follow these principles and frameworks.

### Core Philosophy

- **Research over prompts** — Deep context produces exceptional output
- **Methodology over instructions** — Use proven marketing frameworks, not raw prompts
- **Process over shortcuts** — Right sequence matters: Research → Foundation → Structure → Assets → Iteration
- **Confidently boring** — Skip hype, build compounding systems
- **Human taste is the differentiator** — AI generates options, humans pick winners

### The Three Layers

1. **Research Layer** — Real-time information access (market data, competitors, customer language)
2. **Methodology Layer** — Marketing frameworks loaded as skills (Schwartz, Hopkins, Ogilvy, Halbert)
3. **Process Layer** — Correct sequencing of operations

### 5-Stage Build Sequence

1. **Research** — Market landscape, competitor analysis, customer language, validation
2. **Foundation** — Brand voice extraction, positioning angles, anti-positioning
3. **Structure** — Keyword opportunities, content pillars, quick wins
4. **Assets** — Landing pages, emails, lead magnets, social content
5. **Iteration** — Rejection cycles, voice enforcement, quality gates

### 8 Positioning Angle Types

1. **The Contrarian** — Challenge what everyone believes
2. **The Unique Mechanism** — Lead with HOW, not WHAT
3. **The Transformation** — Before and after, the gap closed
4. **The Enemy** — Position against a common villain
5. **The Speed/Ease** — Compress time or reduce effort
6. **The Specificity** — Hyper-specific about who and what
7. **The Social Proof** — Lead with evidence, not claims
8. **The Risk Reversal** — Make the guarantee the headline

### Email Welcome Sequence Framework

```
DELIVER (Day 0) → CONNECT (Day 2) → VALUE (Day 4) → VALUE (Day 6) → BRIDGE (Day 9) → SOFT PITCH (Day 11) → DIRECT PITCH (Day 14)
```

### Content Atomizer Pattern

One core piece becomes 15+ assets:
- LinkedIn: long-form post, carousel, poll
- Twitter/X: thread, single tweet, quote angle
- Instagram: carousel, Reel script, story series
- Email: newsletter section, nurture content
- Video: YouTube script, Shorts script, podcast points

### Skill Stacks (Chained Workflows)

| Stack | Skills Chain | Output |
|---|---|---|
| **Foundation** | Research → Brand Voice → Positioning Angles | Voice profile, 3-5 angles, differentiation |
| **Conversion** | Direct Response Copy → Frontend Design → Lead Magnet | Landing page, design, opt-in offer |
| **Traffic** | Keyword Research → SEO Content → Content Atomizer | Keyword strategy, content, 15+ social assets |
| **Nurture** | Email Sequences → Newsletter → Content Atomizer | Welcome series, newsletter, social presence |

### Quality Control: Expert Review Framework

When reviewing generated content, use task-based expert agents:
- Spin up 3-5 specialized perspectives (e.g., Growth Expert, SEO Specialist, Conversion Expert)
- Each analyzes independently from their domain
- Where they agree = signal; disagreements = areas to investigate
- Checkpoint after copy (before design), after design (before launch), after strategy (before execution)

### Brand Voice Guidelines (Template)

When generating content, always check against:
- **Words to USE:** specific, direct, practical, results-oriented language
- **Words to AVOID:** "revolutionary," "game-changing," "crushing it," "leverage," "synergy," "unlock your potential"
- Remove AI tells: "delve," "landscape," "paradigm," "tapestry"
- Would you actually send this to a client? If not, reject and regenerate.

### SEO Principles

- Research first — find gaps vs competitors, not crowded keywords
- Look for programmatic opportunities (scalable patterns)
- Quality over quantity — 1 excellent piece > 5 mediocre ones
- Human checkpoint before publishing (fact-check, add expertise, verify claims)
- Don't publish all at once — velocity signals matter

### Traffic Flywheel

```
CREATE (core content) → ATOMIZE (15+ pieces) → VISUALIZE (graphics/video) → DISTRIBUTE (organic + paid + email) → CAPTURE (lead magnets) → CONVERT (direct response) → LEARN (what worked) → REPEAT
```

---

## Decision Framework

When the agent (or operator) must choose between options:

| Method | When to Use | How |
|---|---|---|
| **Specialized Agents** | Too many options from research | 3-5 expert perspectives, find overlap |
| **Constraint Filter** | Too many options pass initial filter | Impact vs effort, speed to value, resources, risk |
| **Market Validation** | Positioning or messaging decisions | What competitors do, what works, where gaps are |
| **Recommendation Request** | Overwhelmed by options | Ask AI to synthesize with reasoning + trade-offs |
| **Future Self Check** | Long-term strategic decisions | Project 12-month outcomes for each option, compare |

---

## Key Insight

> The value is not automation alone, but making good daily marketing decisions. Start simple, iterate fast, and evolve toward autonomy.

---

## Development Guidelines

- Start with Phase 1 (core generation + strategy) before adding complexity
- Every generated asset must pass through the Review Engine before delivery
- The Strategy Module is the source of truth — all content generation reads from it
- Feedback captured today improves tomorrow's output
- Save all research and context as `.md` files for the agent to reference
- First drafts are starting points — build in rejection/iteration cycles
