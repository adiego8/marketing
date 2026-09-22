// The two brand decisions every generation path needs and none of them had:
// what language to write in, and what to ask for.
//
// Both live on the strategy document, and both were missing entirely. Language
// existed only as an ICP demographic — a fact about the customer, not an
// instruction to the writer — and the CTA existed nowhere, so each piece chose
// its own ask in isolation and N pieces produced N asks.
//
// Nothing here touches Firestore or the model, for the same reason as copy.ts:
// this repo mocks nothing, so logic that reaches for the network never gets a
// test. The five payload builders read these accessors; they do not re-derive
// the fields, because five hand-rolled extractions is how one of them ends up
// silently missing the language.

import { clamp } from "./planner/decide";

/** A language the product can write in, check, and offer in the picker. */
export interface Language {
  /** ISO 639-1. What is stored. */
  code: string;
  /** What the prompt says and the picker shows. */
  name: string;
}

/**
 * The one ask, for every piece this client publishes.
 *
 * `intent` is the action in words — "book a consultation". `destination` is
 * where that lands. The model writes the ask; it does not choose either of
 * these, which is what stops eight pieces having eight different goals.
 */
export interface PrimaryCta {
  destination: string;
  intent: string;
}

/**
 * The closed list.
 *
 * Closed on purpose, and it is the same list three times over: the picker
 * offers it, languageFor validates against it, and language.ts ships stopwords
 * for exactly these. A free-text field would let an operator pick a language
 * the detector cannot check, and the check would then go quiet without saying
 * so — the worst of the three outcomes.
 *
 * English first, because it is the fallback.
 */
export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "ca", name: "Catalan" },
] as const;

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0];

const MAX_DESTINATION_CHARS = 500;
const MAX_INTENT_CHARS = 200;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A stored value to a language, degrading to English rather than throwing.
 *
 * Accepts a `{ code, name }` object, a bare code, or a bare name — the field is
 * hand-editable JSON and reaches us through an intake prompt, a research run
 * and a PUT that validates nothing inside a section, so all three shapes are
 * reachable. Anything unrecognised is English, which is the same bargain
 * normalizeFormat and limitsFor strike: a usable default beats an exception on
 * a path whose whole job is to keep generating.
 */
export function languageFor(value: unknown): Language {
  const raw =
    typeof value === "string"
      ? value
      : typeof asObject(value).code === "string"
        ? (asObject(value).code as string)
        : typeof asObject(value).name === "string"
          ? (asObject(value).name as string)
          : "";

  const needle = raw.trim().toLowerCase();
  if (!needle) return DEFAULT_LANGUAGE;

  return (
    LANGUAGES.find((l) => l.code === needle || l.name.toLowerCase() === needle) ??
    DEFAULT_LANGUAGE
  );
}

/** The language a client's content is written in. Always a language, never null. */
export function languageOf(strategy: unknown): Language {
  return languageFor(asObject(asObject(strategy).content_strategy).language);
}

/**
 * The client's single ask, or null when they have not set one.
 *
 * Null rather than an empty object so a prompt can branch on absence the way it
 * already branches on a null campaign, instead of reasoning about two empty
 * strings.
 */
export function primaryCtaOf(strategy: unknown): PrimaryCta | null {
  const raw = asObject(asObject(strategy).messaging).primary_cta;
  const cta = {
    destination: clamp(asObject(raw).destination, MAX_DESTINATION_CHARS),
    intent: clamp(asObject(raw).intent, MAX_INTENT_CHARS),
  };
  return cta.destination || cta.intent ? cta : null;
}

/**
 * The words this client has said not to use.
 *
 * Asked for in four prompts since the beginning and checked in none of them —
 * `voice.words_to_avoid` was a request the model could decline silently. Read
 * defensively because `voice`, like every strategy section, is an unvalidated
 * `Record<string, unknown>`.
 */
export function wordsToAvoidOf(strategy: unknown): string[] {
  const raw = asObject(asObject(strategy).voice).words_to_avoid;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is string => typeof w === "string")
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/* -------------------------------------------------------------- angles --- */

/** One way to argue for something. The `type` is what gets stored. */
export interface Angle {
  type: string;
  /** What the angle means, verbatim from the intake schema. */
  guidance: string;
}

/**
 * The eight positioning angles, and the first time they have existed in code.
 *
 * They were defined in `app/prompts/strategy-intake.json` and nowhere else —
 * prompt data, read by a human filling in a strategy and by the research model
 * drafting one, but never by the product. `research/parse.ts` slugifies
 * whatever comes back without checking it against anything, and the strategy
 * editor's angle `type` is a bare text input that can legitimately be empty. So
 * every stored angle is untrusted input, which is what angleFor is for.
 *
 * The JSON stays the source for the intake prompt. This is the source for
 * generation, and brand.test.ts asserts the two agree so they cannot drift.
 *
 * Order is the order they are offered in when a brand has not chosen its own.
 */
export const POSITIONING_ANGLES: readonly Angle[] = [
  { type: "contrarian", guidance: "Challenge what everyone in the category believes." },
  { type: "unique_mechanism", guidance: "Lead with HOW it works, not what it is." },
  { type: "transformation", guidance: "The before and the after — the gap closed." },
  { type: "enemy", guidance: "Position against a common villain the customer already resents." },
  { type: "speed_ease", guidance: "Compress the time or reduce the effort it takes." },
  { type: "specificity", guidance: "Hyper-specific about who it is for and what it does." },
  { type: "social_proof", guidance: "Lead with the evidence, not the claim." },
  { type: "risk_reversal", guidance: "Make the guarantee the headline." },
] as const;

/**
 * A stored angle type to a real angle, or null.
 *
 * Null rather than a default, unlike languageFor: an unrecognised language
 * still has to be written in something, but an angle nobody named is simply an
 * angle we do not have, and the allocator has seven others to reach for.
 */
export function angleFor(value: unknown): Angle | null {
  const needle = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!needle) return null;
  return POSITIONING_ANGLES.find((a) => a.type === needle) ?? null;
}

/**
 * The angles this brand chose, in the order it chose them.
 *
 * Primary first, because it is the one the strategy argues is strongest and so
 * belongs to the first piece. Deduped, because nothing stops an operator
 * repeating the primary angle in the secondary list, and an allocation that
 * handed the same angle to two pieces would be the exact failure this exists
 * to prevent.
 *
 * An empty result is normal and fine — a strategy that has named no angle gets
 * the canonical eight instead.
 */
export function anglesOf(strategy: unknown): Angle[] {
  const positioning = asObject(asObject(strategy).positioning);
  const secondary = Array.isArray(positioning.secondary_angles)
    ? positioning.secondary_angles
    : [];

  const out: Angle[] = [];
  for (const raw of [positioning.primary_angle, ...secondary]) {
    const angle = angleFor(asObject(raw).type);
    if (angle && !out.some((a) => a.type === angle.type)) out.push(angle);
  }
  return out;
}

/* ----------------------------------------------------------- cta check --- */

/**
 * Asks that compete with the client's own.
 *
 * Not a style preference: a piece that ends "comment below" is asking for
 * engagement, and one that ends "DM me" is asking for a conversation. Neither
 * moves anyone toward the destination, and a set where every piece picks a
 * different one of these is exactly the complaint this field exists to answer.
 *
 * Reported, never rewritten — the operator decides whether to regenerate.
 * Phrases only for the languages LANGUAGES ships; anything else returns nothing
 * rather than guessing.
 */
const COMPETING_ASKS: Record<string, readonly string[]> = {
  en: [
    "dm me", "dm us", "send a dm", "send me a dm", "slide into",
    "comment below", "comment with", "drop a comment", "leave a comment",
    "reply to this", "reply with", "reply below",
    "follow for", "follow me", "follow us",
    "tag a friend", "tag someone", "share this", "repost this",
    "link in bio", "link in my bio", "link in our bio",
  ],
  es: [
    "mandame un dm", "mandanos un dm", "enviame un dm", "escribeme por dm",
    "escribenos por dm", "mandame un mensaje",
    "comenta", "comentanos", "deja un comentario", "dejame un comentario",
    "responde a", "respondeme", "respondenos",
    "sigueme", "siguenos", "seguime", "seguinos",
    "etiqueta a", "comparte este", "comparti este",
    "enlace en la bio", "link en la bio", "link en bio",
  ],
  pt: [
    "manda um dm", "me manda um dm", "envia um dm",
    "comenta", "deixa um comentario", "comente abaixo",
    "responde a", "responda a",
    "me segue", "siga o", "siga nos",
    "marca um amigo", "compartilha este", "compartilhe este",
    "link na bio",
  ],
  fr: [
    "envoie moi un dm", "ecris moi en dm",
    "commente", "laisse un commentaire", "commentez",
    "reponds a", "repondez a",
    "abonne toi", "suis moi", "suivez",
    "identifie un ami", "partage ce", "partagez ce",
    "lien en bio", "lien dans la bio",
  ],
  de: [
    "schreib mir eine dm", "schick mir eine dm",
    "kommentiere", "hinterlasse einen kommentar",
    "antworte auf", "antworte mit",
    "folge mir", "folge uns", "folgt uns",
    "markiere einen", "teile diesen", "teilt diesen",
    "link in bio", "link in der bio",
  ],
  it: [
    "mandami un dm", "scrivimi in dm",
    "commenta", "lascia un commento",
    "rispondi a", "rispondi con",
    "seguimi", "seguici",
    "tagga un amico", "condividi questo",
    "link in bio",
  ],
  nl: [
    "stuur me een dm", "stuur een dm",
    "reageer", "laat een reactie",
    "antwoord op", "antwoord met",
    "volg mij", "volg ons",
    "tag een vriend", "deel dit",
    "link in bio",
  ],
  ca: [
    "envia'm un dm", "escriu me un dm",
    "comenta", "deixa un comentari",
    "respon a", "respon amb",
    "segueix me", "segueix nos",
    "etiqueta un", "comparteix aquest",
    "enllac a la bio",
  ],
};

/**
 * Lowercased, accent-stripped, punctuation flattened to spaces.
 *
 * Accents go because "comparte" and "compartí" are the same ask and nobody
 * should have to list both; apostrophes and punctuation go because "envia'm"
 * and "envia m" are too, and a phrase list that has to anticipate typography is
 * a phrase list that quietly stops matching.
 */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Does the ask name an action other than the one the client asked for? */
export function ctaWarnings(cta: string, language: Language): string[] {
  const phrases = COMPETING_ASKS[language.code];
  if (!phrases || typeof cta !== "string") return [];

  const haystack = ` ${normalize(cta)} `;
  const hit = phrases.find((phrase) => haystack.includes(` ${normalize(phrase)} `));
  if (!hit) return [];

  return [
    `The call to action asks for "${hit}" rather than driving to the destination.`,
  ];
}
