import { describe, it, expect } from "vitest";
import intake from "../../prompts/strategy-intake.json";
import {
  LANGUAGES,
  POSITIONING_ANGLES,
  angleFor,
  anglesOf,
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

describe("POSITIONING_ANGLES", () => {
  it("matches the intake schema exactly, so the two cannot drift", () => {
    // The JSON is what a human fills in and what the research model drafts
    // against; this constant is what generation reads. If they disagree, a
    // strategy can name an angle the allocator will silently refuse to use.
    const fromJson = intake.reference.positioning_angle_types as Record<string, string>;
    const expected = Object.entries(fromJson)
      .filter(([key]) => !key.startsWith("_"))
      .map(([type, guidance]) => ({ type, guidance }));
    expect(POSITIONING_ANGLES).toEqual(expected);
  });

  it("has unique types", () => {
    const types = POSITIONING_ANGLES.map((a) => a.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("angleFor", () => {
  it("resolves a stored type", () => {
    expect(angleFor("contrarian")?.guidance).toContain("Challenge");
  });

  it("is case and whitespace insensitive", () => {
    expect(angleFor("  Contrarian ")?.type).toBe("contrarian");
  });

  it("returns null for anything it does not recognise", () => {
    // Unlike a language, an angle nobody named is simply one we do not have —
    // the allocator has seven others to reach for, so there is no default.
    expect(angleFor("")).toBeNull();
    expect(angleFor("vibes")).toBeNull();
    expect(angleFor(null)).toBeNull();
    expect(angleFor(7)).toBeNull();
  });
});

describe("anglesOf", () => {
  it("puts the brand's primary angle first", () => {
    const strategy = {
      positioning: {
        primary_angle: { type: "unique_mechanism" },
        secondary_angles: [{ type: "contrarian" }, { type: "speed_ease" }],
      },
    };
    expect(anglesOf(strategy).map((a) => a.type)).toEqual([
      "unique_mechanism",
      "contrarian",
      "speed_ease",
    ]);
  });

  it("drops the empty type the editor can produce, and any invented one", () => {
    // secondary_angles survives the research parser on a non-empty statement
    // alone, so an entry with no type at all is a normal stored shape.
    const strategy = {
      positioning: {
        primary_angle: { type: "", statement: "We do it differently" },
        secondary_angles: [{ type: "vibes" }, { type: "enemy" }],
      },
    };
    expect(anglesOf(strategy).map((a) => a.type)).toEqual(["enemy"]);
  });

  it("dedupes, because nothing stops an operator repeating the primary", () => {
    const strategy = {
      positioning: {
        primary_angle: { type: "enemy" },
        secondary_angles: [{ type: "enemy" }, { type: "contrarian" }],
      },
    };
    expect(anglesOf(strategy).map((a) => a.type)).toEqual(["enemy", "contrarian"]);
  });

  it("returns nothing when the brand has chosen no angle", () => {
    expect(anglesOf({ positioning: {} })).toEqual([]);
    expect(anglesOf({})).toEqual([]);
    expect(anglesOf(null)).toEqual([]);
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
