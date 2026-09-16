# A plan run belongs to one campaign

*2026-09-16. Amends the planner described in `2026-09-04-nextjs-firestore-migration.md`.*

## The bug

Opening a campaign, pressing generate, and accepting the plan committed slots
for **every other active campaign too** — content the page never showed you and
you never reviewed.

The filter was at the wrong layer. `previewPlan(clientId)` built a run covering
all active campaigns; the campaign workspace filtered the *display* to its own
id; and `commitPlan` wrote the whole run. So the other campaigns' pieces were
generated, hidden, and committed.

It presented as "accepting one campaign accepts the others". It was not — the
accept route takes one id, `status: "active"` is written in exactly one place,
and the data showed three separate accepts eighteen minutes apart. Committing
from one campaign simply gave the others content.

## The change

`previewPlan(clientId, { timezone, campaignId })` plans one campaign.
`POST /plan/preview` requires `campaign_id`; `GET /plan/runs` accepts one. The
run document carries `campaignId`, and the campaign page fetches by it.

`commitPlan` is untouched, deliberately: scope the run and it commits what the
run holds. Scoping at commit time instead would need a representation for a
partially committed run, which `committed_at` and a single `status` cannot
express.

**The display filters were deleted rather than kept as a safety net.** A page
that hides part of what its accept button will write *is* the defect. With the
run scoped there is nothing to hide, and anything unexpected in a run should be
visible before you accept it.

Fixed for free: `replaceDroppedSlots(clientId, runId)` with no slot ids means
"every open drop", which previously reached other campaigns' drops.

Retired: the client-wide plan page, already orphaned — nothing linked to it once
the sidebar dropped Plan. Two generation paths with different scopes is what
caused this.

## Why the quota did not need rebalancing

The obvious worry — a client-level quota that one run balances across campaigns
— does not exist. `observe.ts` removed week-fitting precisely because it
produced content attributed to nothing. Demand is each campaign's
`plannedByType` minus its own delivered slots, `deliveredByType` already ignores
other campaigns, and the quota only resolves *channels*; `weeklyCap` is carried
and never read. Volume capping happens at scheduling time in `schedule.ts`,
client-wide, untouched.

## The two things that would have broken it

**The fingerprint.** `previewPlan` hashes what it planned from and `commitPlan`
recomputes it, refusing a run whose inputs moved. Scoping one side and not the
other would make **every commit throw `StalePlanError`**. Worse, if the hash
kept covering every slot in the client, committing campaign A would change
campaign B's input set and make B's perfectly good preview un-committable — and
two open previews is now the normal way to work.

Both sides therefore narrow through one function, `scopeToCampaign`, so they
cannot drift. A run with no `campaignId` — made before scoping — is still
hashed client-wide, because that is what it was computed from.

**Run retrieval.** Both pages fetched "the latest run" for the *client*. Left
alone, generating for A and then opening B would show B campaign A's run, filter
it to nothing, and report that nothing had been written for it.

## The one regression, and its fix

Every campaign's gaps used to go into a single `DecideRequest` — `chunkRequest`
only splits above 40 gaps — sharing one `recent_themes` avoid-list. Scoped runs
decide each campaign separately, and `loadRecentThemes` reads **committed slots
only**, so campaign B could not see campaign A's ten uncommitted themes. Two
campaigns could be handed the same angle in one session.

`themesFromOpenRuns` folds other campaigns' open, uncommitted run themes into
the avoid-list. Same blind spot and same remedy as `rejectedThemes` in
`replace.ts`, whose comment already noted that "a theme dropped thirty seconds
ago is invisible to it".

Cost: this saves tokens, not calls. Under 40 gaps it was one call before and
stays one call; the payload and completion shrink.

## Known holes

- **Slots already committed from another campaign's run are still there.** This
  is forward-only by decision; the Calendar has the controls to remove them.
- **`commitPlan` has no test.** It touches Firestore, and this repo mocks
  nothing. The scoping decisions it depends on are pure and tested; the write
  path is covered by the manual pass.
- Pre-scoping runs carry no `campaignId` and so match no campaign filter. They
  remain readable and committable, client-wide, as they were computed.
