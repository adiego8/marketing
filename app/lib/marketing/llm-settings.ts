// Which key the app calls OpenAI with, and which model it asks for.
//
// These were three env vars — OPENAI_API_KEY, LLM_MODEL, RESEARCH_MODEL — and
// the two model names were read ONCE at module load, so changing either meant
// a redeploy and a cold start. Now they are a document, and a change takes
// effect on the next call.
//
// INSTALL-WIDE, not per agency. That is the whole reason this is a small
// change: of the eight places this app calls a model, only three have a
// clientId in scope, and the other five sit behind functions that are
// deliberately data-only — DecideRequest carries no id by design, generateCopy
// states it has "no knowledge of where the piece lives". A per-tenant key would
// have to be threaded through all of them. An install-wide one is resolved
// inside llm.ts and nothing else moves.
//
// OWNER ONLY, therefore. One key that bills the whole install belongs to
// whoever runs it — see requireOwner in route-helpers.ts. Not role: resolveGrant
// hands every paying customer admin of their own agency, so an admin check
// would read as "any customer".
//
// PURE. Firestore lives in llm-settings-store.ts, the same split api-keys.ts
// and api-keys-store.ts already use — and here it is load-bearing rather than
// tidy: the settings page is a client component and imports LLM_MODELS from
// this file. One import of ../firestore would pull firebase-admin into the
// browser bundle.


/**
 * The models the picker offers.
 *
 * Closed, like LANGUAGES in brand.ts, and for a weaker reason — there are no
 * per-model stopwords to be missing, only a typo to catch. The honest cost is
 * that .env.example used to promise "newer models need no code change" and that
 * is no longer true: a new model is one line here.
 *
 * The *-pro models are deliberately absent. They are not chat models and 404 on
 * this endpoint, which .env.example has warned about since the beginning; a
 * picker that offers one is a picker that offers a broken choice.
 */
export const LLM_MODELS: readonly string[] = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.1",
  "gpt-5",
] as const;

export const DEFAULT_LLM_MODEL = LLM_MODELS[0];

/**
 * A stored model name, or the default.
 *
 * Degrades rather than throws, the languageFor bargain: a model that has been
 * retired from the list should stop being offered, not stop the app. The
 * picker will show the default and a save will correct the document.
 */
export function modelFor(value: unknown): string {
  return typeof value === "string" && LLM_MODELS.includes(value)
    ? value
    : DEFAULT_LLM_MODEL;
}

/**
 * Does this look like an OpenAI key at all?
 *
 * A shape gate, not a validity check — the real check is the free
 * models.retrieve call the route makes before storing. This one exists so an
 * obvious paste error (a Firebase ID token, a whole curl command, an empty
 * box) is refused without a network round trip.
 */
export function looksLikeOpenAiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  // Every current form starts sk- and none is short. Deliberately loose about
  // what follows: OpenAI has changed the middle of this format more than once
  // (sk-, sk-proj-, sk-svcacct-) and a gate that has to be edited for each one
  // is a gate that will one day reject a working key.
  return v.startsWith("sk-") && v.length >= 20 && !/\s/.test(v);
}

export interface LlmSettingsInput {
  /** Absent means "leave the stored key alone" — editing the model must not clear it. */
  apiKey?: string;
  model: string;
  researchModel: string;
}

/** What the route accepts. Returns the union every parse* in this repo returns. */
export function parseLlmSettings(
  body: unknown
): { data: LlmSettingsInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Expected an object." };
  const b = body as Record<string, unknown>;

  const model = b.model;
  if (typeof model !== "string" || !LLM_MODELS.includes(model)) {
    return { error: `model must be one of: ${LLM_MODELS.join(", ")}.` };
  }

  const researchModel = b.research_model;
  if (typeof researchModel !== "string" || !LLM_MODELS.includes(researchModel)) {
    return { error: `research_model must be one of: ${LLM_MODELS.join(", ")}.` };
  }

  // An absent key means "keep what is stored"; an empty string is a person
  // clearing the box, which is a mistake rather than an instruction — there is
  // no way to run without a key, so refuse it instead of storing nothing.
  if (b.api_key === undefined || b.api_key === null) {
    return { data: { model, researchModel } };
  }
  if (!looksLikeOpenAiKey(b.api_key)) {
    return { error: "That does not look like an OpenAI key. They start with sk-." };
  }

  return { data: { apiKey: b.api_key.trim(), model, researchModel } };
}
