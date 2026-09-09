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
  /**
   * "scheduled" — has a date, the default shape a range implies.
   * "unscheduled" — accepted but not yet given a day.
   * Omit for both.
   *
   * Explicit rather than implied, because an undated slot passes no date range
   * and would otherwise be invisible to every caller that passes one — which
   * is exactly how a piece could be accepted and then never seen again.
   */
  dated?: "scheduled" | "unscheduled";
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
      if (opts.dated === "scheduled" && !slot.date) return false;
      if (opts.dated === "unscheduled" && slot.date) return false;
      // A date range can only ever be about scheduled slots; an undated one is
      // in no range rather than outside every one.
      if (slot.date) {
        if (opts.start && slot.date < opts.start) return false;
        if (opts.end && slot.date > opts.end) return false;
      } else if (opts.start || opts.end) {
        return false;
      }
      if (opts.status && slot.status !== opts.status) return false;
      return true;
    })
    // date + time rather than scheduled_at: a slot whose UTC instant failed to
    // resolve still sorts sensibly instead of sinking to the top. Undated ones
    // sort first, which is where they belong — they are the work waiting.
    .sort((a, b) =>
      `${a.date ?? ""} ${a.time_local ?? ""}`.localeCompare(
        `${b.date ?? ""} ${b.time_local ?? ""}`
      )
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
  /**
   * The finished copy — what actually gets posted. Written by write-copy.ts and
   * hand-editable; null clears it. See lib/marketing/copy.ts for the shape.
   */
  content?: Record<string, unknown> | null;
}

/**
 * The brief half, so the regenerate path can share the write.
 *
 * Named BRIEF_FIELDS rather than CONTENT_FIELDS since Phase 6: `content` is now
 * the finished copy, a different thing from the brief these six fields make up,
 * and the old name sat awkwardly beside content_plan, content_quota and
 * content_strategy already.
 */
export const BRIEF_FIELDS = [
  "theme",
  "brief",
  "rationale",
  "hook",
  "body",
  "cta",
] as const;

/**
 * Everything the Google Calendar event is rendered from.
 *
 * Kept separate from BRIEF_FIELDS, which the write loop above iterates and
 * which reads as "the brief". This one exists for exactly one reason: since
 * Phase 6 eventDescription renders the copy when there is any, so writing copy
 * makes the event stale just as editing the hook does.
 */
const EVENT_FIELDS = [...BRIEF_FIELDS, "content"] as const;

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
  for (const key of BRIEF_FIELDS) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }
  // Separate from the loop above: null is a meaningful value here (it clears
  // the copy), so this cannot use the same `!== undefined` sweep over a tuple
  // that BRIEF_FIELDS keys.
  if (patch.content !== undefined) update.content = patch.content;

  // A theme written by hand must clear needsTheme, or the slot keeps its red
  // "needs theme" pill and keeps writing "Theme not set" into its calendar
  // event.
  if (patch.theme !== undefined) update.needsTheme = patch.theme.trim() === "";

  // The Google event is built from these fields, so changing one makes it
  // stale. syncSlots patches by googleEventId and rebuilds the body from
  // scratch, so the next sync fixes it — but nothing triggers a sync, and
  // without this the slot would keep claiming to be in step.
  //
  // "synced" and not "locked" deliberately: a locked slot's text is Google's
  // now, so the next sync will NOT carry this edit across, and calling it
  // stale would light "N changed since the last sync" with no sync able to
  // clear it. Locked stays locked until someone takes it back.
  const touchedContent = EVENT_FIELDS.some((k) => patch[k] !== undefined);
  if (touchedContent && existing.google_sync_status === "synced") {
    update.googleSyncStatus = "stale";
  }

  await db().collection(COLLECTIONS.slots).doc(slotId).update(update);
  return getSlot(clientId, slotId);
}

/* ----------------------------------------------------- reconciliation --- */
//
// Three writes that only syncSlots makes, when it finds that a person changed
// something in Google. They are here rather than in calendar.ts so every write
// to a slot document goes through one module.

/**
 * Move a committed slot because its event was moved in Google.
 *
 * THE ONLY place scheduling changes after commit. updateSlot refuses these
 * fields on purpose — a hand edit that moved a date would put the slot out of
 * step with the capacity and spacing rules that placed it. This is the
 * exception because the move already happened: the event IS on Thursday, and
 * refusing to record that would just make the app wrong.
 *
 * lastHumanEditAt is stamped: a person did this, in Google. googleEventStart is
 * not stored anywhere — what we last pushed is always eventTimes(slot), so
 * writing the schedule is what makes the next comparison come back clean.
 */
export async function adoptSlotSchedule(
  clientId: string,
  slotId: string,
  schedule: { date: string; timeLocal: string; weekKey: string; scheduledAt: string }
) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  await db()
    .collection(COLLECTIONS.slots)
    .doc(slotId)
    .update({
      date: schedule.date,
      timeLocal: schedule.timeLocal,
      weekKey: schedule.weekKey,
      scheduledAt: schedule.scheduledAt,
      googleAdoptedAt: FieldValue.serverTimestamp(),
      lastHumanEditAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  return getSlot(clientId, slotId);
}

/**
 * Give a slot a day, or move it to another one.
 *
 * The counterpart to adoptSlotSchedule: same four fields, written together,
 * different provenance. That one records a move that already happened in
 * Google; this one is a person choosing a day in this app, so googleAdoptedAt
 * stays put and the next sync sees a slot whose event needs creating or moving.
 *
 * updateSlot still refuses these fields. Scheduling is not a field edit — it is
 * the step that turns an accepted piece into a calendar entry — and routing it
 * through its own function is what keeps that visible.
 *
 * The caller derives weekKey and scheduledAt from the date, since both need the
 * client's timezone: weekKeyOf and toUtcInstant in planner/weeks.ts.
 */
export async function scheduleSlot(
  clientId: string,
  slotId: string,
  schedule: {
    date: string;
    timeLocal: string;
    weekKey: string;
    scheduledAt: string | null;
  }
) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  await db()
    .collection(COLLECTIONS.slots)
    .doc(slotId)
    .update({
      date: schedule.date,
      timeLocal: schedule.timeLocal,
      weekKey: schedule.weekKey,
      scheduledAt: schedule.scheduledAt,
      // Whatever was pushed before is now wrong. Marking it stale rather than
      // leaving it "synced" is what makes the next sync move the event.
      googleSyncStatus: existing.google_event_id ? "stale" : "pending",
      lastHumanEditAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  return getSlot(clientId, slotId);
}

/**
 * Cancel a slot whose event is gone from Google.
 *
 * All three fields in one write, and googleEventId: null is the load-bearing
 * one. Without it the next sync takes the cancelled/skipped branch in
 * syncSlots, tries to delete an event that is already gone, and reports a
 * removal the app did not make.
 *
 * Cancelling frees the gap — countsAgainstQuota excludes it — so the next plan
 * run for that campaign may propose a replacement. The sync message says so.
 */
export async function cancelFromGoogle(clientId: string, slotId: string) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  await db().collection(COLLECTIONS.slots).doc(slotId).update({
    status: "cancelled",
    googleEventId: null,
    googleSyncStatus: "removed",
    lastHumanEditAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return getSlot(clientId, slotId);
}

/**
 * Hand the event's text to Google, or take it back.
 *
 * One flag for title and description together: rule 3 was decided as "stop
 * overwriting it", and someone who retitles an event has almost always retyped
 * the body too. Two independent flags would double the state space for a case
 * nobody hits.
 *
 * Unlocking sets the slot stale so the next sync pushes the app's text back —
 * otherwise "take it back" would leave the event unchanged until someone
 * happened to edit the slot.
 *
 * @param fingerprint what the event now says, passed when LOCKING. Recording
 *   it is what makes the lock settle, and it fixes two bugs at once:
 *
 *   - without it the fingerprint keeps the app's old title forever, so every
 *     subsequent sync re-detects the same hand edit and re-reports it;
 *   - and "take it back" could never work, because reconcile runs before the
 *     push and would re-lock the slot on that same stale comparison before the
 *     push ever got to overwrite the event.
 *
 *   With it, the fingerprint means what it says — "what is on the event" — so
 *   an unlocked slot compares equal, survives reconcile, and gets overwritten
 *   by the push pass exactly as asked.
 */
export async function setEventLock(
  clientId: string,
  slotId: string,
  locked: boolean,
  fingerprint?: { title: string; bodyHash: string }
) {
  const existing = await getSlot(clientId, slotId);
  if (!existing) return null;

  await db()
    .collection(COLLECTIONS.slots)
    .doc(slotId)
    .update({
      googleEventLocked: locked,
      googleSyncStatus: locked ? "locked" : "stale",
      ...(fingerprint
        ? {
            googleEventTitle: fingerprint.title,
            googleEventBodyHash: fingerprint.bodyHash,
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  return getSlot(clientId, slotId);
}
