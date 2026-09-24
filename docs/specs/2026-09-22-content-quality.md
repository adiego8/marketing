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

**The eight angles did not exist in code.** They were defined in
`strategy-intake.json` and nowhere else — prompt data, read by a human filling in
a strategy and by the research model drafting one, but never by the product.
`research/parse.ts` slugifies whatever comes back without checking it against
anything, and the strategy editor's angle `type` is a bare text input that can
legitimately be empty, so every stored angle is untrusted. `POSITIONING_ANGLES`
joins `LANGUAGES` in `brand.ts`, with `angleFor` validating and `anglesOf`
reading the brand's own choices in order and deduped. A test compares the
constant against the JSON so the two cannot drift.

`planner/angles.ts` then assigns each gap, in code, before the model is called:
an **angle**, a **pillar** round-robined over `content_strategy.content_pillars`,
and an **entry point** drawn from `icp.pain_points`, `icp.objections`,
`icp.trigger_events`, `messaging.proof_points` and `messaging.value_props`. The
sequence leads with the brand's own angles — the campaign's first where it names
a real one — then fills from the canonical eight. Because the brand's angles are
a subset, that is a reordering and never a truncation, which is what makes the
eight-distinct-angles guarantee hold for a client who named only one.

Plain index rotation, following `defaultChannelFor` in `observe.ts`. An earlier
draft called for offset strides to delay repeating combinations; not worth the
reasoning, because the angles alone carry the guarantee and eight is all a run
needs.

Allocation runs beside `expandGapIds` rather than inside it, so that function
stays exactly as tested. The types split: `Gap` is a piece that needs writing,
`GapRequest extends Gap` adds the assignment. `regenerate` and `replace` build
gaps by hand and speak `Gap` — both are a human asking for something different
about ONE piece, which is the opposite of the situation an allocation fixes.

A thin strategy never fails, it reports: no pillars, nothing to argue from, more
pieces than entry points, more pieces than angles. Those are facts about the
strategy and only a person can fix them.

Also carried through from the campaign: `target_audience`, which
`toCampaignWindow` was dropping. A campaign often narrows the client's ICP to one
segment, and a piece written for everyone lands for nobody.

### The net underneath it

Nothing stops a model handed eight different starting points from walking all
eight back to the campaign's key message. `planner/collisions.ts` is the check
that says when it did — `jaccard` from `similarity.ts`, whose module comment
named this as its second consumer. `jaccard` and not `overlap`: two themes are
comparable in length, so the symmetric measure is right.

It runs after the chunk loop in `decide`, the only point where the whole run's
fills are in one array — `chunkRequest` splits by campaign, so a check inside the
loop would miss every cross-chunk collision.

It does no stemming, so "punishes" and "punished" read as two different words and
a heavily reworded pair can slip through. That is the price of a measure needing
no dictionary and no model call, it is recorded in a test rather than hidden, and
the allocation is what actually prevents the problem.

### Where any of this is seen

**Plan-run warnings reached nobody.** `run.warnings` was stored on every run and
rendered in one place — the client overview, as a bare count, not clickable. The
campaign workspace held the run and its own comment said it was kept "for what it
says ABOUT a generation — warnings, a degraded model answer", but only `status`
was ever read. Every warning the planner has ever emitted landed in Firestore and
went nowhere.

They now render as a list beside the existing degraded banner, following the
research page's pattern. This surfaces all of them, not only collisions.

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

Tier A: `FORMAT_SHAPES.hasCaption` exists and is never read. Wired into
`parseCopy`, a post can no longer carry a caption at all. Tier B: a caption that
repeats a block, and a caption-shaped format that arrives without one.

The overlap test needs the similarity primitive this spec assigns to the
repetition work below. It is built here instead, because this is its first
consumer and a primitive with one caller is easier to get right than one with
none. `overlap` divides by the SMALLER token set rather than the union, which is
the whole reason `jaccard` is not enough on its own: a caption that repeats a
slide verbatim and then pads scores 1 on containment and well under the
threshold on jaccard, purely for being longer. Restatement is asymmetric, so it
needs the asymmetric measure. Function words are dropped first, from the same
table `language.ts` already ships — "the" and "de" appear in everything, and
leaving them in makes every pair of texts look alike.

### Production direction becomes non-optional

The field, the cap, the operator rendering and the guard that keeps it out of
client-facing output are all built. Change "omit it when the block needs none" to
required for every block of a visual format — carousel, reel, story: what to
shoot, what to design, what the camera sees. Optional elsewhere, on the formats
that are finished when the words are.

This rides on a new `needsDirection` flag rather than reusing `hasCaption`,
which is true for the same three formats today. They answer different questions
— one is "does this sit inside a caption box", the other "does someone have to
make this" — and a format that gains one should not silently gain the other.

The worked example in `WRITE_COPY_PROMPT` is a carousel whose four slides carry
no `note` at all, which taught the omission more effectively than the rule
forbade it. It gains one per slide.

### Hashtags, 30 to 5

`MAX_HASHTAGS = 30` → `5`, which `parseCopy` already clamps. The prompt rule
becomes "at most 5, in `language.name`". PATCH validation needs no edit at all —
the route already imports the constant, so it tightened with it, which is what
having one number rather than two is for.

And the "return `[]` for LinkedIn long-form and for email" rule moves out of the
prompt and into `parseCopy`, keyed on the channel. It had been asked for since
the beginning, and asking was all it ever did.

The asymmetry where `parseCopy` truncates silently and PATCH rejects loudly is
deliberate — a model gets clamped, a human gets told — and is preserved.

### Sounding human

Mostly Tier B by nature. `app/lib/marketing/humanize.ts`: AI-tell vocabulary by
density, reveal bridges, negative parallelism, staccato stacks, stacked triads,
performed sincerity, emoji storms, an em-dash cap, a hook that has to land before
the fold, and actual enforcement of `voice.words_to_avoid` — which four prompts
have asked for since the beginning and nothing has ever checked.

**"Seeded from the `ig-humanizer` skill" turned out to mean something narrower
than this spec assumed.** That skill promises a `references/scrub-rules.md`
holding "V3 regex patterns by tier, density scoring, em dash cap, rhythm rules" —
precisely the file a port would want — plus five more. None are on this machine;
only its `SKILL.md` synced. So the rules come from the skill's prose, which does
name the vocabulary verbatim and give every threshold as a number, but not from
its patterns. Every threshold here is the skill's own: three markers per block
(one is not a verdict — "AI vocabulary appears in 10% of human captions"), four
emoji, three fragments, a third triad, one em dash per hundred words.

Structure is language-agnostic and runs for every client. **Vocabulary exists for
English and Spanish only.** The English list is the skill's, from a corpus it
cites; the Spanish list is written by analogy, says so in the module, and should
be treated as the weaker signal. The other six languages get structure and say
nothing about vocabulary — the same bargain as hashtags in `language.ts`.

The single most important property is **silence**. This banner already carries
platform limits, language, CTA, caption echo and missing production notes; a
check that fired on ordinary writing would make a wall nobody reads and would
undo the other three phases while appearing to add to them. So the output is
severity-ordered and capped at four, saying how many it left unsaid — following
the skill's own guard that "a pass that finds nothing changes nothing."

Several of the skill's rules are deliberately not implemented, because a regex
cannot judge them: whether a hook "makes sense on its own", whether a paragraph
"reads machine-flat" (the skill disclaims a number for this outright), whether a
triad is hollow or natural, and detector scores, which the skill forbids as noise
under 300 words.

### The critique pass, deferred

A second model call that scores a draft and returns its reasoning is still worth
having, and is not built. Two reasons to wait.

It costs a call per piece, doubling what writing copy costs, and buying that
before the free checks have been lived with is paying to solve a problem that may
already be solved.

And it needs a home that does not exist. There is **no settings surface anywhere
in this codebase** — no settings object, no flags collection, no boolean config
field on any document. `Agency` has no TypeScript interface, no serializer and no
read/write route; it is written once by `auth.ts` and only ever read to check
existence. Every `process.env` var is a credential, an endpoint or a model name,
and not one is a behaviour toggle. "Behind a per-agency setting, default off" is
therefore a feature in its own right, not a flag, and deserves planning as one.

## What it costs

Nothing. All four phases together add **zero model calls**.

Dropping the automatic repair passes removed every conditional extra call this
would otherwise have introduced, and deferring the critique removed the last one.
The fields, prompt text, clamps and pure functions are free; so are the
deterministic humanizer rules.

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

Persisting the allocation onto slots. It stays on `GapRequest`, the model input;
putting it on a slot means `ProposedSlot`, `slotDoc`, `serializeSlot`, `Slot`,
`AgentSlot` and the PATCH route — a storage change in service of display.

Also out: automatic regeneration of any kind, reviving the orphaned drop/replace
routes, multiple caption variants per piece, per-campaign or per-piece language
override, switching models or reviving temperature, and anything touching
scheduling, dating or calendar sync.
