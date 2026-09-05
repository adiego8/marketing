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

`FIREBASE_DATABASE_ID` is optional; see `.env.example`.

## Running

```bash
npm run dev        # localhost:3008
npm run seed       # after signing in once — creates a client with a quota
```

The first person to sign in claims the agency and becomes its admin. Run the
seed **after** that, so it attaches to the agency your sign-in created.

## Firestore indexes

Two composite indexes are required, declared in `firestore.indexes.json`:

| Collection | Fields | Serves |
|---|---|---|
| `marketing_slots` | `clientId`, `date` | loading the slots in a planning horizon |
| `marketing_plan_runs` | `clientId`, `createdAt desc` | listing past plan runs |

Deploy them with:

```bash
firebase deploy --only firestore:indexes
```

If you skip this, the first query that needs one fails with an error containing
a one-click console URL to create it. That is fine for local work; deploy the
file for anything shared.

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
