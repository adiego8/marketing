import { describe, expect, it } from "vitest";
import { quotaWarning, weekLoad, type ScheduledSlot } from "./schedule";

function slot(over: Partial<ScheduledSlot> = {}): ScheduledSlot {
  return {
    id: "s1",
    date: "2026-09-15",
    weekKey: "2026-W38",
    type: "post",
    status: "planned",
    ...over,
  };
}

describe("weekLoad", () => {
  it("counts pieces of that type already in that week", () => {
    const slots = [slot({ id: "a" }), slot({ id: "b" }), slot({ id: "c", type: "reel" })];
    expect(weekLoad(slots, "2026-W38", "post")).toBe(2);
  });

  it("ignores other weeks", () => {
    expect(weekLoad([slot({ weekKey: "2026-W39" })], "2026-W38", "post")).toBe(0);
  });

  it("ignores an unscheduled piece, which is in no week", () => {
    expect(weekLoad([slot({ date: null, weekKey: null })], "2026-W38", "post")).toBe(0);
  });

  it("frees a cancelled or skipped piece", () => {
    const slots = [slot({ id: "a", status: "cancelled" }), slot({ id: "b", status: "skipped" })];
    expect(weekLoad(slots, "2026-W38", "post")).toBe(0);
  });

  // Moving a piece within its own week must not count it against itself, or
  // every reschedule would look like it added one.
  it("excludes the slot being moved", () => {
    const slots = [slot({ id: "a" }), slot({ id: "b" })];
    expect(weekLoad(slots, "2026-W38", "post", "a")).toBe(1);
  });
});

describe("quotaWarning", () => {
  const quota = { post: { count: 3, channels: [] } };

  it("is silent below the cap", () => {
    expect(quotaWarning("2026-W38", "post", 1, quota)).toBeNull();
  });

  it("is silent landing exactly on the cap", () => {
    expect(quotaWarning("2026-W38", "post", 2, quota)).toBeNull();
  });

  it("warns past the cap, naming the week and both numbers", () => {
    const warning = quotaWarning("2026-W38", "post", 3, quota);
    expect(warning).toContain("2026-W38");
    expect(warning).toContain("4");
    expect(warning).toContain("3");
  });

  it("never warns for a type with no quota entry", () => {
    expect(quotaWarning("2026-W38", "reel", 99, quota)).toBeNull();
  });

  // A count of zero is "no pace set", not "none allowed" — the strategy editor
  // writes rows the operator has not filled in yet.
  it("treats a cap of zero as no cap", () => {
    expect(quotaWarning("2026-W38", "post", 9, { post: { count: 0, channels: [] } })).toBeNull();
  });
});
