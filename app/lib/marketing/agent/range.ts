// Turning "this week" into two dates. Pure.
//
// Every date an agent sends or receives is a calendar date in the CLIENT's
// timezone, never UTC. A day for a Madrid client starts an hour before a day
// for a London one, and resolving a period against the server's clock instead
// of the client's is how a poller silently misses the first post of every day.
//
// The week boundary is Monday, borrowed wholesale from planner/weeks.ts rather
// than recomputed here — the planner already decides what week a piece belongs
// to, and a second definition that disagreed would put a piece in one week on
// the calendar and another over the API.

import { DateTime } from "luxon";
import { todayIn, weekKeyOf, weekSpanOf, zoneOrUTC } from "../planner/weeks";

/**
 * The widest window one request may ask for.
 *
 * A quarter is more than any publishing agent needs in one call, and the cap is
 * the only thing standing between a typo'd `from` and a full-collection read
 * billed per document. `listSlots` reads the client's whole slot collection
 * regardless, so this bounds the response rather than the query — it is a guard
 * on the caller's sanity, not on Firestore.
 */
export const MAX_RANGE_DAYS = 92;

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

export interface RangeQuery {
  period?: string | null;
  date?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface Range {
  from: string;
  to: string;
}

export type RangeResult = { range: Range } | { error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

/**
 * Resolve a query into an inclusive date range.
 *
 * @param tz    The client's IANA zone.
 * @param today YYYY-MM-DD in that zone. Injected so the whole function is pure
 *              and "what does `period=week` mean on a Sunday" is a test rather
 *              than something you find out in production.
 */
export function resolveRange(
  query: RangeQuery,
  tz: string,
  today?: string
): RangeResult {
  const { zone } = zoneOrUTC(tz);
  const anchorToday = today ?? todayIn(zone);

  const from = trimmed(query.from);
  const to = trimmed(query.to);
  const period = trimmed(query.period);
  const date = trimmed(query.date);

  // Both spellings at once is ambiguous, and guessing which the caller meant is
  // how an agent ends up publishing a different week than it thinks it asked
  // for. Refusing costs one round trip and no surprises.
  if ((from || to) && period) {
    return { error: "Use either period, or from and to — not both." };
  }

  if (from || to) {
    if (!from || !to) {
      return { error: "from and to must be given together, as YYYY-MM-DD." };
    }
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return { error: "from and to must be dates, as YYYY-MM-DD." };
    }
    if (!isRealDate(from, zone) || !isRealDate(to, zone)) {
      return { error: "from and to must be real dates." };
    }
    if (from > to) {
      return { error: "from must not be after to." };
    }
    return capped({ from, to }, zone);
  }

  if (period && !isPeriod(period)) {
    return { error: `period must be one of: ${PERIODS.join(", ")}.` };
  }
  if (date && (!ISO_DATE.test(date) || !isRealDate(date, zone))) {
    return { error: "date must be a real date, as YYYY-MM-DD." };
  }

  const anchor = date || anchorToday;

  // No period and no range asked for: a week, because that is the unit the
  // planner works in and the one a scheduling agent asks for by default.
  switch ((period as Period) || "week") {
    case "day":
      return { range: { from: anchor, to: anchor } };

    case "week": {
      const span = weekSpanOf(weekKeyOf(anchor, zone), zone);
      if (!span) return { error: "That date does not resolve to a week." };
      return { range: { from: span.start, to: span.end } };
    }

    case "month": {
      const dt = DateTime.fromISO(anchor, { zone });
      if (!dt.isValid) return { error: "That date does not resolve to a month." };
      return {
        range: {
          from: dt.startOf("month").toISODate() as string,
          to: dt.endOf("month").toISODate() as string,
        },
      };
    }
  }
}

function capped(range: Range, zone: string): RangeResult {
  const start = DateTime.fromISO(range.from, { zone });
  const end = DateTime.fromISO(range.to, { zone });
  // startOf("day") on both ends: without it a DST transition inside the window
  // makes the diff 91.96 days and a legal request fails one week a year.
  const days =
    end.startOf("day").diff(start.startOf("day"), "days").days + 1;
  if (days > MAX_RANGE_DAYS) {
    return { error: `Ask for at most ${MAX_RANGE_DAYS} days at a time.` };
  }
  return { range };
}

/** Catches 2026-02-30, which matches the regex and is not a day. */
function isRealDate(date: string, zone: string): boolean {
  const dt = DateTime.fromISO(date, { zone });
  return dt.isValid && dt.toISODate() === date;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
