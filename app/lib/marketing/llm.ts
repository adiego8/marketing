import OpenAI from "openai";

// Port of app/services/llm_service.py:llm_completion.
//
// Deliberately matches the Python call shape so output stays comparable:
// the prompt is the SYSTEM message, the payload is the USER message as
// JSON.stringify(x, null, 2), response_format is the legacy json_object mode
// (not structured outputs), and the model defaults to gpt-4o.
//
// What it adds over the Python: a timeout and one retry. There, a truncated
// response made json.loads throw, which the global handler turned into a 500.

export const DEFAULT_MODEL = process.env.LLM_MODEL || "gpt-5.5";

// Research reaches the model through the Responses API so it can carry the
// hosted web_search tool, which chat.completions cannot. Not every chat model
// accepts that tool, so the model is nameable on its own rather than inheriting
// LLM_MODEL blindly — a research run that quietly lost its web access would
// produce the same JSON, sourced from nothing.
export const RESEARCH_MODEL = process.env.RESEARCH_MODEL || DEFAULT_MODEL;
const TIMEOUT_MS = 120_000;

// Newer models reject any temperature other than the default: gpt-5, gpt-5.5
// and every gpt-5.6-* answer 400 "Unsupported value: 'temperature' does not
// support 0.7 with this model", while gpt-5.1 and gpt-5.4 accept it.
//
// Learned from the API's own error rather than hardcoded, so a model released
// after this was written needs no code change — the first call discovers the
// constraint, retries without the parameter, and every later call in the
// process skips it.
const noTemperature = new Set<string>();

/** Exported for tests: does this error mean the model refuses a custom temperature? */
export function rejectsTemperature(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("'temperature'") && message.includes("does not support");
}

let client: OpenAI | undefined;

function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: TIMEOUT_MS,
    });
  }
  return client;
}

export interface CompletionOptions {
  systemPrompt: string;
  /** Serialized as pretty JSON into the user message, matching the Python. */
  payload: unknown;
  temperature?: number;
  model?: string;
}

/** Call the LLM in JSON mode and return the parsed object. */
export async function llmJson<T = Record<string, unknown>>({
  systemPrompt,
  payload,
  temperature = 0.7,
  model = DEFAULT_MODEL,
}: CompletionOptions): Promise<T> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: JSON.stringify(payload, null, 2) },
  ];

  let lastError: unknown;
  // Three attempts: one may be spent discovering that the model refuses a
  // custom temperature, leaving the original two for a truncated JSON body.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai().chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        ...(noTemperature.has(model) ? {} : { temperature }),
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("LLM returned an empty response.");
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;
      // Not a failure worth counting: drop the parameter and go again.
      if (rejectsTemperature(error) && !noTemperature.has(model)) {
        noTemperature.add(model);
        attempt--;
        continue;
      }
      // A malformed/truncated JSON body is worth one more shot; a bad API key
      // is not, but the second attempt costs little and keeps this simple.
      if (attempt < 2) continue;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("LLM request failed.");
}

/* --------------------------------------------------------------- research -- */

export interface SearchOptions {
  systemPrompt: string;
  /** Serialized as pretty JSON into the user message, as in llmJson. */
  payload: unknown;
  /**
   * Restrict the search to these hosts. Passing the client's own domain is how
   * the "read their website" pass is done: OpenAI fetches the pages, so this
   * app never makes an outbound request to a URL a user supplied. website_url
   * is stored unvalidated, and fetching it here would be an SSRF.
   */
  allowedDomains?: string[];
  model?: string;
}

export interface SearchResult<T> {
  data: T;
  /** URLs the tool actually cited — evidence, not the model's own claim. */
  sources: string[];
}

/**
 * The pages the search actually opened, deduped, in the order first seen.
 *
 * Two places record this and neither is sufficient alone. When the model
 * answers in prose it annotates the text with url citations; when it answers in
 * JSON — which is what research asks for — there are no annotations at all, and
 * the only record is the tool's own `web_search_call` items. Reading just the
 * annotations meant every claim looked unsourced and got dropped.
 *
 * An `open_page` action is a page it fetched. A `search` action is only a query
 * it ran, so it contributes nothing: a search result the model never opened is
 * not evidence it read anything.
 */
function citedUrls(response: unknown): string[] {
  const seen = new Set<string>();
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];

  for (const item of output) {
    const action = (item as { action?: unknown }).action;
    if (action && typeof action === "object") {
      const url = (action as { url?: unknown }).url;
      if (typeof url === "string" && url) seen.add(url);
      // Some actions carry the pages behind a query rather than one url.
      const sources = (action as { sources?: unknown }).sources;
      if (Array.isArray(sources)) {
        for (const source of sources) {
          const su = typeof source === "string" ? source : (source as { url?: unknown })?.url;
          if (typeof su === "string" && su) seen.add(su);
        }
      }
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const annotations = (part as { annotations?: unknown }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const a of annotations) {
        const url = (a as { url?: unknown }).url;
        if (typeof url === "string" && url) seen.add(url);
      }
    }
  }
  return [...seen];
}

/**
 * Ask the model a question it must look up, and return parsed JSON plus the
 * URLs it cited.
 *
 * Deliberately NOT folded into llmJson: that one is the two-message,
 * json_object, chat.completions shape every other feature depends on, and it
 * has no way to carry a tool. Keeping them apart means the research path cannot
 * change the behaviour of campaign generation or copywriting.
 *
 * No retry loop. A search call costs real time — the route budgets 300s for two
 * of them — and the caller degrades rather than failing, so a second attempt
 * would more often burn the budget than rescue the run.
 */
export async function llmSearchJson<T = Record<string, unknown>>({
  systemPrompt,
  payload,
  allowedDomains,
  model = RESEARCH_MODEL,
}: SearchOptions): Promise<SearchResult<T>> {
  const response = await openai().responses.create({
    model,
    tools: [
      {
        type: "web_search",
        ...(allowedDomains?.length
          ? { filters: { allowed_domains: allowedDomains } }
          : {}),
      },
    ],
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const text = response.output_text;
  if (!text) throw new Error("The research model returned an empty response.");

  // The Responses API has no json_object mode with tools attached, so the
  // prompt asks for bare JSON and the model sometimes fences it anyway.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The research model did not return a JSON object.");
  }

  return {
    data: JSON.parse(cleaned.slice(start, end + 1)) as T,
    sources: citedUrls(response),
  };
}
