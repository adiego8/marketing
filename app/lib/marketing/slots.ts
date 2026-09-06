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

/** What a person may change about a committed slot. */
export interface SlotPatch {
  status?: SlotStatus;
  pinned?: boolean;
  theme?: string;
  brief?: string;
  rationale?: string;
  hook?: string;
  body?: string[];
  cta?: string;
}

/** The content half, so the regenerate path can share the write. */
export const CONTENT_FIELDS = [
  "theme",
  "brief",
  "rationale",
  "hook",
  "body",
  "cta",
] as const;

/**
 * Apply an edit to a committed slot.
 *
 * Scheduling stays the planner's: date, time, channel and type are not
 * editable here, because moving one would put the slot out of step with the
 * capacity and spacing rules that placed it. Everything a person actually
 * disagrees with — the theme, the hook, the beats, the ask — is fair game, as
 * is the status.
 *
 * Cancelling matters more than it looks: QUOTA_COUNTING in planner/types.ts
 * counts only planned/confirmed/drafted/posted, so a cancelled slot frees its
 * quota and the next run proposes a replacement.
 *
 * @param byHuman false when the model wrote this, so lastHumanEditAt — which
 *   is how reconciliation will tell a hand edit from agent output — is not
 *   stamped by a regenerate.
 */
export async function updateSlot(
  clientId: string,
  slotId: string,
  patch: SlotPatch,
  byHuman = true
) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (byHuman) update.lastHumanEditAt = FieldValue.serverTimestamp();

  if (patch.status !== undefined) update.status = patch.status;
  if (patch.pinned !== undefined) update.pinned = patch.pinned;
  for (const key of CONTENT_FIELDS) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }

  // A theme written by hand must clear needsTheme, or the slot keeps its red
  // "needs theme" pill and keeps writing "Theme not set" into its calendar
  // event.
  if (patch.theme !== undefined) update.needsTheme = patch.theme.trim() === "";

  // The Google event is built from these fields, so changing one makes it
  // stale. syncSlots patches by googleEventId and rebuilds the body from
  // scratch, so the next sync fixes it — but nothing triggers a sync, and
  // without this the slot would keep claiming to be in step.
  const touchedContent = CONTENT_FIELDS.some((k) => patch[k] !== undefined);
  if (touchedContent && existing.google_sync_status === "synced") {
    update.googleSyncStatus = "stale";
  }

  await db().collection(COLLECTIONS.slots).doc(slotId).update(update);
  return getSlot(clientId, slotId);
}
