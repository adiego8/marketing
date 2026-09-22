// Is this piece actually written in the language the client asked for?
//
// A Spanish campaign coming back with English in it is the complaint this
// answers, and it is answered by REPORTING, never by rewriting: the operator
// reads the warning and presses the regenerate button that already exists.
// Nothing here calls a model or touches Firestore — it is stopword frequency,
// which is enough to tell English from Spanish and cheap enough to run on every
// read.
//
// Deliberately a sibling of copyWarnings rather than part of it. copy.ts states
// that it takes only the fields it reads and imports no Slot; a language
// expectation is a fact about the client, not about the copy, so the two
// warning sets are concatenated by their callers instead.
//
// WHAT THIS CANNOT DO, so nobody is surprised by the silence:
//
//  - Hashtags. "#taxplanning" has no function words in it, and no honest
//    frequency test can judge one token. They are skipped entirely rather than
//    guessed at; the prompt rule is what covers them.
//  - Very short text. A reel frame of four words carries no signal, and a
//    detector that fires on those would be wrong often enough to train the
//    operator to ignore the banner. Below MIN_TOKENS it says nothing.
//
// Both are a deliberate choice of silence over noise: a warning nobody trusts
// is worse than no warning.

import type { SlotCopy } from "./copy";
import type { Language } from "./brand";

/**
 * High-frequency function words, chosen for how well they SEPARATE these eight
 * languages rather than for raw frequency.
 *
 * Content words are useless here — a Spanish post about "marketing" and an
 * English one share it. Articles, pronouns, prepositions and auxiliaries are
 * what a writer cannot avoid and cannot borrow, which is what makes them the
 * signal. Some overlap between the romance languages is unavoidable and is
 * handled by the margin rule in detectLanguage, not by pretending it is absent.
 */
const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    "the", "and", "you", "your", "is", "are", "was", "were", "that", "this",
    "with", "for", "from", "have", "has", "had", "been", "not", "but", "they",
    "their", "what", "when", "which", "will", "would", "about", "into", "more",
    "than", "there", "these", "those", "we", "our", "it", "its", "of", "in",
    "on", "at", "as", "by", "if", "or", "so", "just", "how", "why",
  ],
  es: [
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "que",
    "y", "en", "es", "son", "con", "por", "para", "su", "sus", "lo", "se",
    "no", "mas", "pero", "como", "cuando", "todo", "todos", "esta", "este",
    "esto", "hay", "ya", "muy", "sin", "sobre", "entre", "tu", "tus", "te",
    "nos", "al", "le", "les", "ha", "han", "ser", "hacer", "porque",
  ],
  pt: [
    "o", "os", "as", "um", "uma", "uns", "umas", "do", "da", "dos", "das",
    "que", "em", "no", "na", "nos", "nas", "com", "por", "para", "seu", "sua",
    "nao", "mais", "mas", "como", "quando", "tudo", "todos", "esta", "este",
    "isso", "ha", "ja", "muito", "sem", "sobre", "entre", "voce", "voces",
    "ao", "pelo", "pela", "sao", "foi", "ser", "fazer", "porque", "tambem",
  ],
  fr: [
    "le", "la", "les", "un", "une", "des", "du", "de", "que", "qui", "et",
    "dans", "est", "sont", "avec", "pour", "par", "son", "sa", "ses", "ne",
    "pas", "plus", "mais", "comme", "quand", "tout", "tous", "cette", "ce",
    "il", "elle", "vous", "nous", "leur", "aux", "au", "sur", "entre", "sans",
    "etre", "faire", "parce", "aussi", "ou", "donc", "votre", "vos",
  ],
  de: [
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
    "und", "ist", "sind", "war", "waren", "mit", "fur", "von", "zu", "auf",
    "nicht", "aber", "auch", "sich", "sie", "ihr", "ihre", "wir", "uns", "als",
    "wenn", "wie", "was", "mehr", "noch", "nur", "schon", "bei", "nach",
    "uber", "durch", "oder", "dass", "man", "haben", "werden", "kann",
  ],
  it: [
    "il", "lo", "la", "gli", "le", "un", "uno", "una", "del", "della", "dei",
    "delle", "che", "chi", "non", "per", "con", "sono", "come", "quando",
    "tutto", "tutti", "questa", "questo", "piu", "ma", "anche", "nel",
    "nella", "sul", "sulla", "loro", "suo", "sua", "noi", "voi", "essere",
    "fare", "perche", "senza", "tra", "fra", "ogni", "molto", "gia",
  ],
  nl: [
    "de", "het", "een", "en", "is", "zijn", "was", "waren", "met", "voor",
    "van", "op", "aan", "niet", "maar", "ook", "die", "dat", "deze", "dit",
    "je", "jij", "jouw", "we", "wij", "ons", "onze", "hun", "hoe", "wat",
    "wanneer", "meer", "nog", "als", "door", "over", "naar", "bij", "uit",
    "zo", "want", "omdat", "kan", "worden", "heeft", "hebben",
  ],
  ca: [
    "el", "la", "els", "les", "un", "una", "uns", "unes", "del", "dels", "que",
    "amb", "per", "son", "seu", "seva", "no", "mes", "pero", "com", "quan",
    "tot", "tots", "aquesta", "aquest", "hi", "ja", "molt", "sense", "sobre",
    "entre", "teu", "teva", "ens", "als", "al", "ha", "han", "ser", "fer",
    "perque", "tambe", "aixo", "aixi", "nomes", "cada",
  ],
};

/** Below this there is not enough text to judge, so nothing is said. */
const MIN_TOKENS = 8;

/** The winner must actually look like a language, not merely win. */
const MIN_SCORE = 0.12;

/**
 * How far the winner must beat the runner-up before we call it.
 *
 * The romance languages share a great deal of their function words, so a narrow
 * win between Spanish and Portuguese means "romance", not "Portuguese". This is
 * the number that keeps that from becoming a confident wrong answer.
 */
const MIN_MARGIN = 0.04;

/** Lowercased, accent-stripped, split on anything that is not a letter. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export interface Detection {
  code: string;
  /** How far ahead of the runner-up, 0-1. */
  confidence: number;
}

/**
 * The most likely language of a passage, or null when it will not say.
 *
 * Null is a real answer here and the common one for short copy — see the
 * module comment. A caller that treats null as "wrong language" would invert
 * the whole design.
 */
export function detectLanguage(text: string): Detection | null {
  if (typeof text !== "string") return null;
  const tokens = tokenize(text);
  if (tokens.length < MIN_TOKENS) return null;

  const scores = Object.entries(STOPWORDS)
    .map(([code, words]) => {
      const set = new Set(words);
      const hits = tokens.filter((t) => set.has(t)).length;
      return { code, score: hits / tokens.length };
    })
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scores;
  if (!best || best.score < MIN_SCORE) return null;

  const confidence = best.score - (runnerUp?.score ?? 0);
  if (confidence < MIN_MARGIN) return null;

  return { code: best.code, confidence };
}

/**
 * One warning per part of the copy that is not in the client's language.
 *
 * The message names the language it found ONLY when that is English, which is
 * both the case the operator actually hits and the one this detector is most
 * reliable on — English shares almost none of its function words with the other
 * seven. Everything else gets the honest, vaguer phrasing, because "this looks
 * Portuguese" on a Spanish slide is a worse failure than "this does not look
 * Spanish".
 */
export function languageWarnings(
  copy: SlotCopy | null,
  expected: Language
): string[] {
  if (!copy) return [];
  const warnings: string[] = [];

  const check = (label: string, text: string | null | undefined) => {
    if (!text) return;
    const found = detectLanguage(text);
    if (!found || found.code === expected.code) return;
    warnings.push(
      found.code === "en"
        ? `${label} appears to be in English, not ${expected.name}.`
        : `${label} does not look like ${expected.name}.`
    );
  };

  for (const block of copy.blocks) {
    check(block.label, block.text);
    // Burned onto the video or image, so just as published as block.text.
    if (block.onScreen) check(`${block.label} (on screen)`, block.onScreen);
  }
  check("The caption", copy.caption);

  // Hashtags are not checked. See the module comment.
  return warnings;
}
