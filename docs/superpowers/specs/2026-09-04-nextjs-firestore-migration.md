# Next.js + Firestore Migration — Data Model Spec

## Context

The marketing agent is a FastAPI + Postgres prototype. It is **not running in
production and has no data worth preserving**. Everything else in `numerico/`
is Next.js, so the agent moves onto the same stack.

Decisions already made:

| Decision | Choice |
|---|---|
| Runtime | Next.js on **Vercel** |
| Datastore | **Firestore** (Postgres dropped entirely) |
| Scope | Faithful rebuild of current behaviour, **schema designed for the agent loop** |
| Repo | Backend absorbed into the existing `frontend/` Next app |

Because there is no live data, this is a **rewrite, not a migration**. Nothing
is backfilled. The 10 Alembic migrations and `app/db/` are deleted outright.

House conventions this follows (from `numerico-website`):

- `lib/firebase-admin.ts` exposes `adminDb`; `lib/firestore.ts` wraps it in a
  `db()` accessor that throws on misconfig rather than silently no-opping
- `COLLECTIONS` const is the single source of truth for collection names
- **camelCase in Firestore, snake_case in API responses**, via `serializeX()`
  helpers and a `toISO()` Timestamp converter
- Hand-rolled `parseXInput(body): {data} | {error}` validation — no zod
- Server-only data access lives in `lib/<domain>.ts`, never imported by a
  client component

Because the API already returns snake_case and the serialize layer preserves
that, **`frontend/lib/types.ts` survives the rewrite nearly intact.**

---

## The constraint that drives the design

Firestore caps a document at **1 MiB**. Two things in the current design break
that immediately:

1. `post_production.py:56` assigns base64 data URIs into
   `asset["generated_images"]`. A 1024x1024 PNG is ~1.4 MB base64.
2. `log_run.py:28` writes the entire pipeline context — images included — into
   `runs.output`. Up to 2 images x ~5 assets means 10+ MB in one record.

Postgres JSONB swallowed this. Firestore rejects it on the first run.

**Resolution:** images go to Firebase Storage; documents hold URLs. This is the
GCS work already provisioned (`google-cloud-storage` in `requirements.txt`,
`GCS_BUCKET` in `.env`) but never wired up — no code referenced it.

**Second resolution:** assets become first-class documents. Today they exist
twice — inside `run.output.post_production.produced_assets` *and* in the
`assets` table, persisted only when an admin clicks Schedule. That duplication
goes away: the pipeline writes asset documents directly and the run references
them.

---

## Collection structure

Subcollections under `clients`, because every route is already client-scoped
(`/api/v1/clients/{client_id}/...`). Cross-client queries — needed for the
agent loop's multi-client orchestration — use **collection group queries**.

```
agencies/{agencyId}
  ├── taskConfigs/{taskType}          # doc id IS the task type
  └── (fields: name, googleRefreshToken, googleConnectedEmail, ...)

users/{uid}                            # top-level: keyed by Firebase Auth uid

clients/{clientId}
  ├── config/strategy                  # fixed doc ids in a `config` subcollection
  ├── config/research
  ├── config/branding
  ├── campaigns/{campaignId}
  ├── runs/{runId}
  │     └── steps/{stepKey}            # raw step output, debugging only
  ├── assets/{assetId}
  ├── feedback/{feedbackId}
  └── memorySummaries/{summaryId}
```

### Why `config/*` is a subcollection, not fields on the client doc

`strategy`, `research`, and `branding` were large JSONB columns. Perplexity
research in particular can be sizable. Keeping them off the client document
means listing clients stays cheap and the client doc stays far from 1 MiB.

### Why `taskConfigs` is keyed by task type

The Postgres model had `task_configs.task_type` as globally `unique=True`
despite being agency-scoped (`models.py:110`) — two agencies could not both
have a "daily" task. Using the task type as the document id under
`agencies/{id}/taskConfigs/` scopes it per agency and **fixes that bug for
free**.

### Why `users` is top-level

Firebase Auth issues a uid at sign-in and we need to look up the user before
knowing their agency. Top-level `users/{uid}` with an `agencyId` field makes
that a single get.

---

## Document shapes

Fields are camelCase as stored. `serverTimestamp()` for all timestamps.

### `agencies/{agencyId}`

| Field | Type | Notes |
|---|---|---|
| name | string | |
| googleRefreshToken | string \| null | Calendar + OAuth |
| googleConnectedEmail | string \| null | |
| createdAt | Timestamp | |

### `users/{uid}`

| Field | Type | Notes |
|---|---|---|
| agencyId | string | |
| email | string | |
| name | string | |
| role | string | `admin` |
| createdAt | Timestamp | |

### `clients/{clientId}`

| Field | Type | Notes |
|---|---|---|
| agencyId | string | indexed — scopes every list query |
| name | string | |
| websiteUrl, logoUrl, description | string \| null | |
| contactEmail, contactPhone | string \| null | |
| status | string | `active` \| `paused` \| `archived` |
| researchStatus | string \| null | research lives in `config/research` |
| googleCalendarId | string \| null | |
| **counters** | map | denormalized, see below |
| createdAt, updatedAt | Timestamp | |

`counters` is the agent-ready addition — `{ assetsThisWeek, scheduledAhead,
lastRunAt, avgRatingRecent }`. Firestore supports `count()` aggregation, but
the agent loop reads these on every observation pass for every client;
denormalized counters make that one read instead of a fan-out.

### `clients/{clientId}/config/strategy`

Same shape as the Postgres `strategy` row minus the id/client_id plumbing:
`businessName`, `icp`, `voice`, `positioning`, `messaging`, `goals`,
`contentQuota`, `updatedAt`. All nested maps — a **better** fit than JSONB.

### `clients/{clientId}/runs/{runId}`

| Field | Type | Notes |
|---|---|---|
| taskType | string | |
| campaignId | string \| null | |
| status | string | `running` \| `completed` \| `failed` |
| planning | map | topic, angle, tone, reasoning — the UI reads this |
| reviewNotes | array | |
| assetIds | array\<string\> | refs into `clients/{id}/assets` |
| debrief | map \| null | |
| slackMessageTs | string \| null | |
| error | string \| null | |
| **observation** | map \| null | agent-ready: state snapshot the run acted on |
| **decision** | map \| null | agent-ready: `{action, reasoning, target}` |
| createdAt, completedAt | Timestamp | |

`observation` and `decision` stay null in the faithful rebuild. They are
populated when the decision engine from `docs/roadmap/agent-loop.md` lands, so
Phase 2 needs no schema change.

**Inline what the UI reads; subcollection what only the pipeline reads.** The
full `contextSnapshot` (strategy + 14 runs of history + feedback + campaigns)
is debugging material, so it goes to `runs/{runId}/steps/contextBuild` rather
than bloating the run document.

### `clients/{clientId}/runs/{runId}/steps/{stepKey}`

`{ output: map, success: bool, error: string|null, startedAt, completedAt }`.
One document per pipeline step, keyed by step key (`contextBuild`, `planning`,
`generation`, ...). Gives per-step timing and failure isolation for free, which
the current single `run.output` blob does not.

### `clients/{clientId}/assets/{assetId}`

| Field | Type | Notes |
|---|---|---|
| runId, campaignId | string \| null | |
| type, format | string | |
| content | map \| array | text, or carousel slides |
| rationale | map | whyThisPost, whyThisFormat, ... |
| **imageUrls** | array\<string\> | **Storage URLs, never base64** |
| status | string | `draft` \| `scheduled` \| `posted` |
| rating | number \| null | |
| scheduledFor, suggestedScheduledFor, postedAt | Timestamp \| null | |
| googleEventId | string \| null | |
| createdAt | Timestamp | |

### `clients/{clientId}/campaigns/{campaignId}`

`title`, `description`, `status`, `strategy` (map), `contentPlan` (map),
`feedbackHistory` (array), `rejectionReason`, `startDate`, `endDate`,
timestamps. Unchanged in substance.

### `clients/{clientId}/feedback/{feedbackId}`

`runId`, `assetId` (replaces the positional `asset_index` — a real improvement,
since indexes broke when asset order changed), `rating`, `comment`, `createdAt`.

### `clients/{clientId}/memorySummaries/{summaryId}`

`periodStart`, `periodEnd`, `summary`, `insights` (map), `createdAt`.

---

## Firebase Storage layout

```
clients/{clientId}/runs/{runId}/{assetId}-{n}.png
```

`post_production` uploads each generated image and stores the download URL on
the asset document. The Slack delivery step, which currently decodes data URIs
(`deliver_slack.py:_decode_data_uri`), fetches from Storage instead.

---

## Required composite indexes

Single-field indexes are automatic. These are not:

| Collection | Fields | Serves |
|---|---|---|
| `clients` | agencyId + status + name | client list, filtered |
| `runs` (group) | taskType + status + createdAt desc | run list filters |
| `assets` (group) | status + scheduledFor asc | calendar view, gap detection |
| `assets` (group) | campaignId + createdAt desc | campaign progress |
| `feedback` (group) | createdAt desc | recent-feedback context |

Collection group indexes are what let the agent loop ask "across all clients,
what is scheduled this week" in one query.

---

## What this does not solve

**The pipeline still needs a job runner.** A run chains 5 LLM calls (review
retries up to 3x) plus image generation at a 120s timeout each — minutes, not
seconds. FastAPI parked this in `BackgroundTasks` inside a long-lived container
(`runs.py:71`); Vercel's serverless functions cannot.

The good news is the pipeline is already decomposed into 8 discrete registered
steps threading a context object, which maps onto a durable step runner almost
one-for-one. That design is deferred to its own spec.

---

## Open questions

1. **Auth.** `auth.py:28` hardcodes `DEFAULT_AGENCY_ID`; the data model is
   multi-tenant but the runtime serves one agency. Does the rewrite adopt real
   Firebase Auth sessions (as `reminders-app` does across 21 files), or keep
   the single-agency shortcut?
2. **Firestore security rules.** All access is currently server-side via the
   Admin SDK, which bypasses rules. If the client ever reads Firestore
   directly, rules need writing.
3. **Cost.** The agent loop's observation pass reads across clients on every
   tick. The denormalized `counters` map is the mitigation; worth measuring.
