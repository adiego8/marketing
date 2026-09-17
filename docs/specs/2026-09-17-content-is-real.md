# Generated content is real content

2026-09-17

## The problem

A piece's detail page — `/clients/{id}/schedule/{slotId}` — was unreachable from
the content step, and could not be made reachable by adding a link. At that step
the pieces did not exist. Generation wrote a *preview* (a plan run holding
`proposedSlots`) and only `commitPlan` turned those into slot documents, so five
of the page's six sections had nothing to act on.

That made the review backwards: you decided whether to accept content you could
not open, edit, or give words to, because none of that was possible until after
the decision.

## The change

`POST /plan/generate` replaces `POST /plan/preview` plus
`POST /plan/runs/{runId}/commit`. It runs `previewPlan` then `commitPlan`, both
unchanged, and the pieces exist immediately — undated, status `planned`. Days
are still chosen afterwards, by a person, so scheduling is the last decision.

Rejecting a piece is **cancel, then generate again**. That needed no new
machinery, which is the evidence the flow fits the domain rather than fighting
it:

- `countsAgainstQuota` (`planner/types.ts:25`) excludes `cancelled` and
  `skipped`, and its comment already said they *"free the gap again so the
  planner refills it."*
- `loadRecentThemes` (`plan-runs.ts:39`) reads every slot with a theme and
  applies **no status filter**, so a cancelled theme stays in the avoid-list and
  the model does not return the angle just rejected.

Neither function changed.

The plan run document survives, and still earns its place: demand, the
observation snapshot, warnings, model metadata, `created_slot_ids`.
`deletePlanRun` already removes a committed run's slots and their Google events,
so "undo that whole batch" needed nothing.

## What went with it

`themesFromOpenRuns` is deleted. It existed because two previews in one session
could not see each other's themes — A's ten ideas were invisible to B because
none were slots yet. With generation committing in the same request there are no
open runs, and `loadRecentThemes` sees a piece the moment it exists.

The drop/restore/replace routes are retired along with `/plan/preview` and the
commit route. `drop.ts` and `replace.ts` keep their exports for now; nothing can
reach them, and deleting two modules plus their tests reviews better as its own
change.

## And a reversal, which is the honest part

The previous commit (`8d95839`) built copy-writing for *proposals*:
`writeProposedCopy`, `POST /plan/runs/{runId}/copy`, `ProposedSlot.content`,
`applyCopyToProposed`, a carry-through in `slotDoc`, and an inline copy panel in
stage ②. With no proposals, all of it is unreachable, and it is removed here
rather than left as dead weight.

It was built on an assumption about where copy should be written that should
have been checked first. What survives is the part that was worth doing
regardless:

- **`CopyBrief` + `generateCopy`** — the payload/model/parse path behind an
  injected `CopyFn`, which is what `writeCopy` now runs on. It gave a
  network-reaching path its first tests in a repo that mocks nothing.
- **`copy.ts`'s structural parameters.** Kept as a judgement call: the module no
  longer imports `Slot` at all, and naming the fields a copy decision depends on
  stands on its own merits.
- **`CopyView`** and **`StateLabel`**, both used by the new stage ②.
- The stuck-`writingId` fix on the schedule page, unrelated and real.

## The content step now

Real pieces, so the stage is smaller than it was: a `PieceCard` per slot with
its status, its copy state, **Turn down**, and **Open** —
`?from={campaignId}&stage=content`, the convention the detail page already read
and stage ④ already used. Gone: the Accept bar, the Dropped section, the reason
inputs, and "Rewrite N ideas".

Stage ③ gained the same **Open** link. Dating a piece you cannot open means
choosing a day for something you have not read since it was written.

Cancelled and skipped pieces are held out of stage ②'s list: a rejected idea
sitting in the list it was rejected from would read as still owed. It stays in
the client's history and in the model's avoid-list, which is where it matters.

## What this does not do

- Delete `drop.ts` / `replace.ts` and their tests.
- Change `/schedule/{slotId}` itself, which already did everything needed.
- Touch the agent rail or MCP, which never used preview or commit.
- Media and per-slot assets, still the largest remaining gap.
