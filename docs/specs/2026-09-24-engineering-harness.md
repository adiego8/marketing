# The checks that were never run

2026-09-24

## The problem

Four phases of content-quality work shipped in two days
(`docs/specs/2026-09-22-content-quality.md`). 791 tests, all green, and every
one of them ran only when a human remembered to type `npm test`.

That was the visible gap. Grounding the work turned up two more.

**One logical model call was billing as up to nine.** `llm.ts` built the OpenAI
client with a `timeout` and nothing else, so the SDK's default `maxRetries: 2`
applied underneath `llmJson`'s own three-attempt loop. On a timeout or a 429 —
the two things the SDK retries — the two multiplied. The repo had already paid
to learn this once: `llmSearchJson` opts out per request, and its comment
records the cost — "three searches instead of one", "a steered run sat at one
step for eight minutes". The opt-out was never carried across.

**The scorers were already an eval harness.** `copyWarnings`,
`languageWarnings`, `ctaWarnings`, `humanizeWarnings` and `themeCollisions` are
a deterministic quality score over generated output: pure, tested, free. What
was missing was a corpus to run them over. Every threshold in them — three
markers per block, four emoji, `THEME_COLLISION_THRESHOLD`, `MAX_FRAGMENTS` —
was set from a skill's prose and never measured against anything the model had
actually written.

## The principle

The content-quality spec drew one line — constrain generation, do not correct
it afterwards. This one draws the same line one level down.

> A guarantee the API can make is worth more than a guarantee the prompt asks
> for. A number you can measure is worth more than a number you argued about.

Both halves are Tier A moves applied to the plumbing rather than to the copy.

## The change

### One logical call, one billed call

`maxRetries: 0` on the client, beside the timeout that was already there.
Attempts go from up to nine back to the three the loop intends. Nothing is
lost: the loop already retries every error class itself on its first two
attempts, so the resilience stays and is merely counted once.

The per-request opt-out in `llmSearchJson` is kept rather than removed. That
call is the one that cannot afford a retry even if the client default is ever
loosened, and the reason belongs next to it.

### CI, and why it needs no secrets

`.github/workflows/ci.yml` runs typecheck, lint, test and build on every push
and pull request, cheapest first. `typecheck` covers the tests too — `tsconfig`
includes `**/*.ts` and there is no separate test config — so a factory missing
a field fails on the fast step rather than the slow one.

**No repository secrets, by design rather than by luck.** `firebase-admin.ts`
is explicit that it never throws at import time when its env vars are absent;
`lib/firebase.ts` is guarded on `apiKey`; `OPENAI_API_KEY` is read inside
`openai()` rather than at module scope. Verified by building the tracked tree
in an empty environment with no `.env` file anywhere: every route compiles. So
a fork's pull request can run the workflow and there is nothing in it to leak.

### One entry point for the warnings

The four checks were concatenated by hand in three places — twice in
`write-copy.ts`, once on the slot page — and the copies had already drifted:
the page read `slot.cta`, `write-copy` read the brief's. `pieceWarnings` in
`warnings.ts` is the one call all three make now.

`slotWarnings` in `agent/project.ts` keeps returning `copyWarnings` alone. That
is a narrower external-API contract — "platform limit warnings" — not an
oversight.

`humanizeFindings` splits out of `humanizeWarnings` at the same time. The cap
of four belongs to the **banner**, not to the copy: it is the right thing to
show someone deciding whether to regenerate, and the wrong thing to measure
with, because a truncated list cannot say that a marker list has started firing
on every piece in the corpus. `humanizeWarnings` is now the ordering and
capping over the findings, and its existing tests pass untouched.

### A corpus, and a report that diffs

Every other test in this repo asks "does this check fire on the string I built
to make it fire?". That proves a rule works and says nothing about whether it
is **calibrated**.

`scripts/capture-corpus.ts` freezes real generated copy into
`lib/marketing/__fixtures__/corpus.json` — reads Firestore, writes nothing to
it, makes no model call, because everything in it was generated and paid for
once already. `corpus.test.ts` scores it and snapshots a readable report to
`baseline.md`.

The committed report is the artifact. Taking `MAX_FRAGMENTS` from 2 to 3 turns
94 warnings into 89 and names the five pieces that stopped complaining. A
change that moves nothing across thirty real pieces was not worth making; one
that moves everything wants looking at before it ships.

The corpus is real client copy in a private repo. That is the cost of the
option, and it buys reviewable diffs and a CI gate. Every piece carries its
`client_id` and `slot_id`, so a client who should not be in there comes out by
filter rather than by eye.

**What it does not measure: the prompts.** The fixtures are frozen output, so a
prompt edit does not move them. That needs live generation, which bills per
run — see below.

### The API enforces the shape

`llmJson` has always used the legacy `json_object` mode, so every guarantee
about what came back was made afterwards by a hand-rolled parser. `zod` and the
helper that compiles it were already installed and already used at
`mcp/tools.ts`; the model-response layer simply never touched them.

`decide` goes first, for three reasons. It sends the biggest payload, up to
forty pieces in one call. `Fill` has no optional fields, which matters because
strict JSON-schema mode has no way to express one — `SlotCopy`'s blocks carry
`note?` and `onScreen?` and would need nullable-then-map handling. And it buys
a real guarantee: the schema is built **per request** from that chunk's own
gaps, so `gap_id` is an enum of the ids the call actually asked about, and
"Ignored a fill for an unknown gap" stops being a warning and becomes a thing
the API will not return.

`parseFills` stays, and `fills-schema.test.ts` says why. A schema knows shapes.
It does not know that `allowed_channels` varies per gap, which campaigns are
eligible for which piece, or that a theme four characters over the cap should
be trimmed rather than rejected.

**Whether gpt-5.5 accepts a schema on `chat.completions` is not a question this
change had to answer.** It copies the `noTemperature` pattern already in the
file: an exported `rejectsJsonSchema` predicate, a process-lifetime set, and a
first call that discovers the constraint and falls back to `json_object` for
the rest of the process. A model that refuses behaves exactly as it did before.

## What the first run said

Two things, neither of them about the harness.

**Twenty-nine of thirty pieces warn, 94 warnings in total**, and the largest
single cause is that `content_strategy.language` is unset on both live clients.
Their copy is Spanish; the default is English; the language check fires 47
times. That is the wall-nobody-reads failure the content-quality spec spent its
last phase guarding against, happening in production on the day the guard
shipped. It is a configuration fix, not a code one.

**The fragment check fires on 13 of 30 pieces**, counting numbered list items
on a carousel slide as staccato rhythm — counts of 8 and 11 on pieces that are
checklists. `MAX_FRAGMENTS = 2` was taken from a skill's prose and has never
been measured against a real carousel until now.

Both are recorded, neither is acted on. Retuning a threshold because a report
went red is the same mistake as regenerating copy because a check went false.

## What it costs

Nothing, and slightly less than nothing.

Every phase adds zero model calls. The capture reads copy that already exists;
the report scores stored JSON; the schema rides on a call that was already
being made. The retry cap removes billed attempts that were never intended, and
a schema-enforced response cannot be malformed, which is the failure the
three-attempt loop existed for.

## How it is verified

Everything new is pure, which is what this repo tests: 829 tests, 45 files.

- `warnings.test.ts` — all four checks run, a missing or malformed strategy
  degrades rather than throws.
- `humanize.test.ts` — findings are uncapped and agree with the warnings
  whenever nothing had to be dropped.
- `corpus.test.ts` — the corpus is big enough to say anything, every piece
  reads back as copy, and the report matches its baseline.
- `fills-schema.test.ts` — the schema names exactly this call's gaps, refuses a
  gap nobody asked about, and does NOT police the per-gap rules the parser
  still owns. Plus the compiled JSON Schema against strict mode's two rules —
  every object closed, every property required — because a violation there is a
  400 on a paid call.
- `llm.test.ts` — `rejectsJsonSchema` matches both refusal wordings and none of
  the six failures that must not downgrade the call, including the schema
  mismatch `llmJson` throws itself.

Then one live plan run, authorized on its own: confirm the model accepts the
schema rather than falling back. One run, not a licence to iterate.

## Not in this

**The other three call sites.** `write-copy`, `research/run` and `campaigns`
follow only if `decide` proves the pattern.

**`campaigns.ts`.** `generateCampaignIdeas` and `improveCampaign` are the only
two model outputs that reach Firestore with no named parser — no length caps,
no cap on how many ideas come back, straight into a batch write. Found while
mapping the parsers for this work. Real, and a correctness fix rather than
harness work.

**A harness that runs live generation.** The only way to catch a prompt
regression, and it bills per run. Off-the-shelf options — promptfoo, Braintrust,
OpenAI Evals — all re-run generation, and the assertions they would run are
functions this repo already owns. Worth revisiting when head-to-head prompt
comparison across a corpus becomes the actual question.

**The eleven duplicated `Slot` test factories**, six of which hand-write all
thirty-five fields.
