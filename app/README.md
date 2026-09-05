# Marketing Agent

Turns a client's weekly content quota into a dated, channel-assigned schedule:
what to post, where, when, and why. Asset generation is deliberately out of
scope — the agent plans, a human writes.

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

## Firestore indexes

**None are required.** Both planner queries filter on `clientId` alone and
apply their date range or ordering in memory, so the app runs against a fresh
project with no Firestore setup.

`firestore.indexes.json` declares two composites as a later optimisation:

| Collection | Fields | Would serve |
|---|---|---|
| `marketing_slots` | `clientId`, `date` | the horizon range as a query |
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
npm run test        # 94 tests over the planner's pure functions
npm run typecheck
npm run build
npm run lint
```

The tests cover gap arithmetic, ISO week boundaries, and date assignment —
where a bug produces a plausible-looking but wrong calendar (DST drift, a
53-week ISO year, posts landing on a weekend). They use injected fakes, so
they prove the algorithm, not the Firestore integration.

## What works today

Dashboard, Strategy, Branding, Campaigns and Plan. Onboarding, Calendar, Runs
and Assets are unlinked from the nav: their endpoints still proxy to the FastAPI
backend in `../` and have not been ported. Calendar returns with Google sync;
Runs and Assets are slated for deletion.

`next.config.ts` proxies anything unported to `localhost:8080` as a `fallback`
rewrite — after dynamic routes, so anything implemented here wins.
