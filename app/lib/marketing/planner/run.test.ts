import { describe, it, expect } from "vitest";
import { planFromInputs, type PlannerInputs } from "./run";
import { skeletonFills, type DecideFn } from "./decide";
import type { CampaignWindow, ExistingSlot } from "./types";

// The date-arithmetic half of this suite is gone with the assign stage: the
// planner no longer decides when anything goes out, so there are no posting
// days, no UTC instants and no golden calendar to regress against. What is left
// is the part that still matters — how much a campaign is owed, and that every
// piece carries the campaign that asked for it.

const NY = "America/New_York";

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

function delivered(n: number, over: Partial<ExistingSlot> = {}): ExistingSlot[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    date: null,
    type: "post",
    channel: "linkedin",
    status: "planned",
    campaignId: "c1",
    pinned: false,
    ...over,
  }));
}

function inputs(over: Partial<PlannerInputs> = {}): PlannerInputs {
  return {
    clientId: "cli",
    timezone: NY,
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
  it("writes everything the campaign still owes, in one go", async () => {
    const result = await planFromInputs(inputs(), stubDecide);
    expect(result.status).toBe("proposed");
    expect(result.proposedSlots).toHaveLength(6);
  });

  it("leaves every piece undated", async () => {
    const { proposedSlots } = await planFromInputs(inputs(), stubDecide);
    for (const slot of proposedSlots) {
      expect(slot.date).toBeNull();
      expect(slot.timeLocal).toBeNull();
      expect(slot.weekKey).toBeNull();
      expect(slot.scheduledAt).toBeNull();
    }
  });

  // The regression test for pieces arriving attributed to nothing. A campaign
  // whose window is nowhere near "now" is owed exactly the same content, and
  // every piece of it carries that campaign.
  it("attributes every piece to the campaign that asked for it", async () => {
    const future = await planFromInputs(
      inputs({ campaigns: [{ ...CAMPAIGN, startDate: "2099-01-01", endDate: "2099-03-01" }] }),
      stubDecide
    );
    expect(future.proposedSlots).toHaveLength(6);
    expect(future.proposedSlots.every((s) => s.campaignId === "c1")).toBe(true);
    expect(future.proposedSlots.every((s) => s.campaignTitle === "Q4 Push")).toBe(true);
  });

  it("falls back to the asking campaign when the model returns none", async () => {
    const result = await planFromInputs(
      inputs(),
      async (request) => ({
        fills: request.gaps.map((gap) => ({
          gapId: gap.gap_id,
          campaignId: null,
          channel: gap.default_channel,
          theme: "Theme",
          brief: "",
          rationale: "",
          hook: "",
          body: [],
          cta: "",
          needsTheme: false,
        })),
        warnings: [],
        degraded: false,
      })
    );
    expect(result.proposedSlots.every((s) => s.campaignId === "c1")).toBe(true);
    expect(result.deferred).toHaveLength(0);
  });

  it("subtracts what has been delivered, dated or not", async () => {
    const result = await planFromInputs(inputs({ slots: delivered(4) }), stubDecide);
    expect(result.proposedSlots).toHaveLength(2);
  });

  it("mints ids that skip the ones already taken", async () => {
    const taken = delivered(2).map((s, i) => ({
      ...s,
      id: `cli__c1__post__${i}`,
    }));
    const result = await planFromInputs(inputs({ slots: taken }), stubDecide);
    expect(result.proposedSlots.map((s) => s.slotId)).toEqual([
      "cli__c1__post__2",
      "cli__c1__post__3",
      "cli__c1__post__4",
      "cli__c1__post__5",
    ]);
  });

  it("reports noop when the campaign plan is fully delivered", async () => {
    const result = await planFromInputs(
      inputs({
        campaigns: [{ ...CAMPAIGN, plannedByType: { post: 3 }, plannedTotal: 3 }],
        slots: delivered(3),
      }),
      stubDecide
    );
    expect(result.status).toBe("noop");
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("fully delivered");
  });

  it("plans nothing when no campaign is active", async () => {
    const result = await planFromInputs(inputs({ campaigns: [] }), stubDecide);
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.status).toBe("noop");
    expect(result.warnings.join(" ")).toContain("No active campaigns");
  });

  it("plans only what the campaign's content plan asks for", async () => {
    // The quota lists post; the campaign asks for carousel. The campaign
    // decides WHAT, and the quota now only paces scheduling.
    const result = await planFromInputs(
      inputs({
        quota: { post: { count: 3, channels: ["linkedin"] } },
        campaigns: [{ ...CAMPAIGN, plannedByType: { carousel: 2 }, plannedTotal: 2 }],
      }),
      stubDecide
    );
    const types = new Set(result.proposedSlots.map((s) => s.type));
    expect(types).toEqual(new Set(["carousel"]));
  });

  // A dead model costs themes and nothing else: the pieces still exist, still
  // carry their campaign, and are still acceptable.
  it("still produces attributed pieces when the model fails", async () => {
    const result = await planFromInputs(inputs(), failingDecide);
    expect(result.status).toBe("degraded");
    expect(result.proposedSlots).toHaveLength(6);
    expect(result.proposedSlots.every((s) => s.needsTheme)).toBe(true);
    expect(result.proposedSlots.every((s) => s.campaignId === "c1")).toBe(true);
    expect(result.warnings.join(" ")).toContain("connection refused");
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

  // Moving a campaign's window no longer changes what is generated, so it must
  // no longer invalidate an open preview.
  it("does not change the fingerprint when a campaign's window moves", async () => {
    const a = await planFromInputs(inputs(), stubDecide);
    const b = await planFromInputs(
      inputs({ campaigns: [{ ...CAMPAIGN, startDate: "2027-01-01", endDate: "2027-02-01" }] }),
      stubDecide
    );
    expect(b.inputsFingerprint).toBe(a.inputsFingerprint);
  });

  it("does change it when the campaign's content plan changes", async () => {
    const a = await planFromInputs(inputs(), stubDecide);
    const b = await planFromInputs(
      inputs({ campaigns: [{ ...CAMPAIGN, plannedByType: { post: 5 }, plannedTotal: 5 }] }),
      stubDecide
    );
    expect(b.inputsFingerprint).not.toBe(a.inputsFingerprint);
  });
});

describe("status when nothing gets written", () => {
  it("is noop, not proposed, when the model returns no fills", async () => {
    const result = await planFromInputs(inputs(), async () => ({
      fills: [],
      warnings: [],
      degraded: false,
    }));
    expect(result.proposedSlots).toHaveLength(0);
    expect(result.status).toBe("noop");
  });
});
