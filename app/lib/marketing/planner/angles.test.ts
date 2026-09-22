import { describe, it, expect } from "vitest";
import { allocate, allocationSourceOf, angleSequence } from "./angles";
import { POSITIONING_ANGLES, anglesOf } from "../brand";

// The guarantee this file exists to defend: eight gaps get eight different
// arguments to make, whatever the strategy looks like. Everything else here is
// about degrading gracefully when a client has filled in very little.

const STRATEGY = {
  positioning: {
    primary_angle: { type: "unique_mechanism" },
    secondary_angles: [{ type: "contrarian" }],
  },
  content_strategy: {
    content_pillars: ["The first 24 hours", "What the whiteboard costs you"],
  },
  icp: {
    pain_points: ["Three quotes per job", "Quotes go out two days late"],
    objections: ["We already have a process"],
    trigger_events: ["Hiring a second crew"],
  },
  messaging: {
    proof_points: ["Average quote turnaround: 4 hours"],
    value_props: ["Quote on site before you leave the driveway"],
  },
};

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c1__post__${i}`);

describe("angleSequence", () => {
  it("is always the full eight, reordered rather than truncated", () => {
    // This is what makes the eight-distinct-angles guarantee hold even for a
    // brand that named only one angle.
    const seq = angleSequence(anglesOf(STRATEGY));
    expect(seq).toHaveLength(POSITIONING_ANGLES.length);
    expect(new Set(seq.map((a) => a.type)).size).toBe(POSITIONING_ANGLES.length);
  });

  it("leads with the brand's own, in the order the brand chose them", () => {
    const seq = angleSequence(anglesOf(STRATEGY));
    expect(seq.slice(0, 2).map((a) => a.type)).toEqual(["unique_mechanism", "contrarian"]);
  });

  it("is the canonical order when the brand has chosen nothing", () => {
    expect(angleSequence([])).toEqual(POSITIONING_ANGLES);
  });
});

describe("allocate", () => {
  const source = allocationSourceOf(STRATEGY);

  it("gives eight pieces eight different angles", () => {
    const { allocations } = allocate(ids(8), source);
    const angles = ids(8).map((id) => allocations.get(id)!.angle.type);
    expect(new Set(angles).size).toBe(8);
  });

  it("gives every gap an allocation", () => {
    const { allocations } = allocate(ids(5), source);
    expect(allocations.size).toBe(5);
  });

  it("is stable: the same inputs allocate the same way every time", () => {
    // Nothing here is randomised, which is what lets a regenerated preview be
    // compared against the one before it.
    const a = allocate(ids(8), source).allocations;
    const b = allocate(ids(8), source).allocations;
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("rotates pillars and entry points independently of angles", () => {
    const { allocations } = allocate(ids(4), source);
    const pillars = ids(4).map((id) => allocations.get(id)!.pillar);
    expect(pillars).toEqual([
      "The first 24 hours",
      "What the whiteboard costs you",
      "The first 24 hours",
      "What the whiteboard costs you",
    ]);
  });

  it("spends every entry point before reusing one", () => {
    const { allocations } = allocate(ids(6), source);
    const used = ids(6).map((id) => allocations.get(id)!.entryPoint);
    expect(new Set(used).size).toBe(6);
  });

  it("still gives eight distinct angles to a brand with one pillar and one angle", () => {
    // The thin-strategy case, and the one that matters: a client who has filled
    // in almost nothing must still not get eight versions of one argument.
    const thin = allocationSourceOf({
      positioning: { primary_angle: { type: "enemy" } },
      content_strategy: { content_pillars: ["Operations"] },
      icp: { pain_points: ["Paperwork"] },
    });
    const { allocations } = allocate(ids(8), thin);
    const angles = ids(8).map((id) => allocations.get(id)!.angle.type);
    expect(new Set(angles).size).toBe(8);
    expect(angles[0]).toBe("enemy");
  });

  it("allocates across the whole run, not per content type", () => {
    // Restarting the rotation per type would hand post 1 and carousel 1 the
    // same angle — the same repetition in a tidier arrangement.
    const mixed = ["c1__post__0", "c1__post__1", "c1__carousel__0", "c1__reel__0"];
    const { allocations } = allocate(mixed, source);
    const angles = mixed.map((id) => allocations.get(id)!.angle.type);
    expect(new Set(angles).size).toBe(4);
  });
});

describe("allocate — what it says about a thin strategy", () => {
  it("warns when there are no pillars", () => {
    const { warnings } = allocate(ids(3), allocationSourceOf({ icp: { pain_points: ["a"] } }));
    expect(warnings.join(" ")).toContain("no content pillars");
  });

  it("warns, and says why it matters, when there is nothing to argue from", () => {
    const { warnings } = allocate(
      ids(3),
      allocationSourceOf({ content_strategy: { content_pillars: ["x"] } })
    );
    expect(warnings.join(" ")).toContain("no pain points");
    expect(warnings.join(" ")).toContain("single best thing");
  });

  it("warns when entry points have to be shared", () => {
    const { warnings } = allocate(ids(8), allocationSourceOf(STRATEGY));
    expect(warnings.join(" ")).toContain("8 pieces are sharing 6");
  });

  it("warns when a run asks for more pieces than there are angles", () => {
    const { warnings } = allocate(ids(12), allocationSourceOf(STRATEGY));
    expect(warnings.join(" ")).toContain("more than the 8 positioning angles");
  });

  it("says nothing at all about an empty run", () => {
    expect(allocate([], allocationSourceOf({})).warnings).toEqual([]);
  });

  it("still allocates when the strategy is empty", () => {
    const { allocations } = allocate(ids(3), allocationSourceOf(null));
    expect(allocations.get("c1__post__0")).toEqual({
      angle: POSITIONING_ANGLES[0],
      pillar: null,
      entryPoint: null,
    });
  });
});

describe("allocationSourceOf", () => {
  it("draws entry points from the ICP and messaging both", () => {
    // messaging is not in the planner's `business` payload, so proof points and
    // value props would be invisible if this read from there instead.
    const source = allocationSourceOf(STRATEGY);
    expect(source.entryPoints).toContain("Three quotes per job");
    expect(source.entryPoints).toContain("Average quote turnaround: 4 hours");
    expect(source.entryPoints).toContain("Quote on site before you leave the driveway");
  });

  it("puts the campaign's own angle first where it names a real one", () => {
    const source = allocationSourceOf(STRATEGY, "social_proof");
    expect(source.angles.map((a) => a.type)).toEqual([
      "social_proof",
      "unique_mechanism",
      "contrarian",
    ]);
  });

  it("ignores the campaign's angle when it is free text that names nothing", () => {
    // campaign.strategy.positioning_angle is written by the campaign model with
    // one line of guidance and no vocabulary, so most of the time it is prose.
    const source = allocationSourceOf(STRATEGY, "make them feel seen");
    expect(source.angles.map((a) => a.type)).toEqual(["unique_mechanism", "contrarian"]);
  });

  it("does not let the campaign's angle appear twice", () => {
    const source = allocationSourceOf(STRATEGY, "contrarian");
    expect(source.angles.map((a) => a.type)).toEqual(["contrarian", "unique_mechanism"]);
  });

  it("survives a strategy that is missing every section", () => {
    expect(allocationSourceOf({})).toEqual({ angles: [], pillars: [], entryPoints: [] });
  });
});
