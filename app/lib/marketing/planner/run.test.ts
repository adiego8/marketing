import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { planFromInputs, type PlannerInputs } from "./run";
import { skeletonFills, type DecideFn } from "./decide";
import type { CampaignWindow } from "./types";

const NY = "America/New_York";
/** Saturday 2026-09-05, 10:00 local. */
const NOW = DateTime.fromISO("2026-09-05T10:00", { zone: NY }).toJSDate();

/** Stands in for the model: themes every gap, picks the default channel. */
const stubDecide: DecideFn = async (request) => ({
  fills: request.gaps.map((gap, i) => ({
    gapId: gap.gap_id,
    campaignId: gap.eligible_campaign_ids[0] ?? null,
    channel: gap.default_channel,
    theme: `Theme ${i}`,
    brief: "Brief",
    rationale: "Rationale",
    hook: `Hook ${i}`,
    body: ["Beat one", "Beat two"],
    cta: "Ask",
    needsTheme: false,
  })),
  warnings: [],
  degraded: false,
});

/** Stands in for the model being down. */
const failingDecide: DecideFn = async (request) => ({
  fills: skeletonFills(request.gaps),
  warnings: ["Planner model call failed: connection refused."],
  degraded: true,
});

const CAMPAIGN: CampaignWindow = {
  id: "c1",
  title: "Q4 Push",
  description: "",
  startDate: "2026-09-07",
  endDate: "2026-09-27",
  goal: "leads",
  keyMessage: "",
  plannedByType: { post: 6 },
  plannedTotal: 6,
  channels: ["linkedin"],
  timeline: [{ week: 1, focus: "Problem" }],
};

function inputs(over: Partial<PlannerInputs> = {}): PlannerInputs {
  return {
    clientId: "cli",
    timezone: NY,
    now: NOW,
    horizonWeeks: 2,
    quota: { post: { count: 3, channels: ["linkedin"] } },
    slots: [],
    campaigns: [CAMPAIGN],
    pillars: ["operator playbooks"],
    business: { name: "Test Co" },
    strategyChannels: [],
    recentThemes: [],
    ...over,
  };
}

describe("planFromInputs", () => {
  it("plans a full future week and defers the exhausted current one", async () => {
    const result = await planFromInputs(inputs(), stubDecide);

    // 2026-W36 has only Sat/Sun left and LinkedIn posts Tue-Thu, so everything
    // lands in W37.
    expect(result.status).toBe("proposed");
    expect(result.proposedSlots).toHaveLength(3);
    expect(result.proposedSlots.every((s) => s.weekKey === "2026-W37")).toBe(true);
  });

  it("only proposes days the channel actually posts on", async () => {
    const { proposedSlots } = await planFromInputs(inputs(), stubDecide);
    for (const slot of proposedSlots) {
      const weekday = DateTime.fromISO(slot.date, { zone: NY }).weekday;
      expect([2, 3, 4]).toContain(weekday); // Tue, Wed, Thu
    }
  });

  it("spreads across distinct days and carries correct UTC instants", async () => {
    const { proposedSlots } = await planFromInputs(inputs(), stubDecide);
    expect(new Set(proposedSlots.map((s) => s.date)).size).toBe(3);
    for (const slot of proposedSlots) {
      // September in New York is UTC-4, so a 09:00 local slot is 13:00Z.
      expect(slot.scheduledAt.endsWith("Z")).toBe(true);
      expect(new Date(slot.scheduledAt).getUTCHours()).toBe(
        Number(slot.timeLocal.split(":")[0]) + 4
      );
    }
  });

  it("attaches the eligible campaign", async () => {
    const { proposedSlots } = await planFromInputs(inputs(), stubDecide);
    expect(proposedSlots.every((s) => s.campaignId === "c1")).toBe(true);
    expect(proposedSlots[0].campaignTitle).toBe("Q4 Push");
  });

  it("reports noop rather than failing when the campaign plan is delivered", async () => {
    // Delivery is counted per campaign now, so these slots have to be
    // attributed to it — an unattributed slot is not the campaign's work.
    const met = inputs({
      campaigns: [{ ...CAMPAIGN, plannedByType: { post: 3 }, plannedTotal: 3 }],
      slots: ["a", "b", "c"].map((id, i) => ({
        id,
        date: `2026-09-0${8 + i}`,
        timeLocal: "09:00",
        weekKey: "2026-W37",
        type: "post",
        channel: "linkedin" as const,
        status: "planned",
        campaignId: "c1",
        pinned: false,
      })),
    });
    const result = await planFromInputs(met, stubDecide);
    expect(result.status).toBe("noop");
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("already fully scheduled");
  });

  // The degradation guarantee: dates and channels are computed in code, so a
  // dead model costs themes and nothing else.
  it("still produces a fully dated plan when the model fails", async () => {
    const result = await planFromInputs(inputs(), failingDecide);

    expect(result.status).toBe("degraded");
    expect(result.proposedSlots).toHaveLength(3);
    expect(result.proposedSlots.every((s) => s.needsTheme)).toBe(true);
    expect(result.proposedSlots.every((s) => s.scheduledAt !== "")).toBe(true);
    expect(result.warnings.join(" ")).toContain("connection refused");
  });

  it("plans nothing when no campaign is active", async () => {
    // The demand is the campaigns' content plans. With none active there is
    // nothing to schedule, and saying so beats inventing evergreen filler the
    // quota happened to list.
    const result = await planFromInputs(inputs({ campaigns: [] }), stubDecide);
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.status).toBe("noop");
    expect(result.warnings.join(" ")).toContain("No active campaigns");
  });

  it("plans only what the campaign's content plan asks for", async () => {
    // The quota lists post; the campaign asks for carousel. The campaign wins
    // on WHAT, and the quota only caps how fast.
    const result = await planFromInputs(
      inputs({
        quota: { post: { count: 3, channels: ["linkedin"] } },
        campaigns: [
          { ...CAMPAIGN, plannedByType: { carousel: 2 }, plannedTotal: 2 },
        ],
      }),
      stubDecide
    );
    const types = new Set(result.proposedSlots.map((s) => s.type));
    expect(types).toContain("carousel");
    expect(types).not.toContain("post");
  });

  it("clamps an out-of-range horizon", async () => {
    const result = await planFromInputs(inputs({ horizonWeeks: 99 }), stubDecide);
    expect(result.observation.weeks.length).toBe(8);
    expect(result.warnings.join(" ")).toContain("clamped");
  });

  it("falls back to UTC for an invalid client timezone", async () => {
    const result = await planFromInputs(inputs({ timezone: "Not/AZone" }), stubDecide);
    expect(result.observation.timezone).toBe("UTC");
    expect(result.warnings.join(" ")).toContain("not a valid IANA zone");
  });

  it("produces a fingerprint that changes when the inputs change", async () => {
    const a = await planFromInputs(inputs(), stubDecide);
    const b = await planFromInputs(inputs(), stubDecide);
    const c = await planFromInputs(
      inputs({ quota: { post: { count: 4, channels: ["linkedin"] } } }),
      stubDecide
    );

    expect(a.inputsFingerprint).toBe(b.inputsFingerprint);
    expect(c.inputsFingerprint).not.toBe(a.inputsFingerprint);
  });

  // The regression net for greedy ordering: a refactor that silently changes
  // every date will fail here.
  it("is deterministic — the golden plan", async () => {
    const result = await planFromInputs(inputs(), stubDecide);
    expect(
      result.proposedSlots.map((s) => `${s.date} ${s.timeLocal} ${s.channel} ${s.type}`)
    ).toEqual([
      "2026-09-08 09:00 linkedin post",
      "2026-09-09 09:00 linkedin post",
      "2026-09-10 09:00 linkedin post",
    ]);
  });
});

describe("status when nothing gets placed", () => {
  it("is noop, not proposed, when assign returns no slots", async () => {
    // A deficit existed and the model answered, but the model returned no
    // fills, so nothing reaches the calendar. There is nothing to accept, and
    // calling that "proposed" put a ready-looking badge on an empty plan.
    const result = await planFromInputs(inputs(), async () => ({
      fills: [],
      warnings: [],
      degraded: false,
    }));
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.status).toBe("noop");
  });

  it("still reports degraded only when something was actually placed", async () => {
    // Degraded means "dates are right, themes are missing" — which is only
    // meaningful if there are slots to look at.
    const degraded = await planFromInputs(inputs(), failingDecide);
    expect(degraded.proposedSlots.length).toBeGreaterThan(0);
    expect(degraded.status).toBe("degraded");
  });
});
