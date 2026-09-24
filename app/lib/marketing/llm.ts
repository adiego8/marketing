import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod/v4";
import { readLlmConfig } from "./llm-settings-store";

// Port of app/services/llm_service.py:llm_completion.
//
// Deliberately matches the Python call shape so output stays comparable:
// the prompt is the SYSTEM message, the payload is the USER message as
// JSON.stringify(x, null, 2), response_format is the legacy json_object mode
// (not structured outputs), and the model is whatever Settings names.
//
// What it adds over the Python: a timeout and one retry. There, a truncated
// response made json.loads throw, which the global handler turned into a 500.

// The key and the two model names used to be env vars read once at module
// load, so changing either meant a redeploy and a cold start. They are a
// Firestore document now — see llm-settings.ts — and a change takes effect on
// the next call. Nothing in this file reads process.env any more.
//
// Research still gets its own model name, for the reason it always did: it
// reaches the model through the Responses API so it can carry the hosted
// web_search tool, which chat.completions cannot, and not every chat model
// accepts that tool. A research run that quietly lost its web access would
// produce the same JSON, sourced from nothing.
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

// The same bargain again, for structured outputs.
//
// A caller that passes a schema gets json_schema mode, where the API enforces
// the shape instead of the prompt asking for it. Not every model accepts that
// on chat.completions, and finding out costs a call — so nobody has to find
// out in advance. The first call discovers it, this drops back to the legacy
// json_object mode the rest of the app has always used, and every later call
// in the process skips the attempt. A model that refuses behaves exactly as it
// did before schemas existed.
const noJsonSchema = new Set<string>();

/** Exported for tests: does this error mean the model refuses a JSON schema? */
export function rejectsJsonSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Two wordings, one meaning: the parameter is not supported by this model,
  // or the value passed for it is not. Both are answered with a 400 naming
  // response_format or json_schema, and neither is worth a retry as it stands.
  const names = message.includes("response_format") || message.includes("json_schema");
  const refused =
    message.includes("does not support") ||
    message.includes("Unsupported") ||
    message.includes("unsupported") ||
    message.includes("Invalid schema");
  return names && refused;
}

/**
 * What a caller gets when nothing has been configured.
 *
 * There is deliberately no fallback to an env var. A key in two places is a
 * key you have to look in two places to rotate, and the whole point of the
 * move was that the stored one is the only one. So this refuses, by name, and
 * says where to fix it — the message reaches the operator through the plan-run
 * warnings, which already report what a failed model call said.
 */
export const NO_KEY_MESSAGE =
  "No OpenAI key is configured. Add one under Settings, in the Model card.";

// Memoised on the key it was built with, not unconditionally. A warm
// serverless instance outlives a key rotation, and a client cached without
// regard to the key would keep calling with the old one until the instance
// happened to be recycled.
let client: { key: string; instance: OpenAI } | undefined;

function openai(apiKey: string | null): OpenAI {
  if (!apiKey) throw new Error(NO_KEY_MESSAGE);
  if (!client || client.key !== apiKey) {
    const instance = new OpenAI({
      apiKey,
      timeout: TIMEOUT_MS,
      // The SDK retries twice by default (internal/request-options.d.ts:37),
      // and llmJson already has its own three-attempt loop. Left at the
      // default the two multiply: one timed-out or rate-limited call becomes
      // nine HTTP attempts at TIMEOUT_MS each, billed for every one that
      // reached the model. llmSearchJson learned this the expensive way and
      // opts out per request; this is the same opt-out, for every caller.
      //
      // Nothing is lost. The loop below already retries every error class
      // itself for its first two attempts, so the resilience is still there —
      // it is just counted once.
      maxRetries: 0,
    });
    client = { key: apiKey, instance };
  }
  return client.instance;
}

export interface CompletionOptions {
  systemPrompt: string;
  /** Serialized as pretty JSON into the user message, matching the Python. */
  payload: unknown;
  temperature?: number;
  model?: string;
  /**
   * A shape the API should enforce, rather than the prompt requesting it.
   *
   * Optional, and absent for every caller that has not been converted: without
   * it the call is the legacy json_object one it has always been. With it, a
   * response that does not match is not a response that comes back — which is
   * worth more than the defensive parsing it replaces, because the parsing
   * could only ever report the damage afterwards.
   *
   * The caller still parses. A schema guarantees the shape and cannot express
   * the domain rules — which channel is allowed for which gap, which campaign
   * is eligible, what a field is clamped to.
   */
  schema?: ZodType;
  /** Names the schema for the API. Ignored without one. */
  schemaName?: string;
}

/** Call the LLM in JSON mode and return the parsed object. */
export async function llmJson<T = Record<string, unknown>>({
  systemPrompt,
  payload,
  temperature = 0.7,
  model,
  schema,
  schemaName = "response",
}: CompletionOptions): Promise<T> {
  // Resolved once, OUTSIDE the retry loop. Three attempts should not mean
  // three Firestore reads, and a key rotated mid-retry would be a stranger
  // thing to debug than one that took effect on the next call.
  const config = await readLlmConfig();
  const chosen = model ?? config.model;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: JSON.stringify(payload, null, 2) },
  ];

  let lastError: unknown;
  // Three attempts: one may be spent discovering that the model refuses a
  // custom temperature, or a JSON schema, leaving the rest for a truncated
  // body. Both discoveries are free of charge in the sense that matters —
  // they do not consume an attempt, see the decrements below.
  for (let attempt = 0; attempt < 3; attempt++) {
    // Decided per attempt rather than once, so a downgrade takes effect on the
    // retry that follows it.
    const useSchema = schema !== undefined && !noJsonSchema.has(chosen);
    try {
      const response = await openai(config.apiKey).chat.completions.create({
        model: chosen,
        messages,
        response_format: useSchema
          ? zodResponseFormat(schema, schemaName)
          : { type: "json_object" },
        ...(noTemperature.has(chosen) ? {} : { temperature }),
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("LLM returned an empty response.");
      const parsed = JSON.parse(content);

      // Belt and braces. With the schema attached the API has already
      // guaranteed this, and the check costs nothing; without it — a model
      // that refused, or a caller that passed none — it is the only guarantee
      // there is, and a failure here is exactly what the retry is for.
      if (schema) {
        const checked = schema.safeParse(parsed);
        if (!checked.success) {
          throw new Error(`LLM response did not match ${schemaName}: ${checked.error.message}`);
        }
        return checked.data as T;
      }
      return parsed as T;
    } catch (error) {
      lastError = error;
      // Not a failure worth counting: drop the parameter and go again.
      if (rejectsTemperature(error) && !noTemperature.has(chosen)) {
        noTemperature.add(chosen);
        attempt--;
        continue;
      }
      // Nor this one. The model will not take a schema, so the call becomes
      // the json_object one every other caller makes, and the parse the
      // caller was always going to do is the only guard left.
      if (useSchema && rejectsJsonSchema(error)) {
        noJsonSchema.add(chosen);
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

/**
 * How long one search pass may take.
 *
 * The route budgets 300s for two passes and a draft, so a pass that has not
 * answered inside this is cut off and the run degrades to the other pass —
 * which is a result a human can use, unlike an invocation killed at the
 * ceiling with nothing written.
 */
const SEARCH_TIMEOUT_MS = 120_000;

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
  model,
}: SearchOptions): Promise<SearchResult<T>> {
  const config = await readLlmConfig();
  const response = await openai(config.apiKey).responses.create(
    {
      model: model ?? config.researchModel,
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
    },
    // maxRetries: 0 is the important half. The SDK used to retry twice by
    // default (internal/request-options.d.ts:37), so a search that legitimately
    // runs past the timeout was being killed and silently re-run twice — it
    // could never succeed, it cost three searches instead of one, and three
    // attempts at two minutes each blew the route's whole budget. A steered run
    // sat at one step for eight minutes this way. One attempt, then degrade.
    //
    // The client now sets maxRetries: 0 for everyone, so this is belt and
    // braces. Kept anyway: this call is the one that cannot afford a retry even
    // if that default is ever loosened, and the reason should stay next to it.
    { timeout: SEARCH_TIMEOUT_MS, maxRetries: 0 }
  );

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
