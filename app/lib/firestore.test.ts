import { describe, it, expect } from "vitest";
import { serializeLesson, serializeSignal } from "./firestore";

/**
 * Serializers are pure functions of a Firestore document, and this codebase has
 * twice been bitten by them silently disagreeing with what is on disk: a slot
 * written with `calendarEventId` where `googleEventId` was read, and a plan run
 * whose `observation.demand` was absent on older documents and crashed the page
 * that mapped over it.
 *
 * Both failed the same way — no error, just a default where real data should
 * have been, or a crash far from the cause. So the rule these pin is: a partial
 * or old document must come back renderable.
 */

describe("serializeLesson", () => {
  const full = {
    clientId: "c1",
    text: "Open with the cost of the status quo.",
    scope: "plan_themes",
    source: "written",
    owner: "client",
    evidence: ["s1", "s2"],
    evidenceCount: 2,
    retiredAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("reads a complete document", () => {
    const lesson = serializeLesson("l1", full);
    expect(lesson.id).toBe("l1");
    expect(lesson.text).toBe("Open with the cost of the status quo.");
    expect(lesson.scope).toBe("plan_themes");
    expect(lesson.evidence).toEqual(["s1", "s2"]);
  });

  // Status is derived, not stored. Storing both invites them to disagree, and
  // the timestamp is the thing worth keeping — "when did we stop believing
  // this" is a real question.
  it("derives status from whether it was retired", () => {
    expect(serializeLesson("l1", full).status).toBe("active");
    expect(
      serializeLesson("l1", { ...full, retiredAt: "2026-09-04T00:00:00.000Z" }).status
    ).toBe("retired");
  });

  it("falls back to counting the evidence it kept", () => {
    const { evidenceCount, ...withoutCount } = full;
    void evidenceCount;
    expect(serializeLesson("l1", withoutCount).evidence_count).toBe(2);
  });

  // A distilled lesson can cite more episodes than it stores ids for, so the
  // stored count wins where there is one.
  it("prefers a stored count over the ids", () => {
    expect(
      serializeLesson("l1", { ...full, evidenceCount: 9 }).evidence_count
    ).toBe(9);
  });

  // The whole point of writing `owner` before anything reads it: documents
  // created now must still make sense when agency-wide rules arrive.
  it("defaults owner to the client", () => {
    const { owner, ...withoutOwner } = full;
    void owner;
    expect(serializeLesson("l1", withoutOwner).owner).toBe("client");
  });

  it("renders an empty document rather than throwing", () => {
    const lesson = serializeLesson("l1", {});
    expect(lesson.text).toBe("");
    expect(lesson.evidence).toEqual([]);
    expect(lesson.evidence_count).toBe(0);
    expect(lesson.status).toBe("active");
    expect(lesson.scope).toBe("plan_themes");
  });

  it("survives fields of the wrong shape", () => {
    const lesson = serializeLesson("l1", { evidence: "not an array", text: 42 });
    expect(lesson.evidence).toEqual([]);
    expect(typeof lesson.text).toBe("string");
  });
});

describe("serializeSignal", () => {
  const full = {
    clientId: "c1",
    kind: "edited",
    scope: "plan_themes",
    type: "post",
    channel: "linkedin",
    slotId: "s1",
    campaignId: "camp1",
    planRunId: "run1",
    reason: "too salesy",
    before: { theme: "T", hook: "H", body: ["a", "b"], cta: "C" },
    after: { theme: "T2", hook: "H2", body: ["a"], cta: "C" },
    changed: ["theme", "hook", "body"],
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("reads a complete document", () => {
    const signal = serializeSignal("sig1", full);
    expect(signal.kind).toBe("edited");
    expect(signal.before?.body).toEqual(["a", "b"]);
    expect(signal.after?.theme).toBe("T2");
    expect(signal.changed).toEqual(["theme", "hook", "body"]);
  });

  // Only an edit has both ends. A drop has a before and no after; a restore has
  // neither. Null rather than an empty object, so the page can test for it.
  it("leaves a missing snapshot null", () => {
    const signal = serializeSignal("sig1", { ...full, after: undefined });
    expect(signal.after).toBeNull();
    expect(signal.before).not.toBeNull();
  });

  it("coerces beats to strings rather than passing junk through", () => {
    const signal = serializeSignal("sig1", {
      ...full,
      before: { theme: "T", body: [1, 2] },
    });
    expect(signal.before?.body).toEqual(["1", "2"]);
    expect(signal.before?.hook).toBe("");
  });

  it("renders an empty document rather than throwing", () => {
    const signal = serializeSignal("sig1", {});
    expect(signal.reason).toBe("");
    expect(signal.changed).toEqual([]);
    expect(signal.before).toBeNull();
    expect(signal.after).toBeNull();
    expect(signal.slot_id).toBeNull();
  });

  it("survives a snapshot that is not an object", () => {
    expect(serializeSignal("sig1", { before: "nonsense" }).before).toBeNull();
    expect(serializeSignal("sig1", { changed: 7 }).changed).toEqual([]);
  });
});
