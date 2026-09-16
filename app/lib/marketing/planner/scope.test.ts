import { describe, it, expect } from "vitest";
import { scopeToCampaign, fingerprintInputs } from "./plan-runs";
import type { CampaignWindow, ExistingSlot } from "./types";

/**
 * Scoping a plan run to one campaign, and the reason it is one function rather
 * than two filters written twice.
 *
 * previewPlan hashes the inputs it planned from; commit recomputes that hash
 * and refuses a run whose inputs moved. If the two sides narrowed differently
 * — one by campaign, one client-wide — every commit would throw StalePlanError,
 * which reads like data corruption and is really a one-line divergence. So both
 * call this, and these tests pin what "scoped" means.
 */

function campaign(over: Partial<CampaignWindow> = {}): CampaignWindow {
  return {
    id: "c1",
    title: "Q4 Push",
    description: "",
    startDate: null,
    endDate: null,
    goal: "",
    keyMessage: "",
    plannedByType: { post: 4 },
    plannedTotal: 4,
    channels: ["linkedin"],
    timeline: [],
    ...over,
  };
}

function slot(over: Partial<ExistingSlot> = {}): ExistingSlot {
  return {
    id: "s1",
    date: null,
    type: "post",
    channel: "linkedin",
    status: "planned",
    campaignId: "c1",
    pinned: false,
    ...over,
  };
}

const QUOTA = { post: { count: 3, channels: ["linkedin"] } };

describe("scopeToCampaign", () => {
  const campaigns = [campaign({ id: "c1" }), campaign({ id: "c2", title: "Second" })];
  const slots = [
    slot({ id: "a", campaignId: "c1" }),
    slot({ id: "b", campaignId: "c2" }),
    slot({ id: "c", campaignId: "c1" }),
  ];

  it("keeps only the campaign asked for", () => {
    const scoped = scopeToCampaign("c1", campaigns, slots);
    expect(scoped.campaigns.map((c) => c.id)).toEqual(["c1"]);
  });

  it("keeps only that campaign's slots", () => {
    const scoped = scopeToCampaign("c1", campaigns, slots);
    expect(scoped.slots.map((s) => s.id)).toEqual(["a", "c"]);
  });

  /**
   * Runs made before planning was scoped were computed client-wide. Narrowing
   * them now would make their stored fingerprint unreproducible, so every one
   * of them would become permanently un-committable.
   */
  it("leaves a pre-scoping run client-wide", () => {
    const scoped = scopeToCampaign(null, campaigns, slots);
    expect(scoped.campaigns).toHaveLength(2);
    expect(scoped.slots).toHaveLength(3);
  });

  it("yields nothing for a campaign with no slots yet", () => {
    const scoped = scopeToCampaign("c3", campaigns, slots);
    expect(scoped.campaigns).toEqual([]);
    expect(scoped.slots).toEqual([]);
  });
});

describe("the fingerprint, once scoped", () => {
  const c1 = campaign({ id: "c1" });
  const c2 = campaign({ id: "c2", title: "Second" });
  const all = [c1, c2];
  const slots = [slot({ id: "a", campaignId: "c1" }), slot({ id: "b", campaignId: "c2" })];

  const fingerprintFor = (campaignId: string, campaigns = all, s = slots) => {
    const scoped = scopeToCampaign(campaignId, campaigns, s);
    return fingerprintInputs({
      quota: QUOTA,
      campaigns: scoped.campaigns,
      slots: scoped.slots,
    });
  };

  it("is stable for the same campaign", () => {
    expect(fingerprintFor("c1")).toBe(fingerprintFor("c1"));
  });

  it("differs between two campaigns", () => {
    expect(fingerprintFor("c1")).not.toBe(fingerprintFor("c2"));
  });

  /**
   * THE case this whole design turns on.
   *
   * Two open previews is now the normal way to work. If the hash covered every
   * slot in the client, committing campaign A would change campaign B's input
   * set and make B's perfectly good preview un-committable — a StalePlanError
   * with nothing stale about it.
   */
  it("does not change when another campaign gains a slot", () => {
    const before = fingerprintFor("c1");
    const afterOtherCommitted = fingerprintFor("c1", all, [
      ...slots,
      slot({ id: "new-from-c2", campaignId: "c2" }),
    ]);
    expect(afterOtherCommitted).toBe(before);
  });

  it("does not change when another campaign's content plan is edited", () => {
    const before = fingerprintFor("c1");
    const after = fingerprintFor("c1", [
      c1,
      campaign({ id: "c2", plannedByType: { post: 99 }, plannedTotal: 99 }),
    ]);
    expect(after).toBe(before);
  });

  // The guard still has to work: a change to THIS campaign must invalidate it.
  it("does change when this campaign gains a slot", () => {
    const before = fingerprintFor("c1");
    const after = fingerprintFor("c1", all, [...slots, slot({ id: "new", campaignId: "c1" })]);
    expect(after).not.toBe(before);
  });

  it("does change when this campaign's content plan is edited", () => {
    const before = fingerprintFor("c1");
    const after = fingerprintFor("c1", [
      campaign({ id: "c1", plannedByType: { post: 9 }, plannedTotal: 9 }),
      c2,
    ]);
    expect(after).not.toBe(before);
  });
});
