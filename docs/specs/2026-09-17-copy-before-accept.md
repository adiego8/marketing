# Writing the copy before the plan is accepted

2026-09-17

## The problem

A campaign's finished copy could not be written from the campaign at all.
`writeSlotCopy` had two callers — the client-wide schedule page and one piece's
own page — so the flow was: accept a campaign's content, then leave the campaign
for a page organised by a different axis, or open each piece one at a time. The
campaign workspace did not import `readCopy`, so it could not even show whether
copy existed.

That put the decision in the wrong order. Accepting committed to pieces whose
words nobody had seen — only their briefs, which `copy.ts` is blunt are not
postable: *"slide 2: name the three signals" is an instruction to a writer, not
words on a slide.*

## The shape of the fix

Copy is now written **on demand, from stage ② Content, before accepting**, and
travels through commit with the piece.

**`ProposedSlot` gained `content`**, typed as `Slot.content` is — untyped,
narrowed only by `readCopy`. Added to both declarations (`lib/types.ts` and
`planner/types.ts`). No serializer change was needed: `serializePlanRun` passes
`proposed_slots` through raw.

**`copy.ts` stopped naming `Slot`.** Its six helpers each read two or three
fields, so they now name those fields (`HasBrief`, `HasFormat`, `HasContent`,
`HasChannel`) instead of a type. One implementation serves a committed slot and
an uncommitted proposal with no adapter and no second code path. The module no
longer imports `Slot` at all, which is the check that the decoupling is real.

Deliberately not `Slot | ProposedSlot`: a union drags in every field of both and
re-couples the module to two declarations it does not care about.

**`CopyBrief` normalises the one genuine incompatibility.** A `Slot` says
`campaign_id` and `needs_theme`; a `ProposedSlot` says `campaignId` and
`needsTheme`. `copyBriefOfSlot` and `copyBriefOfProposed` map both onto one
shape, and a test asserts they produce identical briefs from the same piece.
That test was mutation-checked: reintroducing the drift fails it.

**`generateCopy(brief, strategy, opts, lessons, copyFn)`** is brief-in,
copy-out, with the model call injected exactly as `replaceDropped` takes
`ReplaceFn`. `writeCopy` became the Firestore adapter over it;
`writeProposedCopy` is the run-scoped one, structured step for step like
`replaceDropped`.

**`slotDoc` carries the copy through commit** and promotes `planned` →
`drafted` when copy exists — the same promotion `writeCopy` already made
post-commit. Accepting therefore costs nothing: the words were paid for at
review time, and regenerating here would spend a second model call to produce
something different from what was approved.

## Two silent failures the tests pin

**A replacement must not inherit the dropped idea's copy.**
`withoutDropFields` spreads the whole entry by design — its comment says so, "so
a field added to ProposedSlot later is carried through here without anyone
remembering to". That is exactly why `replacementSlot` now clears `content`
explicitly. Left alone, one piece's words would show under another piece's
theme, flagged at worst as "older than the brief" rather than as the wrong
piece. Restore is the opposite case and needs nothing: the brief comes back
unchanged, so its copy is still its copy.

**The run is re-read after the model call.** Writing copy can take five minutes,
long enough for the operator to drop this piece or another one. Folding into the
array captured before the call would silently resurrect what they dropped.

## A bug fixed in passing

`handleWriteCopy` on the schedule page set `writingId` and cleared **`savingId`**
in its `finally`. `writingId` was never cleared, so after one use that row's
button stayed disabled reading "Writing…" until reload. Its doc comment also
claimed it shared `savingId` with the status select, contradicting the state
declaration a few lines above.

## What this does not do

- **Control cost.** Copy is still one model call per piece, up to 300s. Copy
  written on a piece then dropped is spend that produced nothing — inherent to
  reviewing before accepting. A "write all missing" batch is a separate call.
- Convert the slot detail page to the new `CopyView`. It renders a full page
  rather than a card; the component is available and that is all.
- Touch stages ③ and ④, or the client-wide schedule page's bulk copy action,
  which answers a different question.
- Add in-place editing of a proposed brief. Drop→replace is still the only
  pre-commit path.
