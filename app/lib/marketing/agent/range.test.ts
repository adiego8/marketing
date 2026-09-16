import { describe, it, expect } from "vitest";
import { resolveRange, isPeriod, MAX_RANGE_DAYS } from "./range";

/**
 * "This week" is not a fact about the server. It is a fact about the client's
 * calendar, and getting it wrong is invisible: the agent gets a plausible list
 * of pieces that is simply the wrong seven days, and nothing anywhere errors.
 *
 * The cases that actually bite are all here — a Monday anchor, a Sunday anchor,
 * a month with 28 days, a DST week, and a cap that must not fire a day early.
 */

const MADRID = "Europe/Madrid";

function range(result: ReturnType<typeof resolveRange>) {
  if ("error" in result) throw new Error(`expected a range, got: ${result.error}`);
  return result.range;
}

function error(result: ReturnType<typeof resolveRange>) {
  if (!("error" in result)) throw new Error("expected an error, got a range");
  return result.error;
}

describe("resolveRange — periods", () => {
  it("defaults to the week containing today", () => {
    // 2026-09-15 is a Tuesday.
    expect(range(resolveRange({}, MADRID, "2026-09-15"))).toEqual({
      from: "2026-09-14",
      to: "2026-09-20",
    });
  });

  it("resolves a day to itself", () => {
    expect(range(resolveRange({ period: "day" }, MADRID, "2026-09-15"))).toEqual({
      from: "2026-09-15",
      to: "2026-09-15",
    });
  });

  // Weeks start Monday, matching the planner. If these disagreed, a piece would
  // sit in one week on the calendar and a different one over the API.
  it("starts the week on Monday, not Sunday", () => {
    expect(range(resolveRange({ period: "week" }, MADRID, "2026-09-14")).from).toBe(
      "2026-09-14"
    );
  });

  it("keeps a Sunday in the week that just ended", () => {
    expect(range(resolveRange({ period: "week" }, MADRID, "2026-09-20"))).toEqual({
      from: "2026-09-14",
      to: "2026-09-20",
    });
  });

  it("resolves a month to its real last day", () => {
    expect(range(resolveRange({ period: "month" }, MADRID, "2026-09-15"))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(range(resolveRange({ period: "month" }, MADRID, "2026-02-10"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("anchors on an explicit date rather than today", () => {
    expect(
      range(resolveRange({ period: "day", date: "2026-12-25" }, MADRID, "2026-09-15"))
    ).toEqual({ from: "2026-12-25", to: "2026-12-25" });
  });

  // The week Europe puts the clocks back. A naive hour-based diff lands on the
  // Sunday twice, or skips it.
  it("spans a DST week correctly", () => {
    expect(range(resolveRange({ period: "week" }, MADRID, "2026-10-26"))).toEqual({
      from: "2026-10-26",
      to: "2026-11-01",
    });
  });

  // The client's calendar, not the server's. Same instant, different day.
  it("resolves against the client's zone", () => {
    const auckland = range(resolveRange({ period: "day" }, "Pacific/Auckland", "2026-09-16"));
    const madrid = range(resolveRange({ period: "day" }, MADRID, "2026-09-15"));
    expect(auckland.from).toBe("2026-09-16");
    expect(madrid.from).toBe("2026-09-15");
  });

  // An unusable zone must still answer. Degrade, never fail.
  it("falls back to UTC on a nonsense timezone", () => {
    expect(range(resolveRange({ period: "day" }, "Not/AZone", "2026-09-15"))).toEqual({
      from: "2026-09-15",
      to: "2026-09-15",
    });
  });
});

describe("resolveRange — explicit ranges", () => {
  it("passes a valid range through", () => {
    expect(
      range(resolveRange({ from: "2026-09-01", to: "2026-09-30" }, MADRID, "2026-09-15"))
    ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("accepts a single day as a range", () => {
    expect(
      range(resolveRange({ from: "2026-09-01", to: "2026-09-01" }, MADRID, "2026-09-15"))
    ).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });

  it("refuses one end without the other", () => {
    expect(error(resolveRange({ from: "2026-09-01" }, MADRID))).toMatch(/together/);
    expect(error(resolveRange({ to: "2026-09-01" }, MADRID))).toMatch(/together/);
  });

  it("refuses a backwards range", () => {
    expect(
      error(resolveRange({ from: "2026-09-30", to: "2026-09-01" }, MADRID))
    ).toMatch(/not be after/);
  });

  it("refuses a malformed date", () => {
    expect(error(resolveRange({ from: "01-09-2026", to: "2026-09-30" }, MADRID))).toMatch(
      /YYYY-MM-DD/
    );
  });

  // Matches the regex, is not a day. The regex alone would let it through and
  // luxon would quietly resolve it to 2 March.
  it("refuses a date that does not exist", () => {
    expect(error(resolveRange({ from: "2026-02-30", to: "2026-03-01" }, MADRID))).toMatch(
      /real dates/
    );
    expect(error(resolveRange({ period: "day", date: "2026-02-30" }, MADRID))).toMatch(
      /real date/
    );
  });

  // Guessing which one the caller meant is how an agent publishes a week it
  // never asked for.
  it("refuses period and an explicit range together", () => {
    expect(
      error(resolveRange({ period: "week", from: "2026-09-01", to: "2026-09-02" }, MADRID))
    ).toMatch(/not both/);
  });

  it("refuses an unknown period", () => {
    expect(error(resolveRange({ period: "fortnight" }, MADRID))).toMatch(/period must be/);
  });
});

describe("resolveRange — the cap", () => {
  it("allows exactly the maximum", () => {
    // Inclusive of both ends, so the 92nd day is 91 days after the first.
    expect(
      range(resolveRange({ from: "2026-01-01", to: "2026-04-02" }, MADRID))
    ).toEqual({ from: "2026-01-01", to: "2026-04-02" });
  });

  it("refuses one day more", () => {
    expect(error(resolveRange({ from: "2026-01-01", to: "2026-04-03" }, MADRID))).toMatch(
      new RegExp(String(MAX_RANGE_DAYS))
    );
  });

  // A window containing a clock change is 91.96 days by naive arithmetic. That
  // must not turn a legal request into a 422 for one week a year.
  it("does not miscount a window containing a DST change", () => {
    expect(
      range(resolveRange({ from: "2026-09-01", to: "2026-11-30" }, MADRID))
    ).toEqual({ from: "2026-09-01", to: "2026-11-30" });
  });
});

describe("isPeriod", () => {
  it("knows the three it supports", () => {
    expect(isPeriod("day")).toBe(true);
    expect(isPeriod("week")).toBe(true);
    expect(isPeriod("month")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPeriod("year")).toBe(false);
    expect(isPeriod(null)).toBe(false);
    expect(isPeriod(7)).toBe(false);
  });
});
