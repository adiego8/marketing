import { describe, it, expect } from "vitest";
import {
  weekKeyOf,
  horizonWeeks,
  daysInSpan,
  weekdayOf,
  toUtcInstant,
  addMinutes,
  minutesOf,
  zoneOrUTC,
} from "./weeks";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

describe("weekKeyOf", () => {
  it("formats an ISO week key", () => {
    expect(weekKeyOf("2026-09-16", NY)).toBe("2026-W38");
  });

  it("resolves the week in the client's timezone, not the server's", () => {
    // 2027-01-03 is a Sunday in NY (2026-W53) but Monday in Tokyo (2027-W01).
    // Getting this wrong files a slot in the neighbouring week and the quota
    // count for both weeks comes out wrong.
    expect(weekKeyOf("2027-01-03", NY)).toBe("2026-W53");
    expect(weekKeyOf("2027-01-04", NY)).toBe("2027-W01");
  });
});

describe("horizonWeeks", () => {
  it("starts at the Monday of the week containing the given date", () => {
    // 2026-09-05 is a Saturday.
    const [first] = horizonWeeks("2026-09-05", 1, NY);
    expect(first).toEqual({
      weekKey: "2026-W36",
      start: "2026-08-31",
      end: "2026-09-06",
    });
  });

  it("returns consecutive weeks", () => {
    const spans = horizonWeeks("2026-09-05", 3, NY);
    expect(spans.map((s) => s.weekKey)).toEqual(["2026-W36", "2026-W37", "2026-W38"]);
  });

  // The regression this module exists for: 2026 is a 53-week ISO year.
  // Incrementing the week NUMBER would produce "2026-W54"; re-reading it from
  // luxon rolls correctly into 2027-W01.
  it("crosses a 53-week ISO year boundary", () => {
    const spans = horizonWeeks("2026-12-21", 4, NY);
    expect(spans.map((s) => s.weekKey)).toEqual([
      "2026-W52",
      "2026-W53",
      "2027-W01",
      "2027-W02",
    ]);
  });

  it("always returns at least one week", () => {
    expect(horizonWeeks("2026-09-05", 0, NY)).toHaveLength(1);
  });
});

describe("daysInSpan", () => {
  it("returns seven days, Monday through Sunday", () => {
    const days = daysInSpan(
      { weekKey: "2026-W36", start: "2026-08-31", end: "2026-09-06" },
      NY
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-31");
    expect(days[6]).toBe("2026-09-06");
  });

  it("spans a DST transition without dropping or duplicating a day", () => {
    // US DST starts Sunday 2026-03-08; that local day is only 23 hours long.
    const days = daysInSpan(
      { weekKey: "2026-W10", start: "2026-03-02", end: "2026-03-08" },
      NY
    );
    expect(days).toHaveLength(7);
    expect(days[6]).toBe("2026-03-08");
  });
});

describe("weekdayOf", () => {
  it("uses luxon's 1=Monday convention, matching POSTING_WINDOWS", () => {
    expect(weekdayOf("2026-08-31", NY)).toBe(1); // Monday
    expect(weekdayOf("2026-09-05", NY)).toBe(6); // Saturday
    expect(weekdayOf("2026-09-06", NY)).toBe(7); // Sunday
  });
});

describe("toUtcInstant", () => {
  // The reason this app takes a timezone library rather than doing offset math.
  it("accounts for DST when converting local time to UTC", () => {
    const before = toUtcInstant("2026-03-01", "09:00", NY);
    const after = toUtcInstant("2026-03-08", "09:00", NY);

    expect(before?.toISOString()).toBe("2026-03-01T14:00:00.000Z");
    expect(after?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    // Same local wall-clock time, one hour apart in absolute time.
    expect(before!.getUTCHours() - after!.getUTCHours()).toBe(1);
  });

  // The guard that matters. Luxon shifts a non-existent local time forward and
  // STILL reports isValid: true, so checking isValid alone would let a slot be
  // scheduled an hour away from what the plan says.
  it("returns null for a local time that does not exist (spring forward)", () => {
    expect(toUtcInstant("2026-03-08", "02:30", NY)).toBeNull();
  });

  it("resolves an ambiguous fall-back time deterministically", () => {
    // 01:30 occurs twice on 2026-11-01; luxon picks the earlier offset.
    expect(toUtcInstant("2026-11-01", "01:30", NY)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z"
    );
  });

  it("converts according to the client's zone, not the host's", () => {
    expect(toUtcInstant("2026-09-16", "09:00", TOKYO)?.toISOString()).toBe(
      "2026-09-16T00:00:00.000Z"
    );
  });

  it("handles a zone with a 45-minute offset", () => {
    expect(toUtcInstant("2026-09-05", "09:00", "Pacific/Chatham")?.toISOString()).toBe(
      "2026-09-04T20:15:00.000Z"
    );
  });
});

describe("zoneOrUTC", () => {
  it("passes through a valid zone", () => {
    expect(zoneOrUTC(NY)).toEqual({ zone: NY, warning: null });
  });

  it("falls back to UTC with a warning rather than producing invalid dates", () => {
    const result = zoneOrUTC("Not/AZone");
    expect(result.zone).toBe("UTC");
    expect(result.warning).toContain("Not/AZone");
  });
});

describe("time helpers", () => {
  it("adds minutes across an hour boundary", () => {
    expect(addMinutes("09:00", 120)).toBe("11:00");
    expect(addMinutes("09:45", 30)).toBe("10:15");
  });

  it("clamps rather than overflowing into the next day", () => {
    expect(addMinutes("23:30", 120)).toBe("23:59");
  });

  it("converts to minutes since midnight for comparison", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("09:30")).toBe(570);
  });
});
