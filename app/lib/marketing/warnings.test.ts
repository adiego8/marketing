import { describe, it, expect } from "vitest";
import { pieceWarnings } from "./warnings";
import type { SlotCopy } from "./copy";

// What matters here is that all four checks actually run and that a thin or
// absent strategy degrades rather than throws. The checks themselves are tested
// in copy.test.ts, language.test.ts, brand.test.ts and humanize.test.ts; this
// file is about the composition, which is the thing that had drifted when it
// was written out three times by hand.

const SPANISH = {
  content_strategy: { language: { code: "es", name: "Spanish" } },
  voice: { words_to_avoid: ["sinergia"] },
};

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

const post = (text: string, over: Partial<SlotCopy> = {}) =>
  copyOf({ blocks: [{ label: "Post", text }], ...over });

const piece = (over: Partial<{ type: string; channel: string; cta: string }> = {}) => ({
  type: "post",
  channel: "linkedin",
  cta: "Book the 20-minute check on the site.",
  ...over,
});

const CLEAN_ES =
  "Todo el mundo celebra la devolución de impuestos y casi nadie le pone precio. " +
  "Si este año te devolvieron cuatro mil euros, pasaste doce meses prestando " +
  "dinero sin intereses. Un solo formulario lo cambia.";

describe("pieceWarnings", () => {
  it("says nothing about a clean piece", () => {
    expect(pieceWarnings(post(CLEAN_ES), piece(), SPANISH)).toEqual([]);
  });

  it("runs the language check", () => {
    const english =
      "Everyone celebrates the refund and almost nobody prices it. If you got " +
      "four thousand back this year, you spent twelve months as a lender.";
    expect(pieceWarnings(post(english), piece(), SPANISH).join(" ")).toContain("Spanish");
  });

  it("runs the CTA check", () => {
    const out = pieceWarnings(post(CLEAN_ES), piece({ cta: "Mándanos un DM" }), SPANISH);
    expect(out.length).toBeGreaterThan(0);
  });

  it("runs the voice check, which needs the strategy and not the copy alone", () => {
    const out = pieceWarnings(post(`${CLEAN_ES} Pura sinergia.`), piece(), SPANISH);
    expect(out.join(" ")).toContain("sinergia");
  });

  it("runs the copy-shape check, which needs the format and not the copy alone", () => {
    // A carousel owes a caption and owes direction on every slide. The same
    // blocks on a post would be finished. Nothing but `piece` says which.
    const out = pieceWarnings(
      copyOf({ blocks: [{ label: "Slide 1", text: CLEAN_ES }] }),
      piece({ type: "carousel", channel: "instagram" }),
      SPANISH
    );
    expect(out.join(" ")).toContain("needs a caption");
    expect(out.join(" ")).toContain("No direction on Slide 1");
  });
});

describe("pieceWarnings — degrading", () => {
  it("still checks the ask when there is no copy yet", () => {
    // A slot can carry a brief with no written copy, and the ask is part of the
    // brief. Warning about it before anything is written is the point.
    const out = pieceWarnings(null, piece({ cta: "Reply with your number" }), null);
    expect(out.length).toBeGreaterThan(0);
  });

  it("survives a client with no strategy at all", () => {
    expect(() => pieceWarnings(post(CLEAN_ES), piece(), null)).not.toThrow();
  });

  it("survives a strategy whose sections are the wrong shape", () => {
    const junk = { content_strategy: "not an object", voice: 42 };
    expect(() => pieceWarnings(post(CLEAN_ES), piece(), junk)).not.toThrow();
  });

  it("falls back to English when the strategy names no language", () => {
    const out = pieceWarnings(post(CLEAN_ES), piece(), {});
    expect(out.join(" ")).toContain("English");
  });
});
