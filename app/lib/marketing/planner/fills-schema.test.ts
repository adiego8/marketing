import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { zodResponseFormat } from "openai/helpers/zod";
import { fillsSchema } from "./fills-schema";
import { expandGapIds, type Gap } from "./decide";
import type { Demand } from "./types";

// Two questions, neither of which costs a model call: does the schema accept
// what the model is supposed to say and refuse what it is not, and is the JSON
// Schema it compiles to one the API's strict mode will actually take?

function demand(over: Partial<Demand> = {}): Demand {
  return {
    campaignId: "c1",
    campaignTitle: "Launch",
    type: "post",
    planned: 3,
    delivered: 0,
    outstanding: 3,
    allowedChannels: ["linkedin", "instagram"],
    defaultChannel: "linkedin",
    weeklyCap: 3,
    notes: [],
    ...over,
  };
}

const GAPS: Gap[] = expandGapIds([demand()]);

function fill(over: Record<string, unknown> = {}) {
  return {
    gap_id: GAPS[0].gap_id,
    campaign_id: "c1",
    channel: "linkedin",
    theme: "Why three quotes per job is not diligence",
    brief: "Open on the hour it costs.",
    rationale: "Pillar: process",
    body: ["Name the cost.", "Show the fix."],
    hook: "Three quotes per job is not diligence.",
    cta: "Book the check on the site.",
    ...over,
  };
}

describe("fillsSchema", () => {
  it("accepts a well-formed answer", () => {
    expect(fillsSchema(GAPS).safeParse({ fills: [fill()] }).success).toBe(true);
  });

  it("accepts a null campaign, which is a piece planned from pillars", () => {
    expect(
      fillsSchema(GAPS).safeParse({ fills: [fill({ campaign_id: null })] }).success
    ).toBe(true);
  });

  it("refuses a gap nobody asked about", () => {
    // The whole reason the schema is built per request. Before this, an
    // invented gap_id arrived, was dropped, and cost a warning.
    const out = fillsSchema(GAPS).safeParse({ fills: [fill({ gap_id: "c1__post__99" })] });
    expect(out.success).toBe(false);
  });

  it("names exactly the gaps of the call it was built for", () => {
    const other = expandGapIds([demand({ campaignId: "c2" })]);
    const schema = fillsSchema(GAPS);
    for (const g of GAPS) {
      expect(schema.safeParse({ fills: [fill({ gap_id: g.gap_id })] }).success, g.gap_id).toBe(true);
    }
    for (const g of other) {
      expect(schema.safeParse({ fills: [fill({ gap_id: g.gap_id })] }).success, g.gap_id).toBe(false);
    }
  });

  it("refuses a channel the product has never heard of", () => {
    expect(fillsSchema(GAPS).safeParse({ fills: [fill({ channel: "tiktok" })] }).success).toBe(false);
  });

  it("does not police per-gap channel rules, which parseFills still does", () => {
    // allowed_channels varies by gap and one array schema cannot say so. The
    // schema rules out a channel that does not exist; the parser rules out one
    // that exists but is not allowed here. Recorded so the split stays clear.
    const twitterOnly = expandGapIds([
      demand({ allowedChannels: ["linkedin"], defaultChannel: "linkedin" }),
    ]);
    const out = fillsSchema(twitterOnly).safeParse({
      fills: [fill({ gap_id: twitterOnly[0].gap_id, channel: "twitter" })],
    });
    expect(out.success).toBe(true);
  });

  it("does not clamp lengths, because a long theme should be trimmed not rejected", () => {
    const out = fillsSchema(GAPS).safeParse({ fills: [fill({ theme: "x".repeat(500) })] });
    expect(out.success).toBe(true);
  });

  it("refuses a missing field rather than defaulting it", () => {
    const withoutCta: Record<string, unknown> = fill();
    delete withoutCta.cta;
    expect(fillsSchema(GAPS).safeParse({ fills: [withoutCta] }).success).toBe(false);
  });

  it("accepts an empty answer, which the parser turns into a skeleton", () => {
    expect(fillsSchema(GAPS).safeParse({ fills: [] }).success).toBe(true);
  });
});

describe("fillsSchema — what the API is actually sent", () => {
  // The schema is only worth anything if strict mode accepts it. These are the
  // rules that mode enforces, checked against the compiled JSON Schema rather
  // than assumed — a violation is a 400 at runtime, on a paid call.
  const format = zodResponseFormat(fillsSchema(GAPS), "planner_fills");
  const root = format.json_schema.schema as Record<string, never>;

  it("is marked strict", () => {
    expect(format.json_schema.strict).toBe(true);
  });

  function everyObject(node: unknown, seen: Record<string, unknown>[] = []) {
    if (!node || typeof node !== "object") return seen;
    const n = node as Record<string, unknown>;
    if (n.type === "object") seen.push(n);
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach((v) => everyObject(v, seen));
      else everyObject(value, seen);
    }
    return seen;
  }

  it("closes every object, which strict mode requires", () => {
    const objects = everyObject(root);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
  });

  it("requires every property of every object, the other strict-mode rule", () => {
    for (const o of everyObject(root)) {
      const properties = Object.keys((o.properties ?? {}) as Record<string, unknown>);
      expect(new Set(o.required as string[])).toEqual(new Set(properties));
    }
  });

  it("carries the gap ids into the wire format as an enum", () => {
    expect(JSON.stringify(root)).toContain(GAPS[0].gap_id);
  });
});

describe("the schema is not the parser", () => {
  it("expresses only what a schema can, which is why parseFills stays", () => {
    // A guard against a future tidy-up that deletes the parser because "the
    // schema handles it". These four are domain rules, not shapes.
    const schema = fillsSchema(GAPS);
    const shaped = { fills: [fill({ campaign_id: "not-eligible", theme: "y".repeat(400) })] };
    expect(schema.safeParse(shaped).success).toBe(true);
  });

  it("is a zod schema, so it composes like the rest of them", () => {
    expect(fillsSchema(GAPS)).toBeInstanceOf(z.ZodType);
  });
});
