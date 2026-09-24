import { describe, it, expect } from "vitest";
import { rejectsTemperature, rejectsJsonSchema, NO_KEY_MESSAGE } from "./llm";

// The trigger for dropping the temperature parameter. Getting this wrong in
// either direction is expensive: too narrow and every call to a newer model
// fails with a 400, too broad and a real failure is retried as if it were a
// parameter problem.
describe("rejectsTemperature", () => {
  it("matches the API's actual wording", () => {
    // Verbatim from gpt-5.5, gpt-5 and every gpt-5.6-* variant.
    expect(
      rejectsTemperature(
        new Error(
          "400 Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported."
        )
      )
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    for (const message of [
      "401 Incorrect API key provided",
      "429 Rate limit reached for gpt-5.5",
      "404 This is not a chat model and thus not supported in the v1/chat/completions endpoint.",
      "Unexpected end of JSON input",
      NO_KEY_MESSAGE,
    ]) {
      expect(rejectsTemperature(new Error(message)), message).toBe(false);
    }
  });

  it("does not match a different unsupported parameter", () => {
    expect(
      rejectsTemperature(
        new Error("400 Unsupported value: 'max_tokens' is not supported with this model.")
      )
    ).toBe(false);
  });

  it("handles non-Error rejections", () => {
    expect(rejectsTemperature("boom")).toBe(false);
    expect(rejectsTemperature(undefined)).toBe(false);
  });
});

// The same trigger, for the same reason, one parameter along. This is what
// lets a schema be attached without first paying a call to find out whether
// the model takes one: too narrow and every planner run 400s, too broad and a
// real failure is silently downgraded to a mode with no guarantees.
describe("rejectsJsonSchema", () => {
  it("matches a model that does not support the parameter", () => {
    expect(
      rejectsJsonSchema(
        new Error(
          "400 Unsupported value: 'response_format' does not support 'json_schema' with this model."
        )
      )
    ).toBe(true);
  });

  it("matches the other wording, where the schema itself is refused", () => {
    expect(
      rejectsJsonSchema(
        new Error("400 Invalid schema for response_format 'planner_fills': unsupported keyword.")
      )
    ).toBe(true);
  });

  it("ignores unrelated failures, which must NOT downgrade the call", () => {
    // Each of these would otherwise turn one bad call into a silent, permanent
    // loss of the guarantee for the rest of the process.
    for (const message of [
      "401 Incorrect API key provided",
      "429 Rate limit reached for gpt-5.5",
      "Unexpected end of JSON input",
      NO_KEY_MESSAGE,
      "LLM returned an empty response.",
      "500 The server had an error while processing your request.",
    ]) {
      expect(rejectsJsonSchema(new Error(message)), message).toBe(false);
    }
  });

  it("does not match the temperature refusal, and is not matched by it", () => {
    const temp = new Error(
      "400 Unsupported value: 'temperature' does not support 0.7 with this model."
    );
    const schema = new Error(
      "400 Unsupported value: 'response_format' does not support 'json_schema' with this model."
    );
    expect(rejectsJsonSchema(temp)).toBe(false);
    expect(rejectsTemperature(schema)).toBe(false);
  });

  it("does not match a response that merely failed our own schema check", () => {
    // llmJson throws this itself when safeParse fails. Treating it as "the
    // model refuses schemas" would drop the guarantee on the first bad answer,
    // which is exactly the answer the guarantee exists to catch.
    expect(
      rejectsJsonSchema(new Error("LLM response did not match planner_fills: invalid_type"))
    ).toBe(false);
  });

  it("handles non-Error rejections", () => {
    expect(rejectsJsonSchema("boom")).toBe(false);
    expect(rejectsJsonSchema(undefined)).toBe(false);
  });
});
