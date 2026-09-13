# Marketing Agent

## What this is

A **multi-tenant** marketing agent. An agency (or a solopreneur, who is an agency
with one client) runs it for **any number of client companies** — each with its
own strategy, campaigns, calendar and voice. Nothing here is specific to one
business; a client is data, not code.

> It was first sketched as an internal tool for a single company. It is not that
> any more, and has not been since the multi-tenant model
> (`docs/specs/2026-04-14-multi-tenant-design.md`). If a prompt, comment or doc
> still names one company as *the* company, that is drift — fix it.

**The hierarchy:** `agency → members → clients → (strategy, campaigns, plan runs, slots, research)`

## Goal

For each client, write the content its active campaigns still owe — the theme,
the hook, the beats and the ask — and let a human decide what ships and when.
The agent decides WHAT gets made; the operator decides when it goes out.

---

## Architecture

Next.js 16 (App Router, Turbopack) + Firestore Admin SDK. Everything lives in
`app/`. Read `app/AGENTS.md` before writing code — it is the binding one.

### The loop

```
research    scrape and read a client's market            → a proposed strategy
strategy    ICP, voice, positioning, pillars, quota      ← the source of truth
campaigns   generated, reviewed, accepted                → what the client owes
plan        preview what every active campaign still owes (undated)
            drop what you don't want, regenerate it
            accept the rest                              → slots, date = null
schedule    a human gives each slot a day and time       → the quota warns, never refuses
copy        write / regenerate the copy on a slot
sync        push dated slots to Google Calendar
```

Dating is deliberately **not** part of generation. Generating and scheduling in
one pass is what produced pieces attributed to no campaign; see the planner
header comments and commit `63039e8`.

### Modules (`app/lib/marketing/`)

| Module | Role |
|---|---|
| `research/` | Market research runs → a proposed strategy |
| `strategy.ts` | Read/write the client strategy document |
| `campaigns.ts` | Generate, review, accept, complete campaigns |
| `planner/` | `observe` (what is owed) → `decide` (the idea) → `commit` (slots) |
| `planner/drop.ts`, `replace.ts` | Drop ideas from a preview and regenerate them |
| `planner/schedule.ts` | Weekly load and quota warnings (pure) |
| `slots.ts` | The scheduled pieces, and the human edits to them |
| `copy.ts`, `write-copy.ts` | The copy on a slot |
| `calendar.ts`, `google.ts`, `reconcile.ts` | Google Calendar sync, both directions |
| `export/` | Plan as Markdown / PDF |

### Firestore collections (database `marketing`)

`marketing_agencies` · `marketing_members` · `marketing_clients` ·
`marketing_strategies` · `marketing_campaigns` · `marketing_plan_runs` ·
`marketing_slots` · `marketing_research_runs` · `marketing_google_credentials`

The `(default)` database belongs to numerico-website and is read-only here.

### API

Everything client-scoped lives under `/api/v1/clients/{clientId}/…` —
`strategy`, `research`, `campaigns`, `plan/preview`, `plan/runs/{runId}/…`
(`drop`, `restore`, `replace`, `commit`), `slots/{slotId}/…` (`schedule`,
`copy`, `regenerate`), `calendar/sync`. Auth is `/api/v1/auth/*`, Google OAuth
is `/api/v1/google/*`.

### Folders

```
app/app/api/v1/     REST endpoints
app/app/clients/    the UI, one page per stage of the loop
app/lib/marketing/  business logic
app/lib/            firestore, types, api client, auth
app/prompts/        prompt templates as JSON
docs/specs/         design specs, newest wins
```

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

- **`app/AGENTS.md` is binding.** Read it, and the Next.js docs it points at,
  before writing code.
- **A client is data.** Never hard-code one company's name, voice or market into
  a prompt, a default or a test fixture. Everything reads from that client's
  strategy document.
- The strategy document is the source of truth — campaigns, plans and copy all
  read from it.
- Campaigns are the demand. The planner proposes only what an accepted campaign
  still owes; with no accepted campaign there is nothing to plan.
- Generation never dates anything. A human schedules.
- **Nothing is mocked in the tests.** Only pure functions are tested; anything
  that calls a model or Firestore takes an injected seam.
- Degrade, never fail: a bad model response yields a warning and a usable
  skeleton, not an exception.
- First drafts are starting points — the drop/regenerate cycle exists for that.
