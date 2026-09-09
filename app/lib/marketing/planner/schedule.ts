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

import type { QuotaEntry } from "../strategy";
import { contentTypeLabel } from "../content-types";

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

/**
 * A warning when a week would go over its quota, or null.
 *
 * `load` is the count BEFORE adding this piece, so the comparison is against
 * `load + 1`. A type with no quota entry, or a count of zero, is uncapped and
 * never warns — the quota is a pace the operator chose, and its absence means
 * they chose not to set one.
 */
export function quotaWarning(
  weekKey: string,
  type: string,
  load: number,
  quota: Record<string, QuotaEntry>
): string | null {
  const cap = quota[type]?.count ?? 0;
  if (cap <= 0) return null;

  const after = load + 1;
  if (after <= cap) return null;

  return `${weekKey} would have ${after} ${contentTypeLabel(type).toLowerCase()} pieces against a weekly cap of ${cap}.`;
}
