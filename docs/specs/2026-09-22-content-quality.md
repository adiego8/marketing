# Content that is worth publishing

2026-09-22

## The problem

At one piece a week the agent passes. At eight it does not.

Ask a campaign for eight posts and you get eight versions of its key message, in
whatever language the model felt like, ending in eight different asks pointing
eight different places. More content means more posts, not more value.

Seven complaints, from real use:

1. Volume produces repetition. The same information, reworded, across the set.
2. The caption restates the content instead of doing its own job, and carries no
   direction on how the piece should actually be made.
3. The content has no catch. It does not sound like a person wrote it.
4. A Spanish campaign comes back with English words in it.
5. Captions do not reliably match the language of the post.
6. Hashtags are unbounded. Five is the ceiling that makes sense.
7. Every piece invents its own CTA. They should drive to the website.

None of these needs a new marketing framework. Five of the seven are missing
*mechanism* — a field that does not exist, or a constraint asked for in prose and
never checked.

### It was specified once

`2026-04-04-autonomous-marketing-agent-design.md:72` defines a **review step**: a
separate LLM call checking "voice consistency, AI tells, repetition, quality, CTA
clarity — fail → regenerate (max 2x)", registered in the step registry at `:407`.
`:459` anticipates vector similarity search for repetition.

None of it survived the Next.js port. `docs/roadmap/agent-loop.md:150` still
lists the old Python `review.py` as "Built", in a pipeline that no longer exists.

The concern was right. The fail-and-regenerate loop was not — see below.

The same goes for the Methodology Layer `CLAUDE.md` promises. The 8 positioning
angles are defined in `app/prompts/strategy-intake.json` and used for
`positioning.primary_angle`, but grep the four generation prompts in
`planner/prompt.ts` and "contrarian", "unique mechanism" and "enemy" appear
nowhere. The methodology is a document written for a coding assistant, not
something the product uses.

### What the code does today

**Language.** Nothing, anywhere. `language` exists only as a free-text ICP
demographic (`demographics.ts:27`) that no prompt names. Nothing instructs a
language; nothing checks one. The prompts and their worked examples are
themselves in English, which is most of the reason the output drifts there.

**CTA.** `Client.website_url` reaches the two research prompts and nothing else.
There is no CTA field on the strategy. Each piece invents its ask in isolation,
so N pieces give N asks.

**Repetition.** `expandGapIds` (`decide.ts:73`) makes N gaps and up to 40 go to
the model in one call. The only thing separating piece 3 from piece 4 is an
integer, `index_in_set`. The only pressure is prose: "make those pieces genuinely
different." No similarity check of any kind exists in the repo — grep for
`similar|duplicat|dedupe|jaccard|levenshtein` returns nothing.

**Variety knobs.** The graded temperatures — 0.4 decide, 0.6 copy, 0.8 regenerate
and replace — are inert. `llm.ts:23-36`: gpt-5.5 rejects `temperature`, the SDK
catches the error, adds the model to a process-lifetime `noTemperature` set, and
drops the parameter from every later call. The grading is dead config.

**Caption.** Defined as "the accompanying text". Never told what job it does that
the blocks do not. `write-copy.ts:56-58` says outright that the copy stage has no
repetition awareness at all.

**Production notes.** `note` exists on every block, is capped at 300 chars
(`copy.ts:135`), renders for the operator (`schedule/[slotId]/page.tsx:684-686`),
and is stripped from the external API (`agent/project.ts:79-90`) so it can never
reach a client feed. Everything needed is built. The prompt says "omit it when
the block needs none", so it is omitted.

**Hashtags.** `MAX_HASHTAGS = 30` (`copy.ts:136`); PATCH rejects over 30
(`slots/[slotId]/route.ts:238-247`). The "return `[]` for LinkedIn and email"
rule lives only in the prompt.

**Voice.** `voice.words_to_avoid` is asked for in four prompts and enforced in
zero places. `copyWarnings` (`copy.ts:433`) counts characters and nothing else.

**Campaign to piece.** `goal` and `key_message` reach the planner.
`positioning_angle` and `target_audience` are on the campaign and dropped before
the prompt (`plan-runs.ts:58-95`, `decide.ts:114-129`).

## The principle

> Constrain generation. Do not correct it afterwards. The decision to regenerate
> is the operator's.

Every constraint below is in exactly one of two tiers, and the tier is a
deliberate choice.

**Tier A — enforced in code. The check cannot come back false.** The constraint
is applied by the system before, around or after the model, so no violation can
reach a slot. Nothing to retry, because nothing failed.

**Tier B — checked and reported. The operator decides.** Judgement-shaped things
a deterministic rule cannot guarantee. They surface as warnings on the piece.

**The agent never regenerates itself.** Not a cost decision — the product's
spine. The agent decides what gets made, a human decides what ships. An automatic
rewrite loop puts a machine on both sides of that line, spends money without
asking, and hides from the operator that anything was ever wrong. This is why the
2026-04-04 review step comes back as reporting and not as a retry loop.

The engineering consequence: prefer moving a constraint into Tier A over writing
a better prompt rule for it. Where something can only be Tier B, say so plainly.

## The change

### Language — a strategy field, and an honest limit

`content_strategy.language`, shaped `{ code: "es", name: "Spanish" }`. It belongs
in `content_strategy` because it is a content decision, not a fact about the
audience; `icp.demographics.language` stays what it is — "the language they want
to be sold in" — and seeds the default.

`content_strategy` passes `parseStrategyInput` untouched (`strategy.ts:47-60`
coerces each section wholesale with no per-key validation), so no route, storage
or `NESTED_FIELDS` change is needed.

It reaches no prompt today; `content_pillars` is lifted out of it by hand at
`run.ts:271`. Language follows that precedent exactly, lifted to a top-level
`language` key in all five payload builders: `planner/run.ts:274-280` →
`decide.ts:94,108`, `write-copy.ts:98,120-125`, `planner/regenerate.ts:107-112`,
`planner/replace.ts:150-155`, `campaigns.ts:207-215`.

A language model cannot be *forced* to write Spanish. What it can be denied is
the pull toward English, and today that pull is our own prompt. The worked JSON
examples in `planner/prompt.ts` are English content — "Three quotes per job isn't
diligence", "Got a $4,000 refund?". The model is shown English and asked for
Spanish. So: the language instruction moves to the top of each system prompt,
before the payload description rather than buried in a rules list, and every
example block gets an adjacent line saying the example is shown in English and
the output must not be.

That is as far as Tier A reaches. The rest is Tier B: a new pure module
`app/lib/marketing/language.ts` doing stopword-frequency detection — no
dependency, no model call, testable, which is what "nothing is mocked; only pure
functions are tested" requires. `languageWarnings(copy, expected)` returns one
warning per offending block, caption or on-screen line, concatenated with
`copyWarnings` so it surfaces in the existing banner
(`schedule/[slotId]/page.tsx:706-712`) with no new UI. The operator reads
"Slide 3 appears to be in English" and presses the regenerate button that
already exists.

Two things it deliberately will not do. It does not judge **hashtags** —
"#taxplanning" is one token with no function words in it, and no honest
frequency test can read it — and it says nothing about text **shorter than
eight tokens**, because a detector that fires on every four-word reel frame
would teach the operator to ignore the banner. Both are silence chosen over
noise; the prompt rule is what covers hashtags.

### One ask, worded differently every time

`messaging.primary_cta`, shaped `{ destination, intent }`, defaulting from
`Client.website_url`. `messaging` reaches only the campaign-ideas prompt today;
add `primary_cta` to all five payloads.

**The CTA is content.** It is what you say at the end of the reel — "call us for
more info" — not a URL stapled underneath the piece. An earlier draft of this
spec had the destination attached in code and rendered as its own line after the
copy, and that was wrong on both counts. It would have made the ask stop being
words, and it would have cost a great deal: eight render surfaces to touch, a
strategy-derived value leaking into `schedule:read` scoped API keys when
`brand:read` is a separate scope (`types.ts:498`), and `eventDescription`
(`calendar.ts:59`) — whose two call sites must render byte-identically or
calendar reconciliation misreads the feed — silently drifting, because a
strategy edit touches no slot and so raises no staleness signal.

So the consistency is at the level of **intent**, not of a rendered link. The
model writes the ask, in words, in the piece. What it no longer does is choose
what the piece is driving people toward.

The Tier A part is smaller than the earlier draft claimed but real: there is one
`primary_cta` per client and every generation path receives that same one, so N
pieces cannot serve N goals. The variance collapses because the input collapsed,
not because anything is appended afterwards.

> Every piece asks for `primary_cta.intent`, and only that. Do not invent a
> different kind of ask — no DM, no comment, no reply, no follow, no tag. Where
> the channel makes a link useful you may name `primary_cta.destination`. What
> changes from piece to piece is HOW you ask; across a set, no two pieces ask in
> the same words.

The worked example in `PLANNER_DECIDE_PROMPT` ended "Reply with how many quotes
your last job took", which is exactly the competing ask the rule forbids. An
example that contradicts the rule two lines below it teaches the example, so it
changes too.

Tier B: warn when a CTA names a competing action, from a per-language keyword
list.

### Where the two fields come from

Both are edited on the strategy page — the language as a `<select>` over the
closed list, beside the two other `content_strategy` fields in **Goals**; the
CTA as two inputs in **Messaging**, following the Primary Angle pattern. Neither
needs a route, storage or type change: `parseStrategyInput` copies each section
through whole and unvalidated, and the sections are `Record<string, unknown>`.

Both also go into `app/prompts/strategy-intake.json`, which is embedded into the
research draft prompt. **That alone is not enough.** `parseDraftStrategy`
whitelists every key it emits — `messaging` from exactly four fields,
`content_strategy` from exactly two — so a language or CTA the research model
proposes is dropped before it ever reaches Firestore. It has to be taught the
fields too, and the language goes through `languageFor` on the way in, so an
invented "es-AR" becomes the default rather than a value the picker cannot show
and the detector has no stopwords for.

### Repetition — build the variety, do not request it

One call asked for N pieces serving one key message will converge. With
temperature inert there is not even a randomness knob to lean on. Variety has to
be constructed.

New pure module `app/lib/marketing/planner/angles.ts` assigns each gap, in code,
before the model is called, a distinct combination of an **angle** (one of the 8
in `strategy-intake.json`), a **pillar** (round-robined over
`content_strategy.content_pillars`), and an **entry point** — one `pain_point`,
`objection`, `trigger_event` or `proof_point`, each used at most once per set.
`GapRequest` (`decide.ts:29-45`) gains `assigned_angle`, `assigned_pillar`,
`assigned_entry_point`.

Eight pieces are then provably given eight different arguments to make from eight
different starting points, because a function assigned them. The input constraint
cannot collide. This is also where the Methodology Layer finally reaches a
prompt.

Carry `positioning_angle` and `target_audience` through from the campaign too —
both exist on `campaign.strategy` and are dropped at `plan-runs.ts:58-95`. The
campaign's own angle seeds the allocation rather than competing with it.

Tier B on top: `app/lib/marketing/similarity.ts`, trigram / token-set Jaccard.
After `parseFills`, compare every returned theme and hook against the others in
the batch and against `recent_themes`, and report collisions on the plan run. No
repair call — with the allocation in place, a collision means the allocation
needs tuning or the strategy is thin, and both are things a person should see.

The same function serves the caption check below. One primitive, two consumers.

Also: a comment at each of the five graded temperature constants noting they are
dropped on gpt-5.5, so the next reader does not tune a knob that is not
connected.

### The caption gets a job

`WRITE_COPY_PROMPT` gains a per-format statement of what the caption does that
the blocks do not. For a carousel the blocks are what is on the slides and the
caption is the story around them — context the slides had no room for, then the
ask. For a reel the blocks are what is said and shown and the caption is why it
matters, for someone who did not play it. For a story, the ask, short. For a
post, thread or newsletter it stays `null`; there the blocks are the words.

The rule: the caption never restates a block. If a reader who has seen the slides
learns nothing new from the caption, it has failed.

Tier A: `FORMAT_SHAPES.hasCaption` (`copy.ts:193-201`) exists and is never read.
Wire it into `parseCopy` so a post cannot carry a caption and a carousel cannot
lose one silently. Tier B: caption-versus-blocks overlap through the similarity
function.

### Production direction becomes non-optional

The field, the cap, the operator rendering and the guard that keeps it out of
client-facing output are all built. Change "omit it when the block needs none" to
required for every block of a visual format — carousel, reel, story: what to
shoot, what to design, what the camera sees. Optional elsewhere. Tier B warning
beside a visual block that arrives without one.

### Hashtags, 30 to 5

`MAX_HASHTAGS = 30` → `5` (`copy.ts:136`), which `parseCopy` already clamps. The
prompt rule at `prompt.ts:311` becomes "at most 5, in `language.name`". PATCH
validation drops to 5. And the "return `[]` for LinkedIn long-form and for email"
rule moves out of the prompt and into `parseCopy`, so it is true rather than
requested.

The asymmetry where `parseCopy` truncates silently and PATCH rejects loudly is
deliberate — a model gets clamped, a human gets told — and is preserved.

### Sounding human

Mostly Tier B by nature. `app/lib/marketing/humanize.ts`, seeded from the
`ig-humanizer` skill: AI-tell vocabulary by density, reveal bridges, staccato
stacks, stacked triads, performed sincerity, emoji storms, an em-dash cap. Plus a
hook check — the first block delivers what `slot.hook` promised inside the first
125 characters — and actual enforcement of `voice.words_to_avoid`. All of it
returns warnings through `copyWarnings`.

A model critique pass is possible on top: a second call that scores a draft and
returns its reasoning. Behind a per-agency setting, default off, because it
doubles the model cost of every piece. Its output is a verdict on the operator's
screen and a candidate lesson — never an automatic rewrite.

## What it costs

Nothing, until someone turns on the critique.

Dropping the automatic repair passes removed every conditional extra call this
would otherwise have introduced. The fields, prompt text, clamps and pure
functions are free; the deterministic humanizer rules are free; the critique pass
is one extra call per piece and is off by default.

Worth remembering that `llm.ts:77` already retries up to 3 times on malformed
JSON, so one logical call can bill more than once. Existing behaviour, not added
here, but it is the silent multiplier when estimating.

## How it is verified

Everything new is a pure function, which is what the repo tests:

- `language.test.ts` — Spanish with English words flagged, clean text clean.
- `angles.test.ts` — 8 gaps give 8 distinct triples; allocation stable for
  identical input; no collision possible for a set that fits the strategy.
- `similarity.test.ts` — near-duplicates above threshold, genuine differences
  below.
- `humanize.test.ts` — known AI tells caught, `words_to_avoid` enforced.
- `copy.test.ts` — hashtags clamp at 5, `[]` for linkedin and email, a post
  cannot carry a caption, a visual block with no note warns.
- `decide.test.ts` and `write-copy.test.ts` — the payload carries `language`,
  `primary_cta` and the assigned angle, and the CTA destination is attached in
  code rather than read from the model, using the existing injected `DecideFn` /
  `CopyFn` seams.

`parseFills` (`decide.ts:200-260`) and `parseCopy` (`copy.ts:301-344`) are
hand-rolled — `llm.ts:83` uses legacy `json_object` mode, not structured outputs,
and no JSON schema exists in the repo. Every new field needs its parse branch and
its test.

Then one live run: a test client with `language: es` and a website destination,
one campaign, eight pieces. Eight distinct themes on eight assigned angles. No
English anywhere, hashtags included. Five hashtags or fewer. Eight asks, one
destination, eight wordings. Every carousel and reel block carrying a production
note. Captions adding context rather than restating slides. And nothing having
regenerated itself — every warning still sitting on the screen, waiting for a
decision.

## Order

Language and CTA first: they fix complaints 4, 5 and 7 and are the smallest diff.
Then the caption contract, production notes and hashtags, which are nearly free
and fix 2 and 6. Then the angle allocation, which is the real engineering and
fixes 1. Sounding human last, when the other noise is gone and you can actually
hear it.

## Not in this

Closing the learning loop. Signals are written by four call sites, read by one
page, and never reach a prompt; every lesson is hand-typed, and `evidence_count`
is always 0, so `lessonsFor`'s evidence-weighted sort degenerates to recency.
Real, and worth its own spec.

Also out: automatic regeneration of any kind, reviving the orphaned drop/replace
routes, multiple caption variants per piece, per-campaign or per-piece language
override, switching models or reviving temperature, and anything touching
scheduling, dating or calendar sync.
