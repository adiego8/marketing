import { describe, it, expect } from "vitest";
import { slotDoc } from "./commit";
import type { ProposedSlot } from "./types";

const SLOT: ProposedSlot = {
  slotId: "c1__2026-09-08__post__linkedin__0",
  gapId: "2026-W37::post",
  weekKey: "2026-W37",
  date: "2026-09-08",
  timeLocal: "09:00",
  timezone: "America/New_York",
  scheduledAt: "2026-09-08T13:00:00.000Z",
  type: "post",
  channel: "linkedin",
  campaignId: null,
  campaignTitle: null,
  theme: "Why quarterly filing slips",
  brief: "Open with the deadline nobody tracks.",
  rationale: "Pillar: process",
  needsTheme: false,
};

// loadPlannerSlots reads exactly these keys off a slot document. A slot written
// without one of them is invisible to the next run's gap analysis, which then
// re-proposes content that is already on the calendar — with no error anywhere.
const READ_BY_OBSERVE = [
  "clientId",
  "date",
  "timeLocal",
  "weekKey",
  "type",
  "channel",
  "status",
  "campaignId",
  "pinned",
] as const;

describe("slotDoc", () => {
  const doc = slotDoc("c1", "run1", SLOT);

  it("writes every field the planner reads back", () => {
    for (const key of READ_BY_OBSERVE) {
      expect(doc, `missing ${key}`).toHaveProperty(key);
      expect(doc[key as keyof typeof doc], `${key} is undefined`).toBeDefined();
    }
  });

  it("carries the proposal through unchanged", () => {
    expect(doc.date).toBe(SLOT.date);
    expect(doc.timeLocal).toBe(SLOT.timeLocal);
    expect(doc.weekKey).toBe(SLOT.weekKey);
    expect(doc.type).toBe(SLOT.type);
    expect(doc.channel).toBe(SLOT.channel);
    expect(doc.theme).toBe(SLOT.theme);
    expect(doc.scheduledAt).toBe(SLOT.scheduledAt);
  });

  it("lands as an unpinned planned slot owned by its run", () => {
    // status "planned" is what observe counts; anything else and the slot does
    // not defend its place in the quota.
    expect(doc.status).toBe("planned");
    // Pinning is a human act. A freshly committed slot must stay movable.
    expect(doc.pinned).toBe(false);
    expect(doc.clientId).toBe("c1");
    expect(doc.planRunId).toBe("run1");
  });

  it("keeps a null campaign null rather than dropping it", () => {
    // The Admin SDK throws on undefined; ignoreUndefinedProperties would
    // silently drop it. Either way the field must be an explicit null.
    expect(doc.campaignId).toBeNull();
    expect(doc.campaignTitle).toBeNull();
  });
});
