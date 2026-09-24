import { describe, it, expect } from "vitest";
import {
  LLM_MODELS,
  DEFAULT_LLM_MODEL,
  modelFor,
  looksLikeOpenAiKey,
  parseLlmSettings,
} from "./llm-settings";

// This is the only credential in the app that a person types into a form, and
// the only setting that decides what every generation costs. Both halves fail
// silently if they fail at all: a model name that is junk would 404 deep inside
// a plan run, and a key saved from a mis-paste would look stored and work
// nowhere. So the shape gates are pure and tested, and the real check — that
// the key authenticates and can reach the model — is a free models.retrieve in
// the route, which cannot be tested here without a network call.

describe("modelFor", () => {
  it("keeps a model that is on the list", () => {
    for (const m of LLM_MODELS) expect(modelFor(m)).toBe(m);
  });

  it("degrades to the default rather than throwing", () => {
    // The languageFor bargain. A model retired from the list should stop being
    // offered, not stop the app: the picker shows the default and the next
    // save corrects the document.
    expect(modelFor("gpt-4o")).toBe(DEFAULT_LLM_MODEL);
    expect(modelFor("")).toBe(DEFAULT_LLM_MODEL);
    expect(modelFor(null)).toBe(DEFAULT_LLM_MODEL);
    expect(modelFor(undefined)).toBe(DEFAULT_LLM_MODEL);
    expect(modelFor(42)).toBe(DEFAULT_LLM_MODEL);
    expect(modelFor({ model: "gpt-5.5" })).toBe(DEFAULT_LLM_MODEL);
  });

  it("offers no *-pro model, which would 404 on this endpoint", () => {
    // .env.example warned about this from the beginning. A picker that offers
    // a broken choice is worse than one that offers fewer.
    expect(LLM_MODELS.some((m) => m.endsWith("-pro"))).toBe(false);
  });
});

describe("looksLikeOpenAiKey", () => {
  it("accepts the forms OpenAI currently issues", () => {
    expect(looksLikeOpenAiKey(`sk-${"a".repeat(40)}`)).toBe(true);
    expect(looksLikeOpenAiKey(`sk-proj-${"a".repeat(40)}`)).toBe(true);
    expect(looksLikeOpenAiKey(`sk-svcacct-${"a".repeat(40)}`)).toBe(true);
  });

  it("rejects an empty box, which is the commonest way to lose a key", () => {
    expect(looksLikeOpenAiKey("")).toBe(false);
    expect(looksLikeOpenAiKey("   ")).toBe(false);
  });

  it("rejects a Firebase ID token pasted into the wrong field", () => {
    expect(looksLikeOpenAiKey(`eyJhbGciOiJSUzI1NiIsImtpZCI6${"x".repeat(60)}`)).toBe(false);
  });

  it("rejects a whole command someone copied along with the key", () => {
    expect(looksLikeOpenAiKey(`Authorization: Bearer sk-${"a".repeat(40)}`)).toBe(false);
    expect(looksLikeOpenAiKey(`sk-${"a".repeat(40)} `)).toBe(true); // trailing space is trimmed
  });

  it("rejects something too short to be a key", () => {
    expect(looksLikeOpenAiKey("sk-abc")).toBe(false);
  });

  it("survives a value that is not a string", () => {
    expect(looksLikeOpenAiKey(null)).toBe(false);
    expect(looksLikeOpenAiKey(undefined)).toBe(false);
    expect(looksLikeOpenAiKey(12345)).toBe(false);
  });
});

describe("parseLlmSettings", () => {
  const KEY = `sk-proj-${"a".repeat(40)}`;
  const base = { model: "gpt-5.5", research_model: "gpt-5.5" };

  it("accepts a full save", () => {
    const out = parseLlmSettings({ ...base, api_key: KEY });
    expect(out).toEqual({
      data: { apiKey: KEY, model: "gpt-5.5", researchModel: "gpt-5.5" },
    });
  });

  it("treats an absent key as leave the stored one alone", () => {
    // Changing the model must not wipe the key. This is the case that would be
    // discovered by everything breaking.
    const out = parseLlmSettings(base);
    expect(out).toEqual({ data: { model: "gpt-5.5", researchModel: "gpt-5.5" } });
    expect("apiKey" in (out as { data: object }).data).toBe(false);
  });

  it("refuses an empty key rather than storing nothing", () => {
    // There is no way to run without a key, so a cleared box is a mistake and
    // not an instruction.
    expect(parseLlmSettings({ ...base, api_key: "" })).toHaveProperty("error");
  });

  it("trims the key, because a paste usually brings whitespace", () => {
    const out = parseLlmSettings({ ...base, api_key: `  ${KEY}  ` });
    expect(out).toEqual({
      data: { apiKey: KEY, model: "gpt-5.5", researchModel: "gpt-5.5" },
    });
  });

  it("refuses a model that is not on the list, and says what is", () => {
    const out = parseLlmSettings({ ...base, model: "gpt-4o" });
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("gpt-5.5");
  });

  it("checks the research model too, which is a separate choice", () => {
    expect(parseLlmSettings({ ...base, research_model: "nope" })).toHaveProperty("error");
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "", 7, [] as unknown]) {
      expect(parseLlmSettings(body), String(body)).toHaveProperty("error");
    }
  });

  it("drops unknown keys by building a fresh object", () => {
    const out = parseLlmSettings({ ...base, api_key: KEY, isAdmin: true, apiKeyEnc: "x" });
    expect(Object.keys((out as { data: object }).data).sort()).toEqual([
      "apiKey",
      "model",
      "researchModel",
    ]);
  });
});
