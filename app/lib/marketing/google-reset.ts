// Forgetting Google: what to write when a calendar link has to be dropped.
//
// Two callers need exactly the same thing. Disconnecting an account makes every
// calendar we created unreachable, and a calendar deleted by hand in Google
// makes one of them unreachable. Both leave Firestore holding ids that resolve
// to nothing, and the cure in both cases is to forget them so the next sync
// creates fresh ones.
//
// The payloads are pure and tested, because getting a field NAME wrong here is
// silent: the write succeeds, the stale id survives under its real name, and
// the 404s continue. firestore.test.ts exists because of exactly that bug once
// already — a slot written with `calendarEventId` where `googleEventId` was
// read — so the shapes below are pinned by tests the same way commit.test.ts
// pins what a committed slot looks like.
//
// The I/O underneath them is untestable by this repo's rules (nothing is
// mocked), so it is kept deliberately thin: query, filter, batch, commit.

import { db, COLLECTIONS, FieldValue } from "../firestore";

/**
 * What a slot looks like once we have forgotten its Google event.
 *
 * `googleEventId: null` is the load-bearing field — the same reason
 * cancelFromGoogle clears it. While it is set, syncSlots patches that id and
 * only creates a new event if patching 404s, so leaving it would make every
 * future sync take the recreate path against a calendar that no longer exists.
 *
 * "pending", not "removed": "removed" means we deleted the event from Google,
 * which is precisely what this does NOT do. The event is still sitting in the
 * old account. We have stopped tracking it.
 *
 * googleEventLocked goes back to false because the lock is a statement about a
 * specific remote event — "a human edited this one, stop rewriting it". Carried
 * onto a fresh event it would suppress the first title we ever write.
 */
export function slotGoogleReset(): Record<string, unknown> {
  return {
    googleEventId: null,
    googleSyncStatus: "pending",
    googleSyncError: null,
    googleEventTitle: null,
    googleEventBodyHash: null,
    googleEventLocked: false,
    googleAdoptedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * What a client looks like once its calendar is forgotten.
 *
 * Clearing googleCalendarId is what lets ensureClientCalendar mint a new one —
 * it only creates when the field is empty, so this is the single switch that
 * turns a permanent 404 back into a working calendar.
 */
export function clientGoogleReset(): Record<string, unknown> {
  return {
    googleCalendarId: null,
    googleSyncedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Does this slot document carry any Google state worth clearing?
 *
 * Most slots in a reset have never reached Google — they are unscheduled, or
 * were written after the last sync — and rewriting them would burn batch
 * capacity and bump `updatedAt` on documents nothing happened to.
 *
 * Takes the raw Firestore data rather than a serialized Slot so the caller does
 * not have to serialize a few hundred documents just to decide whether to skip
 * them.
 */
export function needsGoogleReset(d: Record<string, unknown>): boolean {
  if (d.googleEventId) return true;
  if (d.googleEventLocked === true) return true;
  if (d.googleEventTitle || d.googleEventBodyHash) return true;
  if (d.googleAdoptedAt) return true;
  if (d.googleSyncError) return true;
  // "pending" is the default for a slot that has never been near Google, so it
  // is the one status that means there is nothing to undo.
  const status = d.googleSyncStatus;
  return typeof status === "string" && status !== "" && status !== "pending";
}

/** Firestore caps a WriteBatch at 500 ops; 400 leaves room, as plan-runs does. */
const CHUNK = 400;

export interface ClearedGoogleState {
  /** Clients whose calendar link was dropped. */
  clients: number;
  /** Slots that had Google state and no longer do. */
  slots: number;
}

/**
 * Forget one client's calendar and every event on it.
 *
 * Slots are queried on clientId alone and filtered in memory — slot documents
 * carry no agencyId, and adding a second condition would need a composite
 * index. Same reasoning as loadPlannerSlots and listSlots.
 *
 * Nothing is deleted from Google. The calendar and its events stay in whichever
 * account owns them; this only drops our pointers at them.
 */
export async function clearClientGoogleState(
  clientId: string
): Promise<ClearedGoogleState> {
  const clientRef = db().collection(COLLECTIONS.clients).doc(clientId);
  const clientSnap = await clientRef.get();
  const hadCalendar = !!clientSnap.data()?.googleCalendarId;

  const slotSnap = await db()
    .collection(COLLECTIONS.slots)
    .where("clientId", "==", clientId)
    .get();

  const stale = slotSnap.docs.filter((doc) => needsGoogleReset(doc.data() ?? {}));

  for (let i = 0; i < stale.length; i += CHUNK) {
    const batch = db().batch();
    for (const doc of stale.slice(i, i + CHUNK)) {
      batch.update(doc.ref, slotGoogleReset());
    }
    await batch.commit();
  }

  // Last, and on its own: while googleCalendarId is still set the state is
  // merely stale, which is where we started. If the slot writes above fail
  // half-way, a retry finds the same calendar id and finishes the job. Clearing
  // it first would leave orphaned slot state with nothing pointing at it.
  if (hadCalendar) await clientRef.update(clientGoogleReset());

  return { clients: hadCalendar ? 1 : 0, slots: stale.length };
}

/**
 * Forget every calendar this agency owns.
 *
 * Called when the Google account is disconnected: the grant is about to go, so
 * every calendar it created becomes unreachable, and every id we hold becomes a
 * guaranteed 404 for whichever account connects next.
 */
export async function clearAgencyGoogleState(
  agencyId: string
): Promise<ClearedGoogleState> {
  const snap = await db()
    .collection(COLLECTIONS.clients)
    .where("agencyId", "==", agencyId)
    .get();

  const total: ClearedGoogleState = { clients: 0, slots: 0 };
  for (const doc of snap.docs) {
    const cleared = await clearClientGoogleState(doc.id);
    total.clients += cleared.clients;
    total.slots += cleared.slots;
  }
  return total;
}

/**
 * How many of this agency's clients currently hold a calendar link.
 *
 * Only so the disconnect confirmation can name a true number instead of
 * threatening "every client" when the real answer might be none.
 */
export async function countLinkedClients(agencyId: string): Promise<number> {
  const snap = await db()
    .collection(COLLECTIONS.clients)
    .where("agencyId", "==", agencyId)
    .get();
  return snap.docs.filter((doc) => !!doc.data()?.googleCalendarId).length;
}
