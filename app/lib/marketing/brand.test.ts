import { describe, it, expect } from "vitest";
import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  languageFor,
  languageOf,
  primaryCtaOf,
  ctaWarnings,
} from "./brand";

describe("LANGUAGES", () => {
  it("has unique codes", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("defaults to English, which is the fallback everything else degrades to", () => {
    expect(DEFAULT_LANGUAGE.code).toBe("en");
  });
});

describe("languageFor", () => {
  it("accepts the stored { code, name } shape", () => {
    expect(languageFor({ code: "es", name: "Spanish" }).name).toBe("Spanish");
  });

  it("accepts a bare code or a bare name", () => {
    // Both reachable: the intake prompt, a research run and a PUT that
    // validates nothing inside a section can each produce a looser shape.
    expect(languageFor("es").code).toBe("es");
    expect(languageFor("Spanish").code).toBe("es");
    expect(languageFor({ name: "Portuguese" }).code).toBe("pt");
  });

  it("is case and whitespace insensitive", () => {
    expect(languageFor("  ES  ").code).toBe("es");
    expect(languageFor("spanish").code).toBe("es");
  });

  it("falls back to English rather than throwing on anything unrecognised", () => {
    // The whole job of this path is to keep generating; an exception here would
    // take down a plan run over a typo in one strategy field.
    expect(languageFor("Klingon").code).toBe("en");
    expect(languageFor("").code).toBe("en");
    expect(languageFor(null).code).toBe("en");
    expect(languageFor(42).code).toBe("en");
    expect(languageFor(["es"]).code).toBe("en");
  });
});

describe("languageOf", () => {
  it("reads content_strategy.language", () => {
    const strategy = { content_strategy: { language: { code: "es", name: "Spanish" } } };
    expect(languageOf(strategy).code).toBe("es");
  });

  it("returns English when the section or the field is missing", () => {
    expect(languageOf({ content_strategy: {} }).code).toBe("en");
    expect(languageOf({}).code).toBe("en");
    expect(languageOf(null).code).toBe("en");
  });

  it("does not read the ICP demographic of the same name", () => {
    // icp.demographics.language is a fact about the customer — "the language
    // they want to be sold in" — not an instruction to the writer. Conflating
    // the two is the bug that made this a separate field.
    const strategy = {
      icp: { demographics: { language: "Spanish" } },
      content_strategy: {},
    };
    expect(languageOf(strategy).code).toBe("en");
  });
});

describe("primaryCtaOf", () => {
  it("reads messaging.primary_cta and trims", () => {
    const strategy = {
      messaging: {
        primary_cta: { destination: "  https://example.com  ", intent: " book a call " },
      },
    };
    expect(primaryCtaOf(strategy)).toEqual({
      destination: "https://example.com",
      intent: "book a call",
    });
  });

  it("returns null when nothing is set, so a prompt can branch on absence", () => {
    expect(primaryCtaOf({ messaging: {} })).toBeNull();
    expect(primaryCtaOf({})).toBeNull();
    expect(primaryCtaOf(null)).toBeNull();
    expect(primaryCtaOf({ messaging: { primary_cta: { destination: "", intent: "" } } })).toBeNull();
  });

  it("survives a half-filled field", () => {
    expect(primaryCtaOf({ messaging: { primary_cta: { intent: "book a call" } } })).toEqual({
      destination: "",
      intent: "book a call",
    });
  });
});

describe("ctaWarnings", () => {
  const es = languageFor("es");
  const en = languageFor("en");

  it("flags an ask that competes with the client's own", () => {
    expect(ctaWarnings("Mándanos un DM y te contamos", es)).toHaveLength(1);
    expect(ctaWarnings("Comenta abajo si te pasó", es)).toHaveLength(1);
    expect(ctaWarnings("Reply with how many quotes your last job took", en)).toHaveLength(1);
    expect(ctaWarnings("Link in bio", en)).toHaveLength(1);
  });

  it("ignores accents and punctuation, so the list need not anticipate typography", () => {
    expect(ctaWarnings("Mandanos un DM", es)).toHaveLength(1);
    expect(ctaWarnings("¡Mándanos un DM!", es)).toHaveLength(1);
  });

  it("passes an ask that drives to the destination", () => {
    expect(ctaWarnings("Reservá tu consulta en nuestra web", es)).toEqual([]);
    expect(ctaWarnings("Book your consultation on our site", en)).toEqual([]);
  });

  it("matches whole words only", () => {
    // "comentario" inside ordinary prose is not an ask to comment.
    expect(ctaWarnings("Cada comentario de un cliente vale oro", es)).toEqual([]);
  });

  it("says nothing for a language it has no phrases for", () => {
    expect(ctaWarnings("whatever", { code: "xx", name: "Xhosa" })).toEqual([]);
  });

  it("survives a missing cta", () => {
    expect(ctaWarnings("", en)).toEqual([]);
    expect(ctaWarnings(undefined as unknown as string, en)).toEqual([]);
  });
});
