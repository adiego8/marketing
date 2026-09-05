# Multi-Tenant Data Model — Design Spec

## Context

The Autonomous Marketing Agent is being expanded from a single-tenant internal tool to a multi-tenant platform. Marketing agencies will use it to manage content for multiple clients. A solopreneur is modeled as an agency with one client.

The hierarchy: **Agency > Users > Clients > (Strategy, Campaigns, Runs, Assets, Feedback, Memory)**

Auth is deferred — no login flow for now. The data model supports future magic-link authentication.

---

## New Tables

### `agencies`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, auto-generated |
| name | String(255) | NOT NULL |
| created_at | DateTime | NOT NULL, default now |

### `users`

Not used for auth yet. One user auto-created per agency at seed time. Supports multiple users per agency in the future.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, auto-generated |
| agency_id | UUID | FK → agencies, NOT NULL |
| email | String(255) | UNIQUE, NOT NULL |
| name | String(255) | NOT NULL |
| role | String(50) | NOT NULL, default "admin" |
| created_at | DateTime | NOT NULL, default now |

### `clients`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, auto-generated |
| agency_id | UUID | FK → agencies, NOT NULL |
| name | String(255) | NOT NULL |
| website_url | String(500) | nullable |
| logo_url | String(500) | nullable, external URL |
| description | Text | nullable, internal notes |
| contact_email | String(255) | nullable |
| contact_phone | String(50) | nullable |
| status | String(50) | NOT NULL, default "active" (active/paused/archived) |
| created_at | DateTime | NOT NULL, default now |
| updated_at | DateTime | NOT NULL, default now, auto-update |

---

## Existing Tables — Changes

Every data table gets a `client_id` FK. Task configs get an `agency_id` FK.

| Table | New Column | FK Target | Notes |
|-------|-----------|-----------|-------|
| strategy | client_id | clients.id | UNIQUE constraint — one strategy per client |
| campaigns | client_id | clients.id | NOT NULL |
| runs | client_id | clients.id | NOT NULL |
| assets | client_id | clients.id | NOT NULL |
| feedback | client_id | clients.id | NOT NULL |
| memory_summaries | client_id | clients.id | NOT NULL |
| task_configs | agency_id | agencies.id | NOT NULL, shared across clients |

All new FK columns are indexed.

---

## Migration Plan

Single migration `006_multi_tenant.py`:

1. Create `agencies`, `users`, `clients` tables
2. Insert a default agency ("Default Agency")
3. Insert a default user (linked to default agency)
4. Insert a default client (linked to default agency, name from existing strategy if available)
5. Add `client_id` as nullable to: strategy, campaigns, runs, assets, feedback, memory_summaries
6. Add `agency_id` as nullable to: task_configs
7. Backfill all existing rows with default client_id / agency_id
8. Alter columns to NOT NULL
9. Add foreign key constraints and indexes
10. Add UNIQUE constraint on (client_id) for strategy table

Existing data is preserved — all current rows assigned to the default client.

---

## API Structure

### Client management (agency-level)

```
GET    /api/v1/clients                         → list clients (filterable by status)
POST   /api/v1/clients                         → create client
GET    /api/v1/clients/{client_id}              → get client details
PATCH  /api/v1/clients/{client_id}              → update client
DELETE /api/v1/clients/{client_id}              → delete client (soft: set archived)
```

### Client-scoped routes

All existing routes move under `/api/v1/clients/{client_id}/`:

```
GET/PUT    /api/v1/clients/{client_id}/strategy
POST       /api/v1/clients/{client_id}/onboarding/research
POST       /api/v1/clients/{client_id}/onboarding/profile
GET/POST   /api/v1/clients/{client_id}/campaigns
GET/PATCH  /api/v1/clients/{client_id}/campaigns/{id}
DELETE     /api/v1/clients/{client_id}/campaigns/{id}
POST       /api/v1/clients/{client_id}/campaigns/generate
POST       /api/v1/clients/{client_id}/campaigns/{id}/review
POST       /api/v1/clients/{client_id}/campaigns/{id}/improve
POST       /api/v1/clients/{client_id}/campaigns/{id}/accept
POST       /api/v1/clients/{client_id}/campaigns/{id}/reject
POST       /api/v1/clients/{client_id}/campaigns/{id}/complete
POST       /api/v1/clients/{client_id}/runs/tasks/{task_type}
GET        /api/v1/clients/{client_id}/runs
GET        /api/v1/clients/{client_id}/runs/{run_id}
GET/POST   /api/v1/clients/{client_id}/assets
POST       /api/v1/clients/{client_id}/assets/generate
GET/PATCH  /api/v1/clients/{client_id}/assets/{id}
DELETE     /api/v1/clients/{client_id}/assets/{id}
POST       /api/v1/clients/{client_id}/feedback
POST       /api/v1/clients/{client_id}/feedback/{run_id}/debrief
GET/POST   /api/v1/clients/{client_id}/memory/summaries
```

### Agency-level routes (not client-scoped)

```
GET/PUT    /api/v1/tasks
PUT        /api/v1/tasks/{task_type}
```

### Dependency injection

A `get_client` dependency extracts `client_id` from the path parameter, validates the client exists and is not archived, and returns the Client object. All route handlers receive the validated client and use `client.id` in queries.

```python
async def get_client(client_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Client:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    if client.status == "archived":
        raise HTTPException(400, "Client is archived")
    return client
```

---

## Frontend Structure

### Navigation hierarchy

```
Client List (/) → [select client] → /clients/{id}/... → Strategy, Campaigns, Assets, Runs
```

### Client List page (`/`)

- Table with columns: Name, Status, Website, Contact Email, Created
- Filters: status dropdown (active/paused/archived), text search by name
- "Add Client" button → modal or inline form
- Click row → navigates to `/clients/{id}`

### Client-scoped pages

All existing pages move under `/clients/[clientId]/`:

| Current Route | New Route |
|---------------|-----------|
| `/` (dashboard) | `/clients/[clientId]` |
| `/strategy` | `/clients/[clientId]/strategy` |
| `/campaigns` | `/clients/[clientId]/campaigns` |
| `/campaigns/[id]` | `/clients/[clientId]/campaigns/[id]` |
| `/assets` | `/clients/[clientId]/assets` |
| `/runs/[runId]` | `/clients/[clientId]/runs/[runId]` |
| `/onboarding` | `/clients/[clientId]/onboarding` |

### Sidebar changes

- Top of sidebar: client name + logo (if available) + "Back to Clients" link
- Nav items remain: Dashboard, Strategy, Campaigns, Assets
- Onboarding accessible from client dashboard if no strategy exists

### API client changes

All functions in `lib/api.ts` take `clientId` as the first parameter:

```typescript
getStrategy(clientId: string) → GET /api/v1/clients/{clientId}/strategy
listCampaigns(clientId: string, status?: string) → GET /api/v1/clients/{clientId}/campaigns
triggerRun(clientId: string, taskType: string, campaignId?: string) → POST /api/v1/clients/{clientId}/runs/tasks/{taskType}
```

### Types

New TypeScript types:

```typescript
interface Client {
  id: string;
  agency_id: string;
  name: string;
  website_url?: string;
  logo_url?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  status: "active" | "paused" | "archived";
  created_at: string;
  updated_at: string;
}
```

---

## Seed Script

Updated seed creates:

1. Default agency ("Default Agency")
2. Default user (email: "admin@agency.local", role: "admin")
3. Default client (name: "Default Client", status: "active")
4. Strategy linked to default client
5. Task config linked to default agency

---

## What This Does NOT Include

- **Auth/login** — deferred. No login page, no JWT, no session management.
- **Pipeline enforcement of quotas** — advisory only, as previously designed.
- **Inter-agency isolation** — since there's no auth, all data is technically accessible. Auth will enforce agency isolation later.
- **Client-level pipeline overrides** — all clients share agency pipeline config.
- **File upload for logos** — URL field only.

---

## Verification

1. Run migration → all existing data assigned to default client
2. Open app → client list shows "Default Client"
3. Click client → existing dashboard, strategy, campaigns, assets all work as before
4. Create a second client → onboard → separate strategy, campaigns, assets
5. Switch between clients → data is isolated
6. API calls without valid client_id → 404
7. Archived client → 400 on API calls
