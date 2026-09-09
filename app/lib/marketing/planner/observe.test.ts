import { describe, expect, it } from "vitest";
import { defaultChannelFor, deliveredByType, observe, resolveChannels } from "./observe";
import type { CampaignWindow, ExistingSlot } from "./types";
import type { QuotaEntry } from "../strategy";

// These replace the week-arithmetic suite that used to live here — proration,
// eligible posting days, per-day capacity. None of it happens any more:
// planning decides WHAT a campaign is owed and a person decides WHEN.

function campaign(over: Partial<CampaignWindow> = {}): CampaignWindow {
  return {
    id: "c1",
    title: "Setup Without Guesswork",
    description: "",
    startDate: "2026-09-14",
    endDate: "2026-10-14",
    goal: "",
    keyMessage: "",
    plannedByType: { post: 4, carousel: 2 },
    plannedTotal: 6,
    channels: ["instagram"],
    timeline: [],
    ...over,
  };
}

function slot(over: Partial<ExistingSlot> = {}): ExistingSlot {
  return {
    id: "s1",
    date: "2026-09-20",
    type: "post",
    channel: "instagram",
    status: "planned",
    campaignId: "c1",
    pinned: false,
    ...over,
  };
}

function run(over: {
  campaigns?: CampaignWindow[];
  slots?: ExistingSlot[];
  quota?: Record<string, QuotaEntry>;
  strategyChannels?: ("linkedin" | "instagram" | "twitter" | "email")[];
} = {}) {
  return observe({
    quota: over.quota ?? {},
    slots: over.slots ?? [],
    campaigns: over.campaigns ?? [campaign()],
    strategyChannels: over.strategyChannels ?? [],
  });
}

describe("deliveredByType", () => {
  it("counts what a campaign has already been given", () => {
    const counts = deliveredByType(
      [slot({ id: "a" }), slot({ id: "b" }), slot({ id: "c", type: "carousel" })],
      "c1"
    );
    expect(counts).toEqual({ post: 2, carousel: 1 });
  });

  // The whole point of dating being a separate step: a piece accepted this
  // morning and not yet given a day is delivered. Counting only dated slots
  // would re-propose everything sitting unscheduled.
  it("counts an accepted piece that has no date yet", () => {
    expect(deliveredByType([slot({ date: null })], "c1")).toEqual({ post: 1 });
  });

  it("ignores slots belonging to another campaign", () => {
    expect(deliveredByType([slot({ campaignId: "other" })], "c1")).toEqual({});
  });

  it("frees a cancelled or skipped piece, so it is owed again", () => {
    const counts = deliveredByType(
      [slot({ id: "a", status: "cancelled" }), slot({ id: "b", status: "skipped" })],
      "c1"
    );
    expect(counts).toEqual({});
  });

  it("counts every status that consumes the plan", () => {
    const counts = deliveredByType(
      ["planned", "confirmed", "drafted", "posted"].map((status, i) =>
        slot({ id: `s${i}`, status })
      ),
      "c1"
    );
    expect(counts).toEqual({ post: 4 });
  });
});

describe("observe", () => {
  it("owes the campaign's whole content plan when nothing is delivered", () => {
    const o = run();
    expect(o.totalOutstanding).toBe(6);
    expect(o.demand.map((d) => [d.type, d.outstanding])).toEqual([
      ["post", 4],
      ["carousel", 2],
    ]);
  });

  it("subtracts what has already been delivered", () => {
    const o = run({ slots: [slot({ id: "a" }), slot({ id: "b" })] });
    const post = o.demand.find((d) => d.type === "post")!;
    expect(post.delivered).toBe(2);
    expect(post.outstanding).toBe(2);
    expect(o.totalOutstanding).toBe(4);
  });

  it("drops a type once it is fully delivered", () => {
    const o = run({
      slots: Array.from({ length: 4 }, (_, i) => slot({ id: `s${i}` })),
    });
    expect(o.demand.map((d) => d.type)).toEqual(["carousel"]);
  });

  // The regression test for the bug this whole change came from: a campaign
  // starting later than the run used to have its pieces generated in weeks it
  // was not running, where nothing could carry them.
  it("owes the same regardless of the campaign's start date", () => {
    const early = run({ campaigns: [campaign({ startDate: "2020-01-01" })] });
    const later = run({ campaigns: [campaign({ startDate: "2099-01-01" })] });
    expect(later.totalOutstanding).toBe(early.totalOutstanding);
  });

  it("names the campaign on every demand row", () => {
    const o = run();
    expect(o.demand.every((d) => d.campaignId === "c1")).toBe(true);
    expect(o.demand.every((d) => d.campaignTitle === "Setup Without Guesswork")).toBe(true);
  });

  it("keeps two campaigns wanting the same type apart", () => {
    const o = run({
      campaigns: [
        campaign({ id: "c1", plannedByType: { post: 2 }, plannedTotal: 2 }),
        campaign({ id: "c2", title: "Second", plannedByType: { post: 3 }, plannedTotal: 3 }),
      ],
      slots: [slot({ id: "a", campaignId: "c1" })],
    });
    expect(o.demand.map((d) => [d.campaignId, d.outstanding])).toEqual([
      ["c1", 1],
      ["c2", 3],
    ]);
  });

  it("reports each campaign's standing", () => {
    const o = run({ slots: [slot({ id: "a" })] });
    expect(o.campaigns).toEqual([
      {
        campaignId: "c1",
        title: "Setup Without Guesswork",
        plannedTotal: 6,
        delivered: 1,
        outstanding: 5,
        typesNeeded: ["post", "carousel"],
      },
    ]);
  });

  it("says so when there is no campaign at all", () => {
    const o = run({ campaigns: [] });
    expect(o.totalOutstanding).toBe(0);
    expect(o.warnings.join(" ")).toContain("No active campaigns");
  });

  it("says so when every plan is delivered", () => {
    const o = run({
      campaigns: [campaign({ plannedByType: { post: 1 }, plannedTotal: 1 })],
      slots: [slot({ id: "a" })],
    });
    expect(o.demand).toEqual([]);
    expect(o.warnings.join(" ")).toContain("fully delivered");
  });

  it("says so when a campaign's content plan is empty", () => {
    const o = run({ campaigns: [campaign({ plannedByType: {}, plannedTotal: 0 })] });
    expect(o.warnings.join(" ")).toContain("no content plan breakdown");
  });

  it("warns about a status it does not recognise rather than counting it", () => {
    const o = run({ slots: [slot({ status: "vibing" })] });
    expect(o.warnings.join(" ")).toContain("vibing");
    expect(o.demand.find((d) => d.type === "post")!.outstanding).toBe(4);
  });

  it("reports pinned slots so the commit never touches them", () => {
    const o = run({ slots: [slot({ id: "keep", pinned: true })] });
    expect(o.pinnedSlotIds).toEqual(["keep"]);
  });

  it("carries the quota's cap without applying it", () => {
    const o = run({ quota: { post: { count: 3, channels: [] } } });
    const post = o.demand.find((d) => d.type === "post")!;
    // Capped at 3 a week, but 4 are still owed: pacing happens when a human
    // picks days, not here.
    expect(post.weeklyCap).toBe(3);
    expect(post.outstanding).toBe(4);
  });
});

describe("resolveChannels", () => {
  const c = campaign();

  it("prefers the quota entry's channels", () => {
    const { channels, note } = resolveChannels(
      "post",
      { count: 3, channels: ["linkedin"] },
      c,
      ["twitter"]
    );
    expect(channels).toEqual(["linkedin"]);
    expect(note).toBeNull();
  });

  it("falls back to the campaign's channels, and says so", () => {
    const { channels, note } = resolveChannels("post", { count: 0, channels: [] }, c, [
      "twitter",
    ]);
    expect(channels).toEqual(["instagram"]);
    expect(note).toContain("campaign");
  });

  it("then the strategy's platforms", () => {
    const { channels, note } = resolveChannels(
      "post",
      { count: 0, channels: [] },
      campaign({ channels: [] }),
      ["twitter"]
    );
    expect(channels).toEqual(["twitter"]);
    expect(note).toContain("strategy");
  });

  it("and allows everything when nothing says otherwise", () => {
    const { channels, note } = resolveChannels(
      "post",
      { count: 0, channels: [] },
      campaign({ channels: [] }),
      []
    );
    expect(channels).toEqual(["linkedin", "instagram", "twitter", "email"]);
    expect(note).toContain("every channel");
  });
});

describe("defaultChannelFor", () => {
  it("rotates so a campaign's types do not all land on one platform", () => {
    const channels = ["linkedin", "instagram"] as const;
    expect(defaultChannelFor([...channels], 0)).toBe("linkedin");
    expect(defaultChannelFor([...channels], 1)).toBe("instagram");
    expect(defaultChannelFor([...channels], 2)).toBe("linkedin");
  });

  it("falls back rather than returning undefined for an empty list", () => {
    expect(defaultChannelFor([], 0)).toBe("linkedin");
  });
});
