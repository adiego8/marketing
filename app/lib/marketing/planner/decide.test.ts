import { describe, it, expect } from "vitest";
import { expandGapIds, parseFills, skeletonFills, chunkRequest, type GapRequest } from "./decide";
import {
  MAX_BODY_ITEMS,
  MAX_BODY_ITEM_CHARS,
  MAX_HOOK_CHARS,
  MAX_CTA_CHARS,
} from "./types";
import type { Gap } from "./types";

function gap(over: Partial<Gap> = {}): Gap {
  return {
    weekKey: "2026-W38",
    type: "post",
    quotaCount: 3,
    wanted: 3,
    existing: 0,
    existingPast: 0,
    deficit: 3,
    surplus: 0,
    allowedChannels: ["linkedin", "instagram"],
    defaultChannel: "linkedin",
    eligibleCampaignIds: ["c1"],
    partialWeek: false,
    notes: [],
    ...over,
  };
}

const GAPS: GapRequest[] = expandGapIds([gap()]);

describe("expandGapIds", () => {
  // A gap of "post x 3" must become three ids. One gap yielding one theme
  // would produce three identical posts.
  it("expands a deficit into one entry per missing piece", () => {
    expect(GAPS).toHaveLength(3);
    expect(GAPS.map((g) => g.gap_id)).toEqual([
      "2026-W38__post__0",
      "2026-W38__post__1",
      "2026-W38__post__2",
    ]);
  });

  it("tells the model which of N it is writing, so they differ", () => {
    expect(GAPS[1].index_in_week).toBe(1);
    expect(GAPS[1].of_in_week).toBe(3);
  });

  it("produces nothing for a gap with no deficit", () => {
    expect(expandGapIds([gap({ deficit: 0 })])).toHaveLength(0);
  });
});

describe("chunkRequest", () => {
  const base = {
    today: "2026-09-05",
    timezone: "America/New_York",
    business: {},
    content_pillars: [],
    campaigns: [],
    recent_themes: [],
  };

  it("leaves a small request in one call", () => {
    expect(chunkRequest({ ...base, gaps: GAPS })).toHaveLength(1);
  });

  it("splits a large request by week so one failure degrades only its own gaps", () => {
    const many = [
      ...expandGapIds([gap({ weekKey: "2026-W38", deficit: 3 })]),
      ...expandGapIds([gap({ weekKey: "2026-W39", deficit: 3 })]),
    ];
    expect(chunkRequest({ ...base, gaps: many }, 4)).toHaveLength(2);
  });
});

describe("parseFills", () => {
  const good = {
    fills: [
      {
        gap_id: "2026-W38__post__0",
        campaign_id: "c1",
        channel: "instagram",
        theme: "A real angle",
        brief: "Some direction",
        rationale: "Because",
      },
    ],
  };

  it("accepts a well-formed fill", () => {
    const { fills } = parseFills(good, GAPS);
    const filled = fills.find((f) => f.gapId === "2026-W38__post__0")!;
    expect(filled.theme).toBe("A real angle");
    expect(filled.channel).toBe("instagram");
    expect(filled.campaignId).toBe("c1");
    expect(filled.needsTheme).toBe(false);
  });

  // The structural guarantee: the output set is seeded with skeletons, so it is
  // always exactly the requested gap ids no matter what comes back.
  it("always returns exactly one fill per requested gap", () => {
    for (const raw of [good, {}, { fills: null }, null, "nonsense", { fills: [] }]) {
      const { fills } = parseFills(raw, GAPS);
      expect(fills.map((f) => f.gapId).sort()).toEqual(GAPS.map((g) => g.gap_id).sort());
    }
  });

  it("keeps a dated skeleton when the response is unusable", () => {
    const { fills, warnings } = parseFills({ fills: "not an array" }, GAPS);
    expect(fills.every((f) => f.needsTheme)).toBe(true);
    expect(fills.every((f) => f.channel === "linkedin")).toBe(true);
    expect(warnings.join(" ")).toContain("no usable fills");
  });

  it("drops a fill for a gap that was never requested", () => {
    const { warnings } = parseFills({ fills: [{ gap_id: "made-up" }] }, GAPS);
    expect(warnings.join(" ")).toContain("unknown gap");
  });

  it("ignores a duplicate fill for the same gap", () => {
    const { warnings } = parseFills(
      { fills: [good.fills[0], { ...good.fills[0], theme: "Second" }] },
      GAPS
    );
    expect(warnings.join(" ")).toContain("duplicate");
  });

  it("falls back to the default channel when the model picks a disallowed one", () => {
    const { fills, warnings } = parseFills(
      { fills: [{ ...good.fills[0], channel: "tiktok" }] },
      GAPS
    );
    expect(fills.find((f) => f.gapId === "2026-W38__post__0")?.channel).toBe("linkedin");
    expect(warnings.join(" ")).toContain("not allowed");
  });

  it("drops a campaign the gap is not eligible for", () => {
    const { fills, warnings } = parseFills(
      { fills: [{ ...good.fills[0], campaign_id: "someone-elses" }] },
      GAPS
    );
    expect(fills.find((f) => f.gapId === "2026-W38__post__0")?.campaignId).toBeNull();
    expect(warnings.join(" ")).toContain("not eligible");
  });

  it("flags a missing theme rather than inventing one", () => {
    const { fills, warnings } = parseFills(
      { fills: [{ gap_id: "2026-W38__post__0", channel: "linkedin" }] },
      GAPS
    );
    expect(fills.find((f) => f.gapId === "2026-W38__post__0")?.needsTheme).toBe(true);
    expect(warnings.join(" ")).toContain("No theme");
  });

  it("truncates text that would bloat the stored document", () => {
    const { fills } = parseFills(
      { fills: [{ ...good.fills[0], theme: "x".repeat(500), brief: "y".repeat(2000) }] },
      GAPS
    );
    const filled = fills.find((f) => f.gapId === "2026-W38__post__0")!;
    expect(filled.theme.length).toBe(120);
    expect(filled.brief.length).toBe(500);
  });

  it("reports how many slots the model skipped", () => {
    const { warnings } = parseFills(good, GAPS);
    expect(warnings.join(" ")).toContain("no fill for 2 slot(s)");
  });
});

describe("skeletonFills", () => {
  it("produces a placeable fill for every gap", () => {
    const fills = skeletonFills(GAPS);
    expect(fills).toHaveLength(3);
    expect(fills.every((f) => f.needsTheme && f.channel === "linkedin")).toBe(true);
  });
});

describe("parseFills — the piece structure", () => {
  const gaps = [
    {
      gap_id: "2026-W38__post__0",
      week: "2026-W38",
      type: "post",
      index_in_week: 0,
      of_in_week: 1,
      allowed_channels: ["linkedin", "instagram"],
      default_channel: "linkedin",
      eligible_campaign_ids: ["c1"],
    },
  ] as unknown as Parameters<typeof parseFills>[1];

  function fillFor(entry: Record<string, unknown>) {
    const { fills } = parseFills(
      { fills: [{ gap_id: "2026-W38__post__0", theme: "A theme", ...entry }] },
      gaps
    );
    return fills[0];
  }

  it("carries hook, body and cta through", () => {
    const f = fillFor({
      hook: "Three quotes is not diligence.",
      body: ["Name the ritual.", "Do the arithmetic.", "Offer the fix."],
      cta: "Reply with your last job.",
    });
    expect(f.hook).toBe("Three quotes is not diligence.");
    expect(f.body).toEqual(["Name the ritual.", "Do the arithmetic.", "Offer the fix."]);
    expect(f.cta).toBe("Reply with your last job.");
  });

  it("caps body on both axes", () => {
    // A plan run embeds every slot, so an unbounded body[] is what would
    // actually breach Firestore's 1 MiB document limit.
    const f = fillFor({
      body: Array.from({ length: 40 }, () => "x".repeat(2000)),
    });
    expect(f.body).toHaveLength(MAX_BODY_ITEMS);
    expect(f.body[0].length).toBe(MAX_BODY_ITEM_CHARS);
  });

  it("caps hook and cta", () => {
    const f = fillFor({ hook: "h".repeat(900), cta: "c".repeat(900) });
    expect(f.hook.length).toBe(MAX_HOOK_CHARS);
    expect(f.cta.length).toBe(MAX_CTA_CHARS);
  });

  it("absorbs a single string where an array was asked for", () => {
    // A common model slip. One beat beats none.
    expect(fillFor({ body: "Just the one beat." }).body).toEqual([
      "Just the one beat.",
    ]);
  });

  it("drops empty entries and non-arrays without throwing", () => {
    expect(fillFor({ body: ["a", "", "   ", "b"] }).body).toEqual(["a", "b"]);
    expect(fillFor({ body: 42 }).body).toEqual([]);
    expect(fillFor({ body: null }).body).toEqual([]);
    expect(fillFor({}).body).toEqual([]);
  });

  it("gives skeletons an empty structure rather than undefined", () => {
    // The degraded path must still produce a renderable slot.
    const [skeleton] = skeletonFills(gaps);
    expect(skeleton.hook).toBe("");
    expect(skeleton.body).toEqual([]);
    expect(skeleton.cta).toBe("");
  });
});
