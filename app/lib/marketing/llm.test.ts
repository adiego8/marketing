import { describe, it, expect } from "vitest";
import { rejectsTemperature } from "./llm";

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
      "OPENAI_API_KEY is not configured.",
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
