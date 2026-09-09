# Marketing Agent

Writes the content a client's active campaigns still owe — the hook, the beats
and the ask for each piece — and leaves the scheduling to a person. The agent
decides WHAT gets made; you decide when it goes out.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
```

`.env.local` needs, at minimum:

| Var | Where from |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Firebase console → Project settings → General → SDK setup |
| `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | Project settings → Service accounts → Generate new private key |
| `OPENAI_API_KEY` | Campaign generation and slot themes |

The client and Admin values must name the **same** Firebase project. Without the
Admin ones every API route answers `503` naming what is missing, rather than a
misleading `401`.

## Two databases, one project

Firebase Auth is project-scoped, so this app shares the `numerico-app` project
with numerico-website — one account per customer, not two. Its **data** is
separate:

| Handle | Database | Holds |
|---|---|---|
| `adminDb` | `marketing` (`FIREBASE_DATABASE_ID`) | everything this app writes |
| `numericoDb` | `(default)` | `customers` and entitlements, read-only |

Leave `FIREBASE_DATABASE_ID` unset and both collapse onto `(default)`; the
`marketing_*` collection prefixes keep the two apart either way, so a first run
is never blocked on the database existing. `npx tsx scripts/probe.ts` prints the
`databaseId` each handle actually resolved to — the only way to tell a working
split from a silent fallback.

`firebase.json` deliberately lists **only** the `marketing` database, so a
deploy from this repo cannot touch the website's `(default)`. The rules there
deny everything: no browser code reads Firestore (`lib/firebase.ts` initialises
Auth alone), and the Admin SDK bypasses rules, so the strictest ruleset costs
nothing.

```bash
firebase deploy --only firestore:rules
```

## Running

```bash
npm run dev        # localhost:3008
npm run seed       # after signing in once — creates a client with a quota
```

The first person to sign in claims the agency and becomes its admin. Run the
seed **after** that, so it attaches to the agency your sign-in created.

## The loop

Research (draft a strategy from the client's site, accept it) → Strategy
(positioning, pillars, and a weekly quota) → **Campaigns** (accept one) → Plan
(write everything it owes, accept what you like) → **Schedule** (give each piece
a day; copy or download the plan as Markdown).

The campaign is the demand: a preview writes what every *active* campaign's
`content_plan.breakdown` still owes, minus what has already been accepted
against it. With no accepted campaign it refuses to run. Nothing you drop or
leave unaccepted is lost — it is still owed, so the next run writes it again.

**Nothing is dated until you date it.** A piece is written for a campaign,
accepted, and only then given a day on the Schedule page, where it sits under
"Not scheduled yet" until you do. The time comes from the channel's posting
window. Undated pieces are skipped by the Google sync — there is no instant to
put on a calendar — and are invisible to any query with a date range, which is
why `listSlots` takes an explicit `dated: "unscheduled"`.

The quota moved with the dates. It no longer decides how much gets written; it
warns when a week goes over its weekly cap as you schedule, and never refuses —
going over is a call you are entitled to make, and a hard cap would only strand
the piece.

### Why planning stopped placing dates

The planner used to observe, decide and assign in one pass. Demand was paced
across the planning *horizon* while a campaign was only eligible in the weeks
inside its own *window*, and the two disagreed in the weeks before a campaign
started: pieces were generated because a campaign asked for them, then landed in
a week that campaign was not running in, where nothing could carry them. They
came out attributed to nothing, counted as delivered, with no warning anywhere —
`parseFills` only warns about an *ineligible* campaign, and there was none to be
ineligible.

Removing the calendar from generation removes the class: a gap's
`eligible_campaign_ids` now holds exactly one campaign, the one that asked, so
there is no week for a piece to be outside of. Slot ids follow — they are
`(client, campaign, type, n)`, derived from the demand rather than from a date
the assign stage picked, which also makes them stable across runs.

A preview is editable before it is committed. **Drop** takes an idea out of the
plan, with an optional reason; **Regenerate** asks for a different idea for
every dropped slot in one model call, keeping each one's date, time, channel and
campaign — only the idea changes, so nothing is re-scheduled. Accepting commits
whatever is left, and a hole you leave is simply re-proposed by the next run.

Two things make the reject loop work rather than just reroll:

- **The reason is a steer.** It is passed per slot and outranks everything but
  the format, following the same convention as slot copy and regenerate.
- **Every dropped theme joins the avoid-list**, including ones already replaced.
  The planner's own avoid-list (`loadRecentThemes`) reads *committed* slots, so
  without this the model hands straight back the idea you rejected a minute ago.

Dropping does not invalidate the commit: `fingerprintInputs` hashes the quota,
each campaign's content plan and every slot id — none of which a drop touches.
A campaign's start and end dates are deliberately not hashed, since they no
longer affect what gets written. Restoring a drop is refused once it has been replaced, because
both carry the same deterministic slot id.

Cancelling or skipping a piece puts it back on what its campaign is owed, so the
next run writes a replacement — see `QUOTA_COUNTING` in
`lib/marketing/planner/types.ts`.

## Research

`POST /api/v1/clients/{id}/research` reads the client's website and then the
open web, and drafts a strategy from what it found. It writes **nothing** to the
strategy — the draft lives on a run document until someone accepts it at
`.../research/runs/{runId}/accept`.

**It returns immediately, not when the research is done.** The row is written as
`running` before the first search and the work continues in `after()` from
`next/server`, so the browser holds nothing open: close the tab, walk away, come
back, and the run is still there with its current step in `progress`. The page
polls `GET .../research` while a run is in flight rather than waiting on a
request. One run per client at a time — a second `POST` gets a 409, because
three silent minutes is exactly when someone clicks again.

`after()` is bounded by the route's `maxDuration` (300s here), so an invocation
killed at the ceiling would leave a row stuck at `running` forever. `isStale`
reports any run still `running` after six minutes as interrupted, and the
concurrency guard ignores it — nothing is written back on read.

Optional `steer` and `competitors` in the POST body point the search: what to
focus on, and which rivals to look at by name. They direct where to look and
never what to conclude — a named competitor still has to be found before
anything is said about it, and the evidence rule below outranks the steer. The
last run's direction is pre-filled on the page, so re-running means adjusting it
rather than retyping it.

Two rules make it research rather than invention, and both are enforced in
`lib/marketing/research/parse.ts` rather than asked for in the prompt:

- **A claim survives only if it names a page the search actually read.** The
  model citing a URL is not evidence it read one, so `messaging.proof_points` is
  filtered against the URLs the `web_search` tool annotated. Proof points are the
  field that becomes a public claim about the client's business, so they get no
  benefit of the doubt.
- **No website, no run.** The status comes back `insufficient` with a reason
  instead of a strategy assembled from whatever the model half-remembers about a
  small business.

The site pass is scoped with `allowed_domains`, so **OpenAI fetches the pages and
this app never requests a URL a user supplied** — `website_url` is stored
unvalidated, and fetching it here would be an SSRF.

What research cannot see — real numbers, why deals are lost, who can actually
make content each week — comes back as `open_questions`: the agenda for the call
where you check the draft with the client.

To try it against a real client without writing anything:

```bash
npx tsx scripts/research-dry-run.ts <clientId>
```

Budget about three minutes a run; the route allows five.

## Firestore indexes

**None are required.** Both planner queries filter on `clientId` alone and
apply their date range or ordering in memory, so the app runs against a fresh
project with no Firestore setup.

`firestore.indexes.json` declares two composites as a later optimisation:

| Collection | Fields | Would serve |
|---|---|---|
| `marketing_slots` | `clientId`, `date` | the Schedule page's date range as a query |
| `marketing_plan_runs` | `clientId`, `createdAt desc` | ordering and limiting in the query |

The slots one barely matters — a client's slots are bounded. The plan-runs one
does eventually: runs accumulate without bound and each carries a full
observation blob, so `listPlanRuns` currently pulls them all back. Fine at MVP
volume, worth deploying at a few hundred runs per client:

```bash
firebase deploy --only firestore:indexes
```

Both commands target the `marketing` database, per `firebase.json`.

Then move the sort and limit back into the query in
`lib/marketing/planner/plan-runs.ts`.

## Checks

```bash
npm run test        # 327 tests over the pure functions
npm run typecheck
npm run build
npm run lint
```

The tests cover gap arithmetic, ISO week boundaries and date assignment — where
a bug produces a plausible-looking but wrong calendar (DST drift, a 53-week ISO
year, posts landing on a weekend) — plus the calendar reconciler's classifier
and the copy normaliser. Nothing is mocked anywhere: only pure functions are
tested, so they prove the algorithms, not the Firestore or Google integration.
Those are checked by dry-running against real data before a write path ships.

## Deploying

Vercel, with **Root Directory set to `app`** — this app is not at the repository
root; the design specs it is built from, and the deleted Python backend's
history, share the repo with it. Set Ignored Build Step to
`git diff --quiet HEAD^ HEAD -- ./` so a commit touching only `docs/` does not
redeploy an identical app. The build is the default Next output: do **not** add
`output: "standalone"`, which produces a tree Vercel does not serve.
`vercel.json` pins functions to `iad1` so they sit beside Firestore rather than
wherever the account default lands.

Every variable in `.env.example` must be set in the Vercel project, with three
that behave differently from the rest:

| Var | Care needed |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | All six. Read by `lib/firebase.ts` and baked into the browser bundle at build time, so changing one needs a redeploy, not a restart. |
| `FIREBASE_PRIVATE_KEY` | Paste it **without** the surrounding double quotes, keeping the literal `\n` escapes; `lib/firebase-admin.ts:40` unescapes them. `.env.local` needs the quotes because dotenv strips them, and Vercel does not — leave them in and the key begins with a `"`, `cert()` throws at module load, and *every* route importing firebase-admin returns a 500 HTML page. The symptom is the login screen saying "You do not have access to this app.", which is the client's fallback for a response that was not JSON. |
| `GOOGLE_OAUTH_REDIRECT_URI` | The deployed origin, e.g. `https://<domain>/api/v1/google/callback`, and the identical string listed on the OAuth client in Google Cloud. |

`package.json` pins one override:

```json
"overrides": { "jwks-rsa": { "jose": "^5.10.0" } }
```

firebase-admin is on Next's built-in external list, so it is `import`ed at
runtime rather than bundled, and its chain — firebase-admin → jwks-rsa → jose —
ends in a CommonJS `require()` of a package that jose 6 ships as ESM only. Node
17-22.11 and any runtime started with `--no-experimental-require-module` throw
ERR_REQUIRE_ESM there and every API route 500s, while a local Node 22.12+ loads
it happily — so this fails only once deployed. jose 5 exports a `require`
condition, and jwks-rsa uses just `importJWK` and `exportSPKI`, which are
unchanged between the two. Reproduce either way with:

```bash
node --no-experimental-require-module -e "require('firebase-admin/auth')"
```

Before the first deploy, three things live outside this repo:

1. **Publish the OAuth consent screen.** While its status is "Testing", Google
   expires refresh tokens after 7 days and only listed test users can connect —
   calendar sync works at launch and dies the following week.
2. **Add the production redirect URI** to the OAuth client, keeping the
   localhost one for development.
3. **Deploy the Firestore rules and indexes** to the `marketing` database:
   `firebase deploy --only firestore`. The rules are deny-all by design.

## What works today

Dashboard, Research, Strategy, Branding, Campaigns, Plan and Schedule, each
backed by a route in `app/api/v1`. There is no proxy and no second backend: the FastAPI
service this was ported from has been deleted, and its history is at `efc3748`.

The schedule pushes to a Google calendar per client and reconciles two ways —
moves, deletions and renames made in Google are adopted rather than overwritten
— and each piece has its own page where its brief and its finished copy are
written. Runs and Assets remain unbuilt and unlinked.
