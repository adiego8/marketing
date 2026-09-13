// Giving a piece a day.
//
// Scheduling used to happen inside planning: assign.ts placed every proposed
// piece on a date before anyone had read it. It is a human step now, so the
// rules that used to be enforced in code are advice given at the moment of the
// decision — the quota says how much of a type belongs in a week, and this
// tells you when a choice exceeds it. It never refuses. The operator is the one
// who knows why this week is different.
//
// Pure: no Firestore, no dates of its own. `now` and the timezone are the
// caller's business.

import { contentTypeLabel } from "../content-types";

/**
 * The quota, as this module needs to see it.
 *
 * Only the cap is read here — channels are a generation concern, not a pacing
 * one — so the parameter asks for exactly that. lib/types and lib/marketing/
 * strategy each declare a QuotaEntry whose `channels` differ (loose strings vs
 * the Channel union), and depending on either would force one call site or the
 * other into a cast that asserts something it has not checked.
 */
export type WeeklyCaps = Record<string, { count: number }>;

/** A slot as this module needs to see it — what listSlots already returns. */
export interface ScheduledSlot {
  id: string;
  date: string | null;
  weekKey: string | null;
  type: string;
  status: string;
}

/**
 * How many pieces of a type already sit in a week.
 *
 * Counted from week_key rather than recomputed from the date: it is
 * denormalized on the slot exactly so this needs no date arithmetic, and a
 * slot whose date failed to resolve still counts where it was put.
 *
 * `exclude` is the slot being moved — rescheduling a piece within its own week
 * must not count it against itself.
 */
export function weekLoad(
  slots: ScheduledSlot[],
  weekKey: string,
  type: string,
  exclude?: string
): number {
  return slots.filter(
    (s) =>
      s.id !== exclude &&
      s.weekKey === weekKey &&
      s.type === type &&
      countsTowardWeek(s.status)
  ).length;
}

/** Cancelled and skipped pieces free their place, as they do for demand. */
function countsTowardWeek(status: string): boolean {
  return status !== "cancelled" && status !== "skipped";
}

/** "4 posts", "1 reel" — the plural the messages below both need. */
function countOf(n: number, type: string): string {
  const label = contentTypeLabel(type).toLowerCase();
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

/**
 * A warning when a week would go over its quota, or null.
 *
 * `load` is the count BEFORE adding this piece, so the comparison is against
 * `load + 1`. A type with no quota entry, or a count of zero, is uncapped and
 * never warns — the quota is a pace the operator chose, and its absence means
 * they chose not to set one.
 *
 * Takes the week's LABEL, not its key: this string is read by a person, and
 * "2026-W39 would have 4 posts" tells them nothing about which days those are.
 * Formatting stays with the caller so this module needs no timezone and no
 * luxon.
 */
export function quotaWarning(
  weekLabel: string,
  type: string,
  load: number,
  quota: WeeklyCaps
): string | null {
  const cap = quota[type]?.count ?? 0;
  if (cap <= 0) return null;

  const after = load + 1;
  if (after <= cap) return null;

  return `${weekLabel} would have ${countOf(after, type)} against a weekly cap of ${cap}.`;
}

export interface OverCap {
  type: string;
  load: number;
  cap: number;
  /** Ready to render: "4 posts against a weekly cap of 3". */
  text: string;
}

/**
 * Which types a week is already over on.
 *
 * The reverse of quotaWarning: that one answers "would this piece take the week
 * over", asked at the moment of the decision; this answers "is the week over
 * already", asked when reading the calendar. Same rule for what is uncapped.
 */
export function overCap(
  slots: ScheduledSlot[],
  weekKey: string,
  quota: WeeklyCaps
): OverCap[] {
  const types = new Set(
    slots.filter((s) => s.weekKey === weekKey).map((s) => s.type)
  );

  return [...types]
    .map((type) => {
      const cap = quota[type]?.count ?? 0;
      const load = weekLoad(slots, weekKey, type);
      return {
        type,
        load,
        cap,
        text: `${countOf(load, type)} against a weekly cap of ${cap}`,
      };
    })
    .filter((row) => row.cap > 0 && row.load > row.cap)
    .sort((a, b) => a.type.localeCompare(b.type));
}
