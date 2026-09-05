import { DateTime } from "luxon";

// ISO week arithmetic, always resolved in the CLIENT's timezone.
//
// Every scheduling decision is made in the client's local time. A slot at 08:00
// local in UTC-5 is 13:00 UTC, so near a week boundary a UTC-only model files it
// in the wrong week and the quota math silently drifts.

export interface WeekSpan {
  /** ISO week key, e.g. "2026-W38". */
  weekKey: string;
  /** Monday, "YYYY-MM-DD" local. */
  start: string;
  /** Sunday, "YYYY-MM-DD" local. */
  end: string;
}

function localDate(date: string, tz: string): DateTime {
  return DateTime.fromISO(date, { zone: tz });
}

export function weekKeyFrom(dt: DateTime): string {
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, "0")}`;
}

/** The ISO week key a local calendar date falls in, per the client's timezone. */
export function weekKeyOf(date: string, tz: string): string {
  return weekKeyFrom(localDate(date, tz));
}

/** Today's local calendar date in the client's timezone. */
export function todayIn(tz: string, now?: DateTime): string {
  return (now ?? DateTime.now()).setZone(tz).toISODate() as string;
}

/**
 * The horizon, starting with the week containing `fromISO`.
 *
 * Weeks advance with plus({weeks: 1}) and the key is re-read from luxon each
 * step. Never increment the week NUMBER: ISO years have 52 or 53 weeks (2026
 * has a W53), so arithmetic on the number invents a "2026-W54" instead of
 * rolling into 2027-W01.
 */
export function horizonWeeks(fromISO: string, weeks: number, tz: string): WeekSpan[] {
  const spans: WeekSpan[] = [];
  let cursor = localDate(fromISO, tz).startOf("week");

  for (let i = 0; i < Math.max(1, weeks); i++) {
    spans.push({
      weekKey: weekKeyFrom(cursor),
      start: cursor.toISODate() as string,
      end: cursor.endOf("week").toISODate() as string,
    });
    cursor = cursor.plus({ weeks: 1 });
  }
  return spans;
}

/** Every local date in a week span, Monday through Sunday. */
export function daysInSpan(span: WeekSpan, tz: string): string[] {
  const out: string[] = [];
  let cursor = localDate(span.start, tz);
  const end = localDate(span.end, tz);
  while (cursor <= end) {
    out.push(cursor.toISODate() as string);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

/** ISO weekday for a local date: 1 = Monday ... 7 = Sunday, matching POSTING_WINDOWS. */
export function weekdayOf(date: string, tz: string): number {
  return localDate(date, tz).weekday;
}

/**
 * Convert a local date + "HH:mm" in the client's timezone to the exact UTC
 * instant, or null if that local time does not exist.
 *
 * This is the only place local time becomes absolute time, and the reason
 * luxon is a dependency: 09:00 America/New_York is 14:00Z on 2026-03-01 but
 * 13:00Z on 2026-03-08, because DST starts between them.
 *
 * The round-trip comparison is NOT redundant with isValid. On a spring-forward
 * gap luxon silently shifts the time forward and still reports isValid: true —
 * verified: asking for 2026-03-08T02:30 America/New_York yields 03:30-04:00.
 * Only comparing the formatted result back against the input catches it. The
 * current posting windows (08:00-19:30) never hit a US transition, but
 * America/Santiago, Asia/Beirut and Cuba all transition at midnight.
 *
 * Fall-back ambiguity (a local time occurring twice) is not an error: luxon
 * deterministically picks the earlier offset, which is fine for scheduling.
 */
export function toUtcInstant(date: string, timeLocal: string, tz: string): Date | null {
  const dt = DateTime.fromISO(`${date}T${timeLocal}`, { zone: tz });
  if (!dt.isValid) return null;
  if (dt.toFormat("yyyy-MM-dd") !== date) return null;
  if (dt.toFormat("HH:mm") !== timeLocal) return null;
  return dt.toUTC().toJSDate();
}

/**
 * Guard against a bad timezone on the client record. An unsupported zone makes
 * every luxon operation invalid, so fall back to UTC and say so rather than
 * producing a calendar of invalid dates.
 */
export function zoneOrUTC(tz: string): { zone: string; warning: string | null } {
  if (tz && DateTime.now().setZone(tz).isValid) return { zone: tz, warning: null };
  return {
    zone: "UTC",
    warning: `Client timezone "${tz}" is not a valid IANA zone; planned in UTC.`,
  };
}

/** Add minutes to a "HH:mm" local time, clamped within the same day. */
export function addMinutes(timeLocal: string, minutes: number): string {
  const [h, m] = timeLocal.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Absolute minutes since local midnight, for comparing two "HH:mm" values. */
export function minutesOf(timeLocal: string): number {
  const [h, m] = timeLocal.split(":").map(Number);
  return h * 60 + m;
}

/** Short weekday label ("Mon") for display. */
export function weekdayLabel(date: string, tz: string): string {
  return localDate(date, tz).toFormat("ccc");
}
