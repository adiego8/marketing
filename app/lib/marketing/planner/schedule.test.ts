import { describe, expect, it } from "vitest";
import { quotaWarning, overCap, weekLoad, type ScheduledSlot } from "./schedule";

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
  const quota = { post: { count: 3 } };

  it("is silent below the cap", () => {
    expect(quotaWarning("2026-W38", "post", 1, quota)).toBeNull();
  });

  it("is silent landing exactly on the cap", () => {
    expect(quotaWarning("2026-W38", "post", 2, quota)).toBeNull();
  });

  it("warns past the cap, naming the week and both numbers", () => {
    const warning = quotaWarning("14 – 20 September", "post", 3, quota);
    // The label is passed through verbatim; the key never reaches a reader.
    expect(warning).toContain("14 – 20 September");
    expect(warning).toContain("4");
    expect(warning).toContain("3");
  });

  it("never warns for a type with no quota entry", () => {
    expect(quotaWarning("2026-W38", "reel", 99, quota)).toBeNull();
  });

  // A count of zero is "no pace set", not "none allowed" — the strategy editor
  // writes rows the operator has not filled in yet.
  it("treats a cap of zero as no cap", () => {
    expect(quotaWarning("2026-W38", "post", 9, { post: { count: 0 } })).toBeNull();
  });
});

describe("overCap", () => {
  const quota = { post: { count: 3 } };

  function week(over: Partial<ScheduledSlot>[]): ScheduledSlot[] {
    return over.map((o, i) => ({
      id: `s${i}`,
      date: "2026-09-14",
      weekKey: "2026-W38",
      type: "post",
      status: "planned",
      ...o,
    }));
  }

  it("says nothing when a week is inside its cap", () => {
    expect(overCap(week([{}, {}, {}]), "2026-W38", quota)).toEqual([]);
  });

  it("reports a type the week is over on", () => {
    const [row] = overCap(week([{}, {}, {}, {}]), "2026-W38", quota);
    expect(row.type).toBe("post");
    expect(row.load).toBe(4);
    expect(row.cap).toBe(3);
    expect(row.text).toBe("4 posts against a weekly cap of 3");
  });

  // Same rule as quotaWarning: no entry means the operator chose not to pace it.
  it("ignores a type with no quota entry", () => {
    expect(overCap(week([{ type: "reel" }, { type: "reel" }]), "2026-W38", quota))
      .toEqual([]);
  });

  it("ignores a cap of zero", () => {
    expect(
      overCap(week([{}, {}]), "2026-W38", { post: { count: 0 } })
    ).toEqual([]);
  });

  // Cancelled and skipped free their place, exactly as they do for weekLoad.
  it("does not count cancelled or skipped pieces", () => {
    const slots = week([{}, {}, {}, { status: "cancelled" }, { status: "skipped" }]);
    expect(overCap(slots, "2026-W38", quota)).toEqual([]);
  });

  it("looks at one week only", () => {
    const slots = week([{}, {}, {}, {}]).map((s) => ({ ...s, weekKey: "2026-W39" }));
    expect(overCap(slots, "2026-W38", quota)).toEqual([]);
  });

  it("singularises a cap of one", () => {
    const [row] = overCap(week([{}, {}]), "2026-W38", { post: { count: 1 } });
    expect(row.text).toBe("2 posts against a weekly cap of 1");
  });
});
