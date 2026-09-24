import { describe, it, expect } from "vitest";
import { contentTokens, jaccard, overlap } from "./similarity";

// The repo had no similarity measure of any kind before this: repetition was
// fought entirely with prompt instructions and one lowercase exact-string
// comparison, so two themes differing by a synonym passed every check there
// was. These assert the two properties the consumers actually rely on.

describe("contentTokens", () => {
  it("drops function words, which appear in everything", () => {
    const tokens = contentTokens("The refund is not a bonus");
    expect(tokens.has("refund")).toBe(true);
    expect(tokens.has("bonus")).toBe(true);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("not")).toBe(false);
  });

  it("drops them in every language the product writes in", () => {
    const tokens = contentTokens("La devolución no es un bono");
    expect(tokens.has("devolucion")).toBe(true);
    expect(tokens.has("la")).toBe(false);
    expect(tokens.has("que")).toBe(false);
  });

  it("ignores accents and case, so one spelling is not two words", () => {
    expect(contentTokens("Devolución")).toEqual(contentTokens("devolucion"));
  });

  it("keeps numbers, which are often the whole point of a claim", () => {
    expect(contentTokens("about 160 dollars").has("160")).toBe(true);
  });

  it("survives a non-string", () => {
    expect(contentTokens(null as unknown as string).size).toBe(0);
  });
});

describe("jaccard", () => {
  it("scores a reworded version of the same claim high", () => {
    const a = "Why per-seat pricing punishes the teams growing fastest";
    const b = "Per-seat pricing punishes fastest growing teams";
    expect(jaccard(a, b)).toBeGreaterThan(0.6);
  });

  it("scores genuinely different arguments low", () => {
    const a = "Why per-seat pricing punishes the teams growing fastest";
    const b = "The first 24 hours after a call decide whether you win the job";
    expect(jaccard(a, b)).toBeLessThan(0.15);
  });

  it("is symmetric", () => {
    const a = "quote gathering costs six hours a week";
    const b = "six hours a week lost to gathering quotes";
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });

  it("is zero against nothing", () => {
    expect(jaccard("anything at all", "")).toBe(0);
  });
});

describe("overlap", () => {
  it("scores a long text that swallows a short one as containment", () => {
    // This is the caption case, and the reason jaccard alone is not enough: a
    // caption that repeats a slide verbatim AND adds filler would score low on
    // jaccard purely for being longer.
    const slide = "A refund is your own paycheck handed back late";
    const caption = `${slide}, and here is a great deal of additional padding text about other subjects entirely`;
    expect(overlap(caption, slide)).toBe(1);
    expect(jaccard(caption, slide)).toBeLessThan(0.6);
  });

  it("stays low when the longer text genuinely says something else", () => {
    const slide = "Got a four thousand dollar refund?";
    const caption = "One W-4 change puts that money back into your monthly cash flow.";
    expect(overlap(caption, slide)).toBeLessThan(0.4);
  });

  it("is zero against nothing", () => {
    expect(overlap("", "something")).toBe(0);
  });
});
