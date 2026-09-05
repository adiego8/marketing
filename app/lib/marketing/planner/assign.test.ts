import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { assign, candidateDays, orderFills, pickTime } from "./assign";
import { slugSegment, mintSlotId } from "./slot-id";
import type { CampaignWindow, ExistingSlot, Fill, Gap } from "./types";
import type { WeekSpan } from "./weeks";

const NY = "America/New_York";
const SAT_10AM = DateTime.fromISO("2026-09-05T10:00", { zone: NY });
/** A fully-future week: Mon 2026-09-14 to Sun 2026-09-20. */
const W38: WeekSpan = { weekKey: "2026-W38", start: "2026-09-14", end: "2026-09-20" };

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
    allowedChannels: ["linkedin"],
    defaultChannel: "linkedin",
    eligibleCampaignIds: [],
    partialWeek: false,
    notes: [],
    ...over,
  };
}

function fill(gapId: string, over: Partial<Fill> = {}): Fill {
  return {
    gapId,
    campaignId: null,
    channel: "linkedin",
    theme: "A theme",
    brief: "",
    rationale: "",
    needsTheme: false,
    ...over,
  };
}

function run(fills: Fill[], gaps: Map<string, Gap>, over: Partial<Parameters<typeof assign>[0]> = {}) {
  return assign({
    clientId: "cli",
    timezone: NY,
    now: SAT_10AM.toJSDate(),
    spans: [W38],
    gapsByGapId: gaps,
    fills,
    existing: [],
    campaigns: new Map(),
    ...over,
  });
}

describe("slugSegment", () => {
  it("makes a free-form quota key safe for a document id", () => {
    expect(slugSegment("post_alt")).toBe("post-alt");
    expect(slugSegment("Blog / Long-form")).toBe("blog-long-form");
  });

  it("never returns an empty segment", () => {
    expect(slugSegment("///")).toBe("x");
  });
});

describe("mintSlotId", () => {
  it("advances past an id that is already taken", () => {
    const taken = new Set(["cli__2026-09-15__post__linkedin__0"]);
    expect(mintSlotId(taken, "cli", "2026-09-15", "post", "linkedin")).toBe(
      "cli__2026-09-15__post__linkedin__1"
    );
  });
});

describe("orderFills", () => {
  it("places the most constrained channel first", () => {
    // LinkedIn posts 3 weekdays, Instagram all 7. If Instagram goes first it
    // takes the shared Tue-Thu capacity and LinkedIn has nowhere to go.
    const gaps = new Map([
      ["g1", gap({ allowedChannels: ["instagram"] })],
      ["g2", gap()],
    ]);
    const ordered = orderFills(
      [fill("g1", { channel: "instagram" }), fill("g2", { channel: "linkedin" })],
      gaps
    );
    expect(ordered[0].channel).toBe("linkedin");
  });
});

describe("pickTime", () => {
  it("returns the channel's first preferred time when the day is free", () => {
    expect(pickTime("2026-09-15", "linkedin", NY, SAT_10AM, [])).toBe("09:00");
  });

  it("skips a time within the minimum gap of an existing post on that channel", () => {
    // 09:00 is taken; 08:00 and 10:00 are both within 120 minutes, so the only
    // remaining LinkedIn window is unusable and it returns null.
    const time = pickTime("2026-09-15", "linkedin", NY, SAT_10AM, [
      { channel: "linkedin", timeLocal: "09:00" },
    ]);
    expect(time).toBeNull();
  });

  it("ignores a clash on a different channel", () => {
    expect(
      pickTime("2026-09-15", "linkedin", NY, SAT_10AM, [
        { channel: "instagram", timeLocal: "09:00" },
      ])
    ).toBe("09:00");
  });
});

describe("candidateDays", () => {
  it("returns only the channel's posting weekdays", () => {
    const days = candidateDays(W38, "linkedin", NY, SAT_10AM, undefined, new Map());
    expect(days).toEqual(["2026-09-15", "2026-09-16", "2026-09-17"]);
  });

  it("clamps to the campaign window", () => {
    const campaign: CampaignWindow = {
      id: "c1",
      title: "C",
      description: "",
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      goal: "",
      keyMessage: "",
      plannedByType: {},
      plannedTotal: 0,
      channels: [],
      timeline: [],
    };
    expect(candidateDays(W38, "linkedin", NY, SAT_10AM, campaign, new Map())).toEqual([
      "2026-09-16",
    ]);
  });

  it("excludes a day already at the daily cap", () => {
    const load = new Map([["2026-09-15", 2]]);
    const days = candidateDays(W38, "linkedin", NY, SAT_10AM, undefined, load);
    expect(days).not.toContain("2026-09-15");
  });
});

describe("assign", () => {
  it("spreads three fills across three distinct days rather than stacking", () => {
    const gaps = new Map([
      ["g0", gap()],
      ["g1", gap()],
      ["g2", gap()],
    ]);
    const { proposed, deferred } = run([fill("g0"), fill("g1"), fill("g2")], gaps);

    expect(deferred).toHaveLength(0);
    expect(proposed).toHaveLength(3);
    expect(new Set(proposed.map((p) => p.date)).size).toBe(3);
  });

  it("produces a correct UTC instant for each local time", () => {
    const gaps = new Map([["g0", gap()]]);
    const { proposed } = run([fill("g0")], gaps);
    // 09:00 New York in September is UTC-4.
    expect(proposed[0].timeLocal).toBe("09:00");
    expect(proposed[0].scheduledAt).toBe("2026-09-15T13:00:00.000Z");
  });

  it("respects the daily cap set by slots that already exist", () => {
    const existing: ExistingSlot[] = [
      {
        id: "e1",
        date: "2026-09-15",
        timeLocal: "09:00",
        weekKey: "2026-W38",
        type: "post",
        channel: "linkedin",
        status: "planned",
        campaignId: null,
        pinned: true,
      },
      {
        id: "e2",
        date: "2026-09-15",
        timeLocal: "13:00",
        weekKey: "2026-W38",
        type: "hook",
        channel: "instagram",
        status: "planned",
        campaignId: null,
        pinned: false,
      },
    ];
    const gaps = new Map([["g0", gap()]]);
    const { proposed } = run([fill("g0")], gaps, { existing });
    // Tuesday is full (2 slots, including a pinned one), so it must move on.
    expect(proposed[0].date).not.toBe("2026-09-15");
  });

  it("defers with a readable reason when the campaign window leaves no day", () => {
    const campaign: CampaignWindow = {
      id: "c1",
      title: "Weekend Push",
      description: "",
      // Saturday and Sunday only: LinkedIn cannot post then.
      startDate: "2026-09-19",
      endDate: "2026-09-20",
      goal: "",
      keyMessage: "",
      plannedByType: {},
      plannedTotal: 0,
      channels: [],
      timeline: [],
    };
    const gaps = new Map([["g0", gap()]]);
    const { proposed, deferred } = run([fill("g0", { campaignId: "c1" })], gaps, {
      campaigns: new Map([["c1", campaign]]),
    });

    expect(proposed).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    expect(deferred[0].reason).toContain("Weekend Push");
  });

  it("never places a slot outside its campaign window", () => {
    const campaign: CampaignWindow = {
      id: "c1",
      title: "C",
      description: "",
      startDate: "2026-09-16",
      endDate: "2026-09-17",
      goal: "",
      keyMessage: "",
      plannedByType: {},
      plannedTotal: 0,
      channels: [],
      timeline: [],
    };
    const gaps = new Map([
      ["g0", gap()],
      ["g1", gap()],
    ]);
    const { proposed } = run(
      [fill("g0", { campaignId: "c1" }), fill("g1", { campaignId: "c1" })],
      gaps,
      { campaigns: new Map([["c1", campaign]]) }
    );
    for (const slot of proposed) {
      expect(slot.date >= "2026-09-16" && slot.date <= "2026-09-17").toBe(true);
    }
  });

  it("returns slots in chronological order", () => {
    const gaps = new Map([
      ["g0", gap()],
      ["g1", gap()],
      ["g2", gap()],
    ]);
    const { proposed } = run([fill("g0"), fill("g1"), fill("g2")], gaps);
    const keys = proposed.map((p) => `${p.date}T${p.timeLocal}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("is deterministic across runs", () => {
    const build = () =>
      new Map([
        ["g0", gap()],
        ["g1", gap()],
      ]);
    const a = run([fill("g0"), fill("g1")], build());
    const b = run([fill("g0"), fill("g1")], build());
    expect(a.proposed.map((p) => p.slotId)).toEqual(b.proposed.map((p) => p.slotId));
  });

  it("mints unique slot ids", () => {
    const gaps = new Map([
      ["g0", gap()],
      ["g1", gap()],
      ["g2", gap()],
    ]);
    const { proposed } = run([fill("g0"), fill("g1"), fill("g2")], gaps);
    expect(new Set(proposed.map((p) => p.slotId)).size).toBe(proposed.length);
  });
});
