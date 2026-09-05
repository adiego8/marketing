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

const DEFAULT_MODEL = process.env.LLM_MODEL || "gpt-4o";
const TIMEOUT_MS = 90_000;

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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await openai().chat.completions.create({
        model,
        messages,
        temperature,
        response_format: { type: "json_object" },
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("LLM returned an empty response.");
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;
      // A malformed/truncated JSON body is worth one more shot; a bad API key
      // is not, but the second attempt costs little and keeps this simple.
      if (attempt === 0) continue;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("LLM request failed.");
}
