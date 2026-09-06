// Server-only Firestore access for committed slots.
//
// A slot is created exactly one way — by accepting a plan, in
// planner/commit.ts. This module never creates one; it reads them back and
// applies the small set of edits a human is allowed to make.

import { db, COLLECTIONS, FieldValue, serializeSlot } from "../firestore";
import { SLOT_STATUSES, type SlotStatus } from "./planner/types";
import type { Slot } from "../types";

export interface ListSlotsOptions {
  /** Inclusive ISO date bounds, in the client's local calendar. */
  start?: string;
  end?: string;
  /** Omit to include every status, cancelled and skipped included. */
  status?: string;
}

/**
 * Filtered on clientId only, with the date range and status narrowed in
 * memory. Same reasoning as loadPlannerSlots (see plan-runs.ts): adding either
 * to the query needs a composite index, and a client's slots are bounded at a
 * few hundred a year, so this keeps the app running with zero Firestore setup.
 */
export async function listSlots(
  clientId: string,
  opts: ListSlotsOptions = {}
): Promise<Slot[]> {
  const snap = await db()
    .collection(COLLECTIONS.slots)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => serializeSlot(doc.id, doc.data()))
    .filter((slot) => {
      if (opts.start && slot.date < opts.start) return false;
      if (opts.end && slot.date > opts.end) return false;
      if (opts.status && slot.status !== opts.status) return false;
      return true;
    })
    // date + time rather than scheduled_at: a slot whose UTC instant failed to
    // resolve still sorts sensibly instead of sinking to the top.
    .sort((a, b) =>
      `${a.date} ${a.time_local}`.localeCompare(`${b.date} ${b.time_local}`)
    );
}

export async function getSlot(clientId: string, slotId: string): Promise<Slot | null> {
  const snap = await db().collection(COLLECTIONS.slots).doc(slotId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  // The id is guessable, so ownership is checked rather than assumed.
  if (data.clientId !== clientId) return null;
  return serializeSlot(snap.id, data);
}

export function isSlotStatus(value: unknown): value is SlotStatus {
  return typeof value === "string" && (SLOT_STATUSES as readonly string[]).includes(value);
}

export interface SlotPatch {
  status?: SlotStatus;
  pinned?: boolean;
}

/**
 * Apply a human edit.
 *
 * Deliberately narrow: dates, channels and themes are the planner's output and
 * changing one here would put the slot out of step with the plan run that
 * produced it. What a human legitimately does is confirm it, mark it posted,
 * cancel it, or pin it so the planner leaves it alone.
 *
 * Cancelling matters more than it looks: QUOTA_COUNTING in planner/types.ts
 * counts only planned/confirmed/drafted/posted, so a cancelled slot frees its
 * quota and the next run proposes a replacement.
 */
export async function updateSlot(
  clientId: string,
  slotId: string,
  patch: SlotPatch
) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  const update: Record<string, unknown> = {
    lastHumanEditAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.pinned !== undefined) update.pinned = patch.pinned;

  await db().collection(COLLECTIONS.slots).doc(slotId).update(update);
  return getSlot(clientId, slotId);
}
