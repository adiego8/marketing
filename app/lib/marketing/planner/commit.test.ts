import { describe, it, expect } from "vitest";
import { slotDoc } from "./commit";
import type { ProposedSlot } from "./types";

const SLOT: ProposedSlot = {
  slotId: "c1__camp1__post__0",
  gapId: "camp1__post__0",
  // Undated: a piece is accepted first and given a day afterwards.
  weekKey: null,
  date: null,
  timeLocal: null,
  timezone: "America/New_York",
  scheduledAt: null,
  type: "post",
  channel: "linkedin",
  campaignId: "camp1",
  campaignTitle: "Launch",
  theme: "Why quarterly filing slips",
  brief: "Open with the deadline nobody tracks.",
  rationale: "Pillar: process",
  hook: "Nobody diarises the deadline. That is the whole problem.",
  body: ["Name the date everyone misses.", "What it costs.", "The fix."],
  cta: "Book the 20-minute check.",
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

// serializeSlot in lib/firestore.ts is the OTHER reader — the one every API
// response goes through. This list is every `d.*` it touches.
//
// The first version of this test covered only READ_BY_OBSERVE, and that is
// precisely how `calendarEventId` shipped where `googleEventId` was expected:
// observe does not read it, so nothing failed. A slot missing one of these
// does not error, it silently deserializes to the field's default — so a
// synced slot reads back as unsynced, and Phase 4 re-pushes it.
const READ_BY_SERIALIZER = [
  "clientId",
  "campaignId",
  "campaignTitle",
  "planRunId",
  "gapId",
  "date",
  "timeLocal",
  "timezone",
  "scheduledAt",
  "weekKey",
  "type",
  "channel",
  "theme",
  "brief",
  "rationale",
  "hook",
  "body",
  "cta",
  "needsTheme",
  "status",
  "source",
  "pinned",
  "content",
  "googleEventId",
  "googleSyncStatus",
  "googleEventTitle",
  "googleEventBodyHash",
  "googleEventLocked",
  "googleAdoptedAt",
  "lastHumanEditAt",
  "createdAt",
  "updatedAt",
] as const;

describe("slotDoc", () => {
  const doc = slotDoc("c1", "run1", SLOT);

  it("writes every field the planner reads back", () => {
    for (const key of READ_BY_OBSERVE) {
      expect(doc, `missing ${key}`).toHaveProperty(key);
      expect(doc[key as keyof typeof doc], `${key} is undefined`).toBeDefined();
    }
  });

  it("writes every field serializeSlot reads back", () => {
    for (const key of READ_BY_SERIALIZER) {
      expect(doc, `missing ${key} — serializeSlot will return its default`)
        .toHaveProperty(key);
      expect(doc[key as keyof typeof doc], `${key} is undefined`).toBeDefined();
    }
  });

  it("names the Google sync fields the way serializeSlot spells them", () => {
    // The specific drift this test exists to prevent.
    expect(doc).toHaveProperty("googleEventId");
    expect(doc).not.toHaveProperty("calendarEventId");
    expect(doc.googleSyncStatus).toBe("pending");
  });

  it("marks the slot as planner output", () => {
    // Human-added slots will carry source "human"; the distinction is what
    // lets reconciliation tell an agent slot from one someone typed.
    expect(doc.source).toBe("agent");
    expect(doc.lastHumanEditAt).toBeNull();
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

  it("carries the campaign that asked for the piece", () => {
    // Attribution is the reason the whole planner was restructured: a
    // committed piece with no campaign is content nothing asked for.
    expect(doc.campaignId).toBe("camp1");
    expect(doc.campaignTitle).toBe("Launch");
  });

  it("writes the scheduling fields as explicit nulls", () => {
    // The Admin SDK throws on undefined and ignoreUndefinedProperties would
    // drop the keys, either of which leaves a slot that reads as scheduled to
    // nowhere. Null is what listSlots and syncSlots test for.
    expect(doc.date).toBeNull();
    expect(doc.timeLocal).toBeNull();
    expect(doc.weekKey).toBeNull();
    expect(doc.scheduledAt).toBeNull();
  });
});
