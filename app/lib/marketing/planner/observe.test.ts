import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  observe,
  proratedWanted,
  eligibleDays,
  apportion,
  resolveChannels,
  rankCampaigns,
} from "./observe";
import type { CampaignWindow, ExistingSlot } from "./types";
import type { WeekSpan } from "./weeks";

const NY = "America/New_York";

/** Saturday 2026-09-05, 10:00 local. Two calendar days left in 2026-W36. */
const SAT_10AM = DateTime.fromISO("2026-09-05T10:00", { zone: NY });
const W36: WeekSpan = { weekKey: "2026-W36", start: "2026-08-31", end: "2026-09-06" };
const W38: WeekSpan = { weekKey: "2026-W38", start: "2026-09-14", end: "2026-09-20" };

function slot(over: Partial<ExistingSlot> = {}): ExistingSlot {
  return {
    id: "s1",
    date: "2026-09-16",
    timeLocal: "09:00",
    weekKey: "2026-W38",
    type: "post",
    channel: "linkedin",
    status: "planned",
    campaignId: null,
    pinned: false,
    ...over,
  };
}

describe("proratedWanted", () => {
  // Each row is a decision about how aggressive the planner is late in a week.
  it("asks for the full quota when the whole week is ahead", () => {
    expect(proratedWanted(4, 0, 7)).toBe(4);
  });

  it("asks for only a share of the quota on the last day", () => {
    // Sunday with nothing done: 1, not 4. Cramming four posts into one day is
    // worse than missing three.
    expect(proratedWanted(4, 0, 1)).toBe(1);
  });

  it("credits what already went out earlier in the week", () => {
    // Friday, 2 already posted, 3 days left -> ceil(4*3/7)=2, +2 past = 4.
    expect(proratedWanted(4, 2, 3)).toBe(4);
  });

  it("asks for nothing more once the week is over", () => {
    expect(proratedWanted(4, 1, 0)).toBe(1);
  });

  it("never exceeds the weekly quota", () => {
    expect(proratedWanted(4, 4, 3)).toBe(4);
  });
});

describe("eligibleDays", () => {
  // The bug this function exists to prevent: counting calendar days would give
  // 2 here and schedule LinkedIn posts onto a weekend.
  it("returns zero days when the channel cannot post on the days that remain", () => {
    expect(eligibleDays(W36, ["linkedin"], NY, SAT_10AM)).toEqual([]);
  });

  it("still finds days for a channel that posts every day", () => {
    const days = eligibleDays(W36, ["instagram"], NY, SAT_10AM);
    expect(days).toEqual(["2026-09-05", "2026-09-06"]);
  });

  it("returns each channel's posting weekdays for a fully future week", () => {
    // LinkedIn posts Tue-Thu.
    expect(eligibleDays(W38, ["linkedin"], NY, SAT_10AM)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
    ]);
  });

  it("drops today when every posting window has already passed", () => {
    // 20:00 on a Wednesday: LinkedIn's latest window (10:00) is long gone.
    const wedEvening = DateTime.fromISO("2026-09-16T20:00", { zone: NY });
    expect(eligibleDays(W38, ["linkedin"], NY, wedEvening)).toEqual(["2026-09-17"]);
  });
});

describe("apportion", () => {
  it("leaves deficits alone when they fit", () => {
    expect(apportion([2, 1], 8)).toEqual([2, 1]);
  });

  it("trims to exactly the capacity using largest remainder", () => {
    const result = apportion([5, 4, 2], 8);
    expect(result.reduce((a, b) => a + b, 0)).toBe(8);
    expect(result).toEqual([4, 3, 1]);
  });

  it("handles a capacity of zero", () => {
    expect(apportion([3, 2], 0)).toEqual([0, 0]);
  });
});

describe("resolveChannels", () => {
  it("prefers the channels named on the quota entry", () => {
    const { channels, note } = resolveChannels(
      "post",
      { count: 3, channels: ["linkedin"] },
      [],
      ["instagram"]
    );
    expect(channels).toEqual(["linkedin"]);
    expect(note).toBeNull();
  });

  it("falls back to strategy platforms and says so", () => {
    const { channels, note } = resolveChannels(
      "post",
      { count: 3, channels: [] },
      [],
      ["instagram"]
    );
    expect(channels).toEqual(["instagram"]);
    expect(note).toContain("strategy platforms");
  });

  it("falls back to every channel when nothing is configured", () => {
    const { channels, note } = resolveChannels("post", { count: 3, channels: [] }, [], []);
    expect(channels.length).toBeGreaterThan(1);
    expect(note).toContain("every channel");
  });
});

describe("rankCampaigns", () => {
  const base: CampaignWindow = {
    id: "c1",
    title: "A",
    description: "",
    startDate: "2026-09-07",
    endDate: "2026-09-20",
    goal: "leads",
    keyMessage: "",
    plannedByType: { post: 3 },
    plannedTotal: 3,
    channels: ["linkedin"],
    timeline: [],
  };

  it("ranks the campaign needing more per remaining day first", () => {
    const urgent = { ...base, id: "c2", title: "B", endDate: "2026-09-10", plannedTotal: 6 };
    const ranked = rankCampaigns([base, urgent], [], "2026-09-05", [W36, W38]);
    expect(ranked[0].campaignId).toBe("c2");
    expect(ranked[0].urgency).toBeGreaterThan(ranked[1].urgency);
  });

  it("counts committed slots against the campaign's deficit", () => {
    const ranked = rankCampaigns(
      [base],
      [slot({ campaignId: "c1" }), slot({ id: "s2", campaignId: "c1" })],
      "2026-09-05",
      [W36, W38]
    );
    expect(ranked[0].assigned).toBe(2);
    expect(ranked[0].deficit).toBe(1);
  });

  it("ignores cancelled slots when counting what a campaign has", () => {
    const ranked = rankCampaigns(
      [base],
      [slot({ campaignId: "c1", status: "cancelled" })],
      "2026-09-05",
      [W36, W38]
    );
    expect(ranked[0].assigned).toBe(0);
  });

  it("excludes campaigns whose window does not reach the horizon", () => {
    const past = { ...base, id: "c3", startDate: "2026-01-01", endDate: "2026-02-01" };
    const ranked = rankCampaigns([past], [], "2026-09-05", [W36, W38]);
    expect(ranked).toHaveLength(0);
  });
});

describe("observe", () => {
  const quota = { post: { count: 3, channels: ["linkedin" as const] } };

  function run(over: Partial<Parameters<typeof observe>[0]> = {}) {
    return observe({
      timezone: NY,
      now: SAT_10AM.toJSDate(),
      horizonWeeks: 2,
      quota,
      slots: [],
      campaigns: [],
      strategyChannels: [],
      ...over,
    });
  }

  it("defers the whole current-week gap when no posting day remains", () => {
    const obs = run();
    const current = obs.gaps.find((g) => g.weekKey === "2026-W36");
    expect(current?.deficit).toBe(0);
    expect(current?.notes.join(" ")).toContain("No day left this week");
  });

  it("asks for the full quota in a fully future week", () => {
    const obs = run();
    expect(obs.gaps.find((g) => g.weekKey === "2026-W37")?.deficit).toBe(3);
  });

  it("subtracts slots that already exist", () => {
    const obs = run({
      slots: [slot({ weekKey: "2026-W37", date: "2026-09-08" })],
    });
    expect(obs.gaps.find((g) => g.weekKey === "2026-W37")?.deficit).toBe(2);
  });

  it("treats a cancelled slot as freeing its gap again", () => {
    const obs = run({
      slots: [slot({ weekKey: "2026-W37", date: "2026-09-08", status: "cancelled" })],
    });
    expect(obs.gaps.find((g) => g.weekKey === "2026-W37")?.deficit).toBe(3);
  });

  it("counts a posted slot against quota", () => {
    const obs = run({
      slots: [slot({ weekKey: "2026-W37", date: "2026-09-08", status: "posted" })],
    });
    expect(obs.gaps.find((g) => g.weekKey === "2026-W37")?.deficit).toBe(2);
  });

  it("warns about an unrecognised status instead of silently counting it", () => {
    const obs = run({
      slots: [slot({ weekKey: "2026-W37", status: "archived" })],
    });
    expect(obs.warnings.join(" ")).toContain("archived");
    expect(obs.gaps.find((g) => g.weekKey === "2026-W37")?.deficit).toBe(3);
  });

  it("reports surplus without ever proposing a deletion", () => {
    const obs = run({
      slots: Array.from({ length: 5 }, (_, i) =>
        slot({ id: `s${i}`, weekKey: "2026-W37", date: "2026-09-08" })
      ),
    });
    const gap = obs.gaps.find((g) => g.weekKey === "2026-W37");
    expect(gap?.deficit).toBe(0);
    expect(gap?.surplus).toBe(2);
  });

  it("trims a quota the week physically cannot hold", () => {
    // 9 posts/week against LinkedIn's 3 posting days at 2/day = 6 max.
    const obs = observe({
      timezone: NY,
      now: SAT_10AM.toJSDate(),
      horizonWeeks: 2,
      quota: { post: { count: 9, channels: ["linkedin"] } },
      slots: [],
      campaigns: [],
      strategyChannels: [],
    });
    const gap = obs.gaps.find((g) => g.weekKey === "2026-W37");
    expect(gap?.deficit).toBe(6);
    expect(obs.warnings.join(" ")).toContain("Trimmed proportionally");
  });

  it("collects pinned slot ids so a later commit never moves them", () => {
    const obs = run({ slots: [slot({ id: "pin1", pinned: true })] });
    expect(obs.pinnedSlotIds).toEqual(["pin1"]);
  });

  it("produces no gaps for an empty quota", () => {
    const obs = run({ quota: {} });
    expect(obs.gaps).toHaveLength(0);
    expect(obs.totalDeficit).toBe(0);
  });
});
