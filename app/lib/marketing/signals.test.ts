import { describe, it, expect } from "vitest";
import { signalId, MAX_REASON_CHARS, type RecordInput } from "./signals";

function input(over: Partial<RecordInput> = {}): RecordInput {
  return {
    clientId: "c1",
    kind: "edited",
    scope: "plan_themes",
    slotId: "slot-1",
    planRunId: "run-1",
    ...over,
  };
}

// Everything the evidence count rests on. A signal written twice for one
// disagreement inflates whatever rule it later justifies, and nothing
// downstream can tell the difference.
describe("signalId", () => {
  describe("dropped", () => {
    // The reason box saves on blur: drop a piece, type why, and the endpoint is
    // called twice about the same rejection.
    it("is stable for the same piece in the same run", () => {
      expect(signalId(input({ kind: "dropped" }))).toBe(
        signalId(input({ kind: "dropped", reason: "too salesy" }))
      );
    });

    it("separates the same piece dropped in different runs", () => {
      expect(signalId(input({ kind: "dropped", planRunId: "run-1" }))).not.toBe(
        signalId(input({ kind: "dropped", planRunId: "run-2" }))
      );
    });

    it("separates different pieces in one run", () => {
      expect(signalId(input({ kind: "dropped", slotId: "a" }))).not.toBe(
        signalId(input({ kind: "dropped", slotId: "b" }))
      );
    });

    // No run means no stable key; a fresh document beats collapsing two
    // unrelated drops onto one.
    it("falls back to a fresh id with no run", () => {
      expect(signalId(input({ kind: "dropped", planRunId: null }))).toBeNull();
    });
  });

  describe("edited", () => {
    // Five passes over one hook is one disagreement. Collapsing them is also
    // what keeps `before` anchored to the agent's version rather than walking
    // forward to meet the human's.
    it("is stable across repeated saves of one piece", () => {
      expect(signalId(input())).toBe(signalId(input()));
    });

    it("separates different pieces", () => {
      expect(signalId(input({ slotId: "a" }))).not.toBe(signalId(input({ slotId: "b" })));
    });

    // An edit belongs to the piece, not to the run that proposed it: a slot
    // edited long after its plan run is still the same argument.
    it("ignores the plan run", () => {
      expect(signalId(input({ planRunId: "run-1" }))).toBe(
        signalId(input({ planRunId: "run-9" }))
      );
    });

    it("does not collide with that piece's drop", () => {
      expect(signalId(input())).not.toBe(signalId(input({ kind: "dropped" })));
    });
  });

  // Two steers really are two rejections, and being dropped twice is two drops.
  it("gives every other kind a fresh id", () => {
    for (const kind of ["steered", "restored", "retired"] as const) {
      expect(signalId(input({ kind })), kind).toBeNull();
    }
  });

  it("gives a fresh id when there is no slot to key on", () => {
    expect(signalId(input({ slotId: null }))).toBeNull();
    expect(signalId(input({ kind: "dropped", slotId: undefined }))).toBeNull();
  });
});

describe("MAX_REASON_CHARS", () => {
  // A reason rides in every replacement prompt. Unbounded, one pasted email
  // thread crowds out the brief it is meant to steer.
  it("is a sentence, not an essay", () => {
    expect(MAX_REASON_CHARS).toBeLessThanOrEqual(500);
    expect(MAX_REASON_CHARS).toBeGreaterThan(100);
  });
});
