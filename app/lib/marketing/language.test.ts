import { describe, it, expect } from "vitest";
import { detectLanguage, languageWarnings } from "./language";
import { languageFor } from "./brand";
import type { SlotCopy } from "./copy";

const ES = languageFor("es");
const EN = languageFor("en");

const SPANISH =
  "Todo el mundo celebra la devolución de impuestos, pero casi nadie le pone precio. " +
  "Si este año te devolvieron cuatro mil euros, pasaste doce meses prestando dinero sin intereses.";

const ENGLISH =
  "Everyone celebrates the refund and almost nobody prices it. " +
  "If you got four thousand back this year, you spent twelve months as an interest-free lender.";

function copyOf(partial: Partial<SlotCopy>): SlotCopy {
  return {
    headline: null,
    blocks: [],
    caption: null,
    hashtags: [],
    sourceHash: "",
    generatedAt: "",
    model: null,
    editedAt: null,
    ...partial,
  };
}

describe("detectLanguage", () => {
  it("tells Spanish from English", () => {
    expect(detectLanguage(SPANISH)?.code).toBe("es");
    expect(detectLanguage(ENGLISH)?.code).toBe("en");
  });

  it("is unaffected by accents", () => {
    expect(detectLanguage(SPANISH.normalize("NFD"))?.code).toBe("es");
  });

  it("says nothing about text too short to judge", () => {
    // A reel frame of four words carries no signal. Silence beats a guess that
    // teaches the operator to ignore the banner.
    expect(detectLanguage("Tres presupuestos por trabajo")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("#taxplanning")).toBeNull();
  });

  it("says nothing when no language wins clearly", () => {
    // Proper nouns and numbers carry no function words at all.
    expect(detectLanguage("Madrid Barcelona Valencia Sevilla Bilbao Malaga Murcia Zaragoza")).toBeNull();
  });

  it("survives a non-string", () => {
    expect(detectLanguage(null as unknown as string)).toBeNull();
  });
});

describe("languageWarnings", () => {
  it("flags a block written in English when Spanish was asked for", () => {
    const copy = copyOf({
      blocks: [
        { label: "Slide 1", text: SPANISH },
        { label: "Slide 2", text: ENGLISH },
      ],
    });
    const warnings = languageWarnings(copy, ES);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Slide 2");
    // English is named because it is the case that actually happens and the one
    // the detector is most reliable on.
    expect(warnings[0]).toContain("English");
  });

  it("stays quiet when everything is in the expected language", () => {
    const copy = copyOf({
      blocks: [{ label: "Slide 1", text: SPANISH }],
      caption: SPANISH,
    });
    expect(languageWarnings(copy, ES)).toEqual([]);
  });

  it("stays quiet on English copy when English was asked for", () => {
    const copy = copyOf({ blocks: [{ label: "Post", text: ENGLISH }], caption: null });
    expect(languageWarnings(copy, EN)).toEqual([]);
  });

  it("checks the caption", () => {
    const copy = copyOf({
      blocks: [{ label: "Slide 1", text: SPANISH }],
      caption: ENGLISH,
    });
    const warnings = languageWarnings(copy, ES);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("caption");
  });

  it("checks on-screen text, which is just as published as the block", () => {
    const copy = copyOf({
      blocks: [{ label: "Shot 1", text: SPANISH, onScreen: ENGLISH }],
    });
    const warnings = languageWarnings(copy, ES);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("on screen");
  });

  it("never flags hashtags", () => {
    // One token has no function words in it; a frequency test cannot judge it,
    // so it is skipped rather than guessed at.
    const copy = copyOf({
      blocks: [{ label: "Slide 1", text: SPANISH }],
      hashtags: ["#smallbusinesstax", "#bookkeeping"],
    });
    expect(languageWarnings(copy, ES)).toEqual([]);
  });

  it("does not flag short blocks", () => {
    const copy = copyOf({ blocks: [{ label: "Frame 1", text: "Book now" }] });
    expect(languageWarnings(copy, ES)).toEqual([]);
  });

  it("survives absent copy", () => {
    expect(languageWarnings(null, ES)).toEqual([]);
  });
});
