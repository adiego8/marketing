// Does this read like a person wrote it?
//
// The last of the seven content complaints and the only one genuinely about
// taste. What existed before: `voice.words_to_avoid` asked for in four prompts
// and enforced in none of them, plus seven words banned by name in
// WRITE_COPY_PROMPT and checked nowhere. copyWarnings counted characters.
//
// Ported from the `ig-humanizer` skill — and narrowly, which is worth being
// honest about. That skill promises a `references/scrub-rules.md` holding "V3
// regex patterns by tier, density scoring, em dash cap, rhythm rules", which is
// exactly the file a port would want, and it is not on this machine; only its
// SKILL.md synced. So what follows comes from the skill's prose, which does name
// the vocabulary verbatim and give every threshold as a number, but not from its
// patterns. Where the skill states a number, this file uses that number.
//
// Reported, never rewritten. Same bargain as everything else in this spec: the
// operator reads the warning and decides.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK, because a regex cannot judge it and a
// wrong warning costs more than a missing one:
//
//  - Whether the hook "makes sense on its own". Only its length is mechanical.
//  - Whether a paragraph "reads machine-flat". The skill disclaims a number for
//    this outright: "the check is ... not a variance number".
//  - Whether a triad is hollow or natural. One natural triple "with concrete
//    items" stays, and concreteness is judgement.
//  - Detector scores. The skill forbids them: under 300 words they are "noise".

import type { SlotCopy } from "./copy";
import type { Language } from "./brand";

/* ------------------------------------------------------------ thresholds --- */

/**
 * Markers in ONE block before it counts.
 *
 * The skill is emphatic that a single marker is not a verdict: "AI vocabulary
 * appears in 10% of human captions in our corpus, so one marker in a paragraph
 * is not a verdict. Three is." A checker that fires on one would be wrong nine
 * times out of ten and would teach the operator to stop reading the banner.
 */
const MARKER_DENSITY = 3;

/** "cap at about 1 per 100 words (1-2 per caption)". */
const EM_DASHES_PER_100_WORDS = 1;

/** "Emoji sprinkled through every line (4+ per caption)." 0-3 with intent is the target. */
const EMOJI_STORM = 4;

/** "at most 2 per caption, total ... Three in a caption is a pattern." */
const MAX_FRAGMENTS = 2;

/** "one natural triple with concrete items stays" — the third is the tell. */
const MAX_TRIADS = 2;

/** Instagram folds the caption here, so the hook has one line to do its job. */
const HOOK_CHARS = 125;

/**
 * How much this is allowed to say at once.
 *
 * The skill's own guard — "a pass that finds nothing changes nothing; do not
 * invent edits to justify the run" — and a practical one. This banner already
 * carries platform limits, language, CTA, caption echo and missing production
 * notes. Eight more check types unbounded would make a wall nobody reads, which
 * would undo the other phases at the same time as this one.
 */
const MAX_WARNINGS = 4;

/* ------------------------------------------------------------ vocabulary --- */

/**
 * The durable 2026 marker set, verbatim from the skill, plus the seven
 * WRITE_COPY_PROMPT has banned in prose since the beginning and never checked.
 *
 * Counted by density, never on one hit.
 *
 * Note what is NOT here from the skill's "model idiom layer": bare "quietly",
 * "compound", "the work", "a signal". They are ordinary English words and
 * flagging them would fire on writing that is perfectly fine. The distinctive
 * multi-word idioms from that layer are in the single-hit list instead.
 */
const EN_MARKERS = [
  "significant", "crucial", "notably", "particularly", "comprehensive",
  "insights", "robust", "leverage", "foster", "landscape", "nuanced",
  "streamline", "elevate", "empower",
  // Named as decaying 2023-24 markers, and already banned in the copy prompt.
  "delve", "tapestry", "realm", "journey", "paradigm", "unlock",
  // Hedges the author did not write. Density rather than single-hit: one
  // "perhaps" is a word, three is a voice that will not commit to anything.
  "perhaps",
];

/**
 * Scrubbed on a single hit, no density threshold — the skill's own exception:
 * "leave a single marker alone UNLESS it is a reveal bridge, negative
 * parallelism, a sincerity marker, or forensic leakage."
 *
 * Matched against accent-stripped, punctuation-flattened text, so "The result?"
 * and "the result" are the same needle.
 */
const EN_PHRASES: readonly { phrase: string; why: string }[] = [
  // Reveal bridges. The question forms live in EN_PATTERNS, because the
  // punctuation is the tell: "The result?" withholds, "the result was a 40%
  // lift" is just a sentence, and normalized text cannot tell them apart.
  { phrase: "plot twist", why: "a reveal bridge" },
  // Sincerity announcements.
  { phrase: "let me be honest", why: "performed sincerity" },
  { phrase: "ill be real", why: "performed sincerity" },
  { phrase: "to be direct", why: "performed sincerity" },
  { phrase: "the honest version", why: "performed sincerity" },
  { phrase: "real talk", why: "performed sincerity" },
  { phrase: "not gonna lie", why: "performed sincerity" },
  { phrase: "unpopular opinion", why: "performed sincerity" },
  // Banned openers.
  { phrase: "lets talk about", why: "a stock opener" },
  { phrase: "heres the thing", why: "a stock opener" },
  // Dead closers and engagement bait.
  { phrase: "what do you think", why: "a dead closer" },
  { phrase: "double tap if", why: "engagement bait" },
  { phrase: "comment yes", why: "engagement bait" },
  { phrase: "tag a friend", why: "engagement bait" },
  { phrase: "tag 3 friends", why: "engagement bait" },
  // Stock phrases.
  { phrase: "in todays fast paced world", why: "a stock phrase" },
  { phrase: "game changer", why: "a stock phrase" },
  { phrase: "level up", why: "a stock phrase" },
  { phrase: "dive in", why: "a stock phrase" },
  { phrase: "let that sink in", why: "a model idiom" },
  { phrase: "built different", why: "a model idiom" },
];

/**
 * The Spanish lists are MY OWN CONSTRUCTION, not ported research.
 *
 * The English set above comes from a corpus the skill cites (n=284 captions).
 * There is no equivalent behind these: they are the same KINDS of tell, written
 * by analogy, and they are here because Spanish is the language that prompted
 * the original complaint. Treat a Spanish warning as a weaker signal than an
 * English one, and edit this list freely — nothing was measured to produce it.
 */
const ES_MARKERS = [
  "fundamental", "fundamentales", "clave", "integral", "integrales",
  "potenciar", "empoderar", "optimizar", "aprovechar", "sinergia", "sinergias",
  "panorama", "matices", "ecosistema", "sinfin", "quizas",
  // Spanish adjectives inflect, so the forms are listed rather than stemmed.
  // A prefix match would be shorter and would also catch "clavel" with "clave".
  "robusto", "robusta", "robustos", "robustas",
  "revolucionario", "revolucionaria", "revolucionarios", "revolucionarias",
  "transformador", "transformadora", "transformadores", "transformadoras",
  "innovador", "innovadora", "innovadores", "innovadoras",
  "holistico", "holistica", "holisticos", "holisticas",
];

const ES_PHRASES: readonly { phrase: string; why: string }[] = [
  { phrase: "esto es lo que", why: "a reveal bridge" },
  { phrase: "spoiler", why: "a reveal bridge" },
  { phrase: "seamos honestos", why: "performed sincerity" },
  { phrase: "te sere sincero", why: "performed sincerity" },
  { phrase: "la verdad es que", why: "performed sincerity" },
  { phrase: "opinion impopular", why: "performed sincerity" },
  { phrase: "hablemos de", why: "a stock opener" },
  { phrase: "aqui esta la cosa", why: "a stock opener" },
  { phrase: "que opinas", why: "a dead closer" },
  { phrase: "dale doble tap", why: "engagement bait" },
  { phrase: "etiqueta a un amigo", why: "engagement bait" },
  { phrase: "en el mundo de", why: "a stock phrase" },
  { phrase: "en la era de", why: "a stock phrase" },
  { phrase: "cambio de juego", why: "a stock phrase" },
];

/**
 * Tells whose punctuation IS the tell, so they run against raw text.
 *
 * Negative parallelism lives here too: "No X. No Y. Just Z." is a shape rather
 * than a phrase, and the skill scrubs every form of it on a single hit.
 */
const EN_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bthe result\?/i, why: "a reveal bridge" },
  { pattern: /\bhere'?s what\b/i, why: "a reveal bridge" },
  { pattern: /\bhonestly\?/i, why: "performed sincerity" },
  { pattern: /\bno\s+[^.]{1,30}\.\s*no\s+[^.]{1,30}\.\s*just\b/i, why: "negative parallelism" },
  { pattern: /\ball the\s+[^.]{1,30}\.\s*none of the\b/i, why: "negative parallelism" },
  { pattern: /\bstop\s+\w+[^.]{0,30},\s*start\b/i, why: "negative parallelism" },
];

const ES_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /(¿|\b)el resultado\?/i, why: "a reveal bridge" },
  { pattern: /\bdeja de\s+\w+[^.]{0,30},\s*(empieza|empeza)\b/i, why: "negative parallelism" },
];

/**
 * Model artifacts that no human types.
 *
 * Language-agnostic, single hit, and the most severe thing here: every other
 * warning is a matter of taste, and this one means a fragment of the machine is
 * about to reach a client's feed.
 */
const LEAKAGE: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /oaicite/i, label: "oaicite" },
  { pattern: /contentReference/i, label: "contentReference" },
  { pattern: /turn\d+(?:search|news|view)\d+/i, label: "a tool-call marker" },
  { pattern: /\bas of my (?:last )?(?:update|knowledge)/i, label: "a knowledge-cutoff disclaimer" },
  { pattern: /\bas an AI\b/i, label: '"as an AI"' },
  // Template blanks. Narrow on purpose: a bare [bracket] is also a markdown
  // link and flagging those would fire on ordinary copy.
  { pattern: /\[(?:your|insert|client|company|brand|name)[^\]]*\]/i, label: "an unfilled template blank" },
];

/** Vocabulary exists for these two. The other six get structure only. */
const VOCABULARY: Record<
  string,
  {
    markers: readonly string[];
    phrases: readonly { phrase: string; why: string }[];
    patterns: readonly { pattern: RegExp; why: string }[];
  }
> = {
  en: { markers: EN_MARKERS, phrases: EN_PHRASES, patterns: EN_PATTERNS },
  es: { markers: ES_MARKERS, phrases: ES_PHRASES, patterns: ES_PATTERNS },
};

/** "A, B and C" — the conjunction differs, the shape does not. */
const CONJUNCTIONS = ["and", "y", "e", "et", "und", "en", "i"];

/* ----------------------------------------------------------------- text --- */

/** Lowercased, accent-stripped, punctuation flattened to single spaces. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return normalize(text).split(" ").filter(Boolean).length;
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

function countMarkers(haystack: string, markers: readonly string[]): string[] {
  return markers.filter((m) => hasPhrase(haystack, m));
}

/** Emoji and pictographs, which is what "4+ per caption" is counting. */
function countEmoji(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

/**
 * Standalone fragments — the skill's "#1 2026 tell, not the fix".
 *
 * A sentence of three words or fewer ending in a full stop. That catches
 * "Short. Punchy. Done." and the one-word lines for drama ("Still."), and
 * leaves questions and exclamations alone, which are ordinary speech.
 */
function countFragments(text: string): number {
  return text
    .split(/(?<=\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith(".") && wordCount(s) > 0 && wordCount(s) <= 3).length;
}

/** "A, B and C" runs. One is human; the skill scrubs the third. */
function countTriads(text: string): number {
  const conj = CONJUNCTIONS.join("|");
  const pattern = new RegExp(
    `[\\p{L}\\p{N}'-]+\\s*,\\s+[\\p{L}\\p{N}'-]+\\s*,?\\s+(?:${conj})\\s+[\\p{L}\\p{N}'-]+`,
    "giu"
  );
  return (text.match(pattern) ?? []).length;
}

function countEmDashes(text: string): number {
  return (text.match(/—/g) ?? []).length;
}

/* ------------------------------------------------------------- the check --- */

export interface HumanizeOptions {
  language: Language;
  /** The client's own list, from voice.words_to_avoid. */
  wordsToAvoid: string[];
  /** Used only to name the unit in a warning: "Slide 2" reads better than "block 2". */
  unit?: string;
}

/**
 * What would make a reader think a machine wrote this.
 *
 * Severity-ordered and capped, so a bad draft produces a short list rather than
 * a wall. When it has more to say than it is allowed, it says how much.
 */
export function humanizeWarnings(
  copy: SlotCopy | null,
  opts: HumanizeOptions
): string[] {
  if (!copy) return [];

  const units = [
    ...copy.blocks.map((b) => ({ label: b.label, text: b.text })),
    ...copy.blocks
      .filter((b) => b.onScreen)
      .map((b) => ({ label: `${b.label} (on screen)`, text: b.onScreen as string })),
    ...(copy.caption ? [{ label: "The caption", text: copy.caption }] : []),
  ];
  if (units.length === 0) return [];

  const whole = units.map((u) => u.text).join("\n\n");
  const wholeNormal = normalize(whole);
  const vocabulary = VOCABULARY[opts.language.code];

  const leakage: string[] = [];
  const avoided: string[] = [];
  const density: string[] = [];
  const phrases: string[] = [];
  const structure: string[] = [];

  // Severity 1 — a fragment of the machine, about to reach a client's feed.
  const leaked = LEAKAGE.find((l) => l.pattern.test(whole));
  if (leaked) {
    leakage.push(
      `This still contains ${leaked.label} — a model artifact, not copy. Do not publish it as it stands.`
    );
  }

  // Severity 2 — the client asked for this by name.
  const banned = countMarkers(wholeNormal, opts.wordsToAvoid.map(normalize));
  if (banned.length > 0) {
    avoided.push(
      `Uses ${banned.map((b) => `"${b}"`).join(", ")}, which this client's voice says to avoid.`
    );
  }

  // Severity 3 — vocabulary, per unit and by density. One marker is not a
  // verdict; three in one block is.
  if (vocabulary) {
    for (const unit of units) {
      const found = countMarkers(normalize(unit.text), vocabulary.markers);
      if (found.length >= MARKER_DENSITY) {
        density.push(
          `${unit.label} reads like a machine wrote it: ${found.map((f) => `"${f}"`).join(", ")}.`
        );
      }
    }
    for (const { phrase, why } of vocabulary.phrases) {
      if (hasPhrase(wholeNormal, phrase)) {
        phrases.push(`"${phrase}" is ${why}. Say the thing instead of announcing it.`);
      }
    }
    for (const { pattern, why } of vocabulary.patterns) {
      const hit = whole.match(pattern);
      if (hit) {
        phrases.push(`"${hit[0].trim()}" is ${why}. Say the thing instead of announcing it.`);
      }
    }
  }

  // Severity 4 — structure. Language-agnostic, so every client gets it.
  const words = wordCount(whole);
  const dashes = countEmDashes(whole);
  const dashCap = Math.max(1, Math.round((words / 100) * EM_DASHES_PER_100_WORDS));
  if (dashes > dashCap) {
    structure.push(
      `${dashes} em dashes in ${words} words. About one per hundred reads human; the rest want a comma or a full stop.`
    );
  }

  const emoji = countEmoji(whole);
  if (emoji >= EMOJI_STORM) {
    structure.push(`${emoji} emoji. Three placed with intent do more than ${emoji} scattered.`);
  }

  const fragments = countFragments(whole);
  if (fragments > MAX_FRAGMENTS) {
    structure.push(
      `${fragments} one-line fragments. One is a voice; ${fragments} is the staccato rhythm readers now read as a machine.`
    );
  }

  const triads = countTriads(whole);
  if (triads > MAX_TRIADS) {
    structure.push(
      `${triads} "A, B and C" runs. One is natural — stacked, they are the oldest tell there is.`
    );
  }

  // The hook has one line before the platform folds it away.
  //
  // Caption only, and that is the scope rather than an oversight. The 125-char
  // fold is a property of the box a carousel, reel or story sits in; a LinkedIn
  // post or a newsletter has no such cliff, and parseCopy already nulls the
  // caption for exactly the formats that do not have one. Measured on the first
  // SENTENCE, not the first line — most copy carries no newline, so "first
  // line" would mean the whole caption and would fire on everything.
  if (copy.caption) {
    const lead = copy.caption.split(/(?<=[.!?])\s|\n/)[0].trim();
    if (lead.length > HOOK_CHARS) {
      structure.push(
        `The opening line runs ${lead.length} characters. Past about ${HOOK_CHARS} it is hidden behind "more", so the hook has to land before that.`
      );
    }
  }

  const all = [...leakage, ...avoided, ...density, ...phrases, ...structure];
  if (all.length <= MAX_WARNINGS) return all;

  const kept = all.slice(0, MAX_WARNINGS);
  kept.push(
    `${all.length - MAX_WARNINGS} more of the same kind. Worth a rewrite rather than a patch.`
  );
  return kept;
}
