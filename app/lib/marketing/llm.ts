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

const DEFAULT_MODEL = process.env.LLM_MODEL || "gpt-5.5";
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
