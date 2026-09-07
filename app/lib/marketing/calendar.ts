// Pushing committed slots to Google Calendar.
//
// Sync is deliberately NOT part of accepting a plan. That write is an atomic
// Firestore batch, and an external API call cannot join a transaction: a
// Google failure mid-batch would either roll back slots that were already
// created upstream, or leave the two stores disagreeing with no record of it.
//
// So commit writes slots with googleSyncStatus "pending", and this runs
// afterwards as a separate, retryable pass. That is what the field was for.

import { google, type calendar_v3 } from "googleapis";
import { DateTime } from "luxon";
import { db, COLLECTIONS, FieldValue, serializeSlot } from "../firestore";
import { getAuthorizedClient, NotConnectedError } from "./google";
import { contentTypeLabel } from "./content-types";
import { readCopy, isCopyStale, copyToLines } from "./copy";
import { adoptSlotSchedule, cancelFromGoogle, setEventLock } from "./slots";
import {
  classify,
  describeChange,
  deterministicEventId,
  hashBody,
  plannerWarnings,
  type Divergence,
  type RemoteEvent,
} from "./reconcile";
import type { Slot } from "../types";

const EVENT_MINUTES = 30;

/* ------------------------------------------------------------- the event -- */

export function eventTitle(slot: Slot): string {
  const format = contentTypeLabel(slot.type);
  const channel = slot.channel.charAt(0).toUpperCase() + slot.channel.slice(1);
  const subject = slot.needs_theme || !slot.theme ? "Theme not set" : slot.theme;
  return `${channel} · ${format} — ${subject}`;
}

/**
 * The piece, in the event body.
 *
 * A calendar event is often the only surface someone sees on the day, so it
 * carries everything needed to actually make the piece rather than a link back
 * to the app. Since Phase 6 that means the finished copy where there is any —
 * you should be able to post from your phone.
 *
 * Three branches, and the middle one is the reason the third exists:
 *
 *  - no copy: exactly what this produced before Phase 6, byte for byte.
 *  - fresh copy: the words replace HOOK / BODY / CTA. The brief is what the
 *    copy was written from; repeating both is noise.
 *  - STALE copy: the brief has moved since the copy was written, so BOTH are
 *    shown and the mismatch is named. Without this branch, regenerating a
 *    slot's brief after its copy was synced leaves the calendar showing words
 *    written from a brief nobody can see, with no signal at all.
 */
export function eventDescription(slot: Slot, appUrl?: string): string {
  const lines: string[] = [];
  const copy = readCopy(slot);
  const stale = copy !== null && isCopyStale(slot);

  lines.push(`${contentTypeLabel(slot.type)} · ${slot.channel}`);
  lines.push("");

  if (slot.needs_theme || !slot.theme) {
    lines.push("THEME");
    lines.push("Not set — the planner could not reach the model for this slot.");
  } else {
    lines.push("THEME");
    lines.push(slot.theme);
  }
  lines.push("");

  if (copy) {
    if (stale) {
      lines.push("HEADS UP");
      lines.push("The brief below was changed after this copy was written.");
      lines.push("");
    }
    lines.push(...copyToLines(copy));
  }

  // The brief: on its own when there is no copy, and alongside stale copy so
  // the newer thinking is visible. Suppressed under fresh copy, which says the
  // same thing in finished words.
  if (!copy || stale) {
    if (slot.brief) {
      lines.push("IN ONE LINE");
      lines.push(slot.brief);
      lines.push("");
    }
    if (slot.hook) {
      lines.push("HOOK");
      lines.push(slot.hook);
      lines.push("");
    }
    if (slot.body?.length) {
      lines.push("BODY");
      // Numbered because the order is the piece: slide 1, shot 1, tweet 1.
      slot.body.forEach((beat, i) => lines.push(`${i + 1}. ${beat}`));
      lines.push("");
    }
    if (slot.cta) {
      lines.push("CTA");
      lines.push(slot.cta);
      lines.push("");
    }
  }

  if (slot.campaign_title) {
    lines.push("CAMPAIGN");
    lines.push(slot.campaign_title);
    lines.push("");
  }
  if (slot.rationale) {
    lines.push("WHY THIS, HERE");
    lines.push(slot.rationale);
    lines.push("");
  }

  const link = appUrl && slot.client_id
    ? `${appUrl}/clients/${slot.client_id}/schedule`
    : null;

  const body = lines.join("\n").trim();
  return truncateDescription(body, link);
}

/**
 * Google rejects an event description over about 8 KB with a 400.
 *
 * Before Phase 6 the worst case was a few kilobytes and this could not fire.
 * Full copy — a dozen blocks plus a caption — can reach four times the limit,
 * and the failure would land on exactly the most content-rich slots in the
 * plan, parking them in googleSyncStatus "error".
 *
 * The link is appended AFTER truncating rather than trimmed with everything
 * else, because it is the escape hatch: a truncated event is only useful if it
 * still says where to read the rest.
 */
export const MAX_EVENT_DESCRIPTION_CHARS = 7500;

function truncateDescription(body: string, link: string | null): string {
  const tail = link ? `\n\n${link}` : "";
  const room = MAX_EVENT_DESCRIPTION_CHARS - tail.length;

  if (body.length <= room) return `${body}${tail}`;

  const notice = "\n\n… truncated — open the app for the rest.";
  return `${body.slice(0, room - notice.length).trimEnd()}${notice}${tail}`;
}

/**
 * Start and end as an RFC3339 instant plus the client's IANA zone.
 *
 * The Python app hardcoded UTC for both calendars and events, so an event
 * planned for 9am local showed at 9am UTC. Slots carry a real timezone, so
 * this uses it: Google then renders the event correctly for any viewer, and
 * DST is Google's problem rather than ours.
 */
function eventTimes(slot: Slot): { start: calendar_v3.Schema$EventDateTime; end: calendar_v3.Schema$EventDateTime } {
  const zone = slot.timezone || "UTC";
  const start =
    DateTime.fromISO(`${slot.date}T${slot.time_local}`, { zone }) ??
    DateTime.fromISO(slot.scheduled_at ?? "", { zone });
  const startDt = start.isValid
    ? start
    : DateTime.fromISO(slot.scheduled_at ?? "").setZone(zone);

  return {
    start: { dateTime: startDt.toISO() ?? undefined, timeZone: zone },
    end: { dateTime: startDt.plus({ minutes: EVENT_MINUTES }).toISO() ?? undefined, timeZone: zone },
  };
}

/* ------------------------------------------------------- the calendar --- */

/**
 * One calendar per client, created on first use and remembered on the client
 * document. Idempotent: a second call returns the stored id.
 */
export async function ensureClientCalendar(
  agencyId: string,
  clientId: string
): Promise<string> {
  const ref = db().collection(COLLECTIONS.clients).doc(clientId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Client not found");

  const existing = snap.data()?.googleCalendarId;
  if (typeof existing === "string" && existing) return existing;

  const auth = await getAuthorizedClient(agencyId);
  if (!auth) throw new NotConnectedError();

  const name = String(snap.data()?.name ?? "Client");
  const timezone = String(snap.data()?.timezone ?? "UTC");

  const calendar = google.calendar({ version: "v3", auth });
  const created = await calendar.calendars.insert({
    requestBody: {
      summary: `${name} — Marketing`,
      description: "Scheduled content, planned by the Numerico marketing agent.",
      timeZone: timezone,
    },
  });

  const calendarId = created.data.id;
  if (!calendarId) throw new Error("Google did not return a calendar id.");

  await ref.update({
    googleCalendarId: calendarId,
    googleSyncedAt: FieldValue.serverTimestamp(),
  });
  return calendarId;
}

export function calendarEmbedUrl(calendarId: string, timezone = "UTC"): string {
  return (
    `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}` +
    `&ctz=${encodeURIComponent(timezone)}&mode=WEEK`
  );
}

export function calendarOpenUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`;
}

/**
 * Remove the Google events for a set of slots.
 *
 * Extracted from the delete branch inside syncSlots, with two differences that
 * matter on a delete path:
 *
 *  - It reads googleCalendarId off the client rather than calling
 *    ensureClientCalendar, which CREATES a calendar when none exists. Creating
 *    a calendar in order to delete from it is absurd; no calendar means no
 *    events, so it returns.
 *  - It throws NotConnectedError only when there is something to remove. A run
 *    whose slots never reached Google can be deleted with Google disconnected.
 *
 * @returns how many events were removed.
 */
export async function deleteSlotEvents(
  agencyId: string,
  clientId: string,
  slots: Slot[]
): Promise<number> {
  const withEvents = slots.filter((s) => s.google_event_id);
  if (withEvents.length === 0) return 0;

  const clientSnap = await db().collection(COLLECTIONS.clients).doc(clientId).get();
  const calendarId = clientSnap.data()?.googleCalendarId;
  if (typeof calendarId !== "string" || !calendarId) return 0;

  const auth = await getAuthorizedClient(agencyId);
  // There are live events and no way to reach them. Refusing is more honest
  // than deleting the slots and orphaning what is on someone's calendar.
  if (!auth) throw new NotConnectedError();

  const calendar = google.calendar({ version: "v3", auth });
  let removed = 0;

  for (const slot of withEvents) {
    await calendar.events
      .delete({ calendarId, eventId: slot.google_event_id! })
      .catch((e: unknown) => {
        // 404/410 means it is already gone, which is the desired end state.
        const code = (e as { code?: number })?.code;
        if (code !== 404 && code !== 410) throw e;
      });
    removed += 1;
  }
  return removed;
}

/* ---------------------------------------------------------- reconciling -- */

/**
 * Every event on the calendar, whatever the date.
 *
 * Deliberately unbounded in time. A windowed list would omit an event the user
 * dragged outside the window, which classify() would then be told is absent —
 * and an absent event can mean "cancel this slot". The calendar is app-owned
 * and one per client, so listing it whole is one or two round trips.
 *
 * singleEvents stays FALSE. With expansion on, a repeating event comes back as
 * instances keyed `{masterId}_{timestamp}`, so our stored master id matches
 * nothing and every repeating slot reads as deleted. Masters come back under
 * the id we stored, carrying the recurrence rule that tells classify to leave
 * them alone.
 */
export async function listCalendarEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string
): Promise<Map<string, RemoteEvent>> {
  const byId = new Map<string, RemoteEvent>();
  let pageToken: string | undefined;

  do {
    const page = await calendar.events.list({
      calendarId,
      showDeleted: true,
      singleEvents: false,
      maxResults: 2500,
      pageToken,
      fields: "nextPageToken,items(id,status,summary,description,start,recurrence)",
    });

    for (const item of page.data.items ?? []) {
      if (!item.id) continue;
      byId.set(item.id, {
        id: item.id,
        status: item.status ?? "confirmed",
        summary: item.summary ?? "",
        description: item.description ?? "",
        start: { dateTime: item.start?.dateTime, date: item.start?.date },
        recurrence: item.recurrence,
      });
    }
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);

  return byId;
}

interface ReconcileTally {
  adopted: number;
  cancelled: number;
  locked: number;
  changes: string[];
  warnings: string[];
}

/**
 * Adopt what changed in Google, before anything is pushed.
 *
 * Runs as its own pass rather than inside the push loop for three reasons: the
 * delete rule changes `status`, which the loop branches on; the move rule
 * changes date and time, which eventTimes() reads; and the "did we recognise
 * anything?" guard is a property of the whole listing, not of one slot.
 *
 * Mutates the slots in `slots` as it writes them, so the push loop that follows
 * reads the adopted values without a second collection read.
 */
async function reconcileSlots(
  clientId: string,
  slots: Slot[],
  events: Map<string, RemoteEvent>,
  appUrl?: string
): Promise<ReconcileTally> {
  const tally: ReconcileTally = {
    adopted: 0,
    cancelled: 0,
    locked: 0,
    changes: [],
    warnings: [],
  };

  const claimed = slots.filter((s) => s.google_event_id);
  const recognisedAny = claimed.some((s) => events.has(s.google_event_id!));

  // Nothing we stored came back. Either the calendar is gone, the token lost
  // its scope, or googleCalendarId is stale — and in all three cases treating
  // "absent" as "deleted" would cancel the client's entire schedule in one
  // click. Say so instead.
  if (claimed.length > 0 && !recognisedAny) {
    tally.warnings.push(
      `${claimed.length} slot${claimed.length === 1 ? "" : "s"} point at events that are ` +
        `not on this calendar, and none of the ones we looked for were found — ` +
        `nothing was cancelled.`
    );
  }

  for (const slot of slots) {
    if (!slot.google_event_id) continue;
    if (slot.status === "cancelled" || slot.status === "skipped") continue;

    const remote = events.get(slot.google_event_id);
    const divergence = classify(slot, remote, {
      renderedTitle: eventTitle(slot),
      renderedBodyHash: hashBody(eventDescription(slot, appUrl)),
      recognisedAny,
    });

    switch (divergence.kind) {
      case "moved": {
        const warnings = plannerWarnings(slot, divergence.schedule, slots);
        const withWarnings: Divergence = {
          ...divergence,
          warnings: [...divergence.warnings, ...warnings],
        };
        const updated = await adoptSlotSchedule(clientId, slot.id, divergence.schedule);
        if (updated) {
          const line = describeChange(slot, withWarnings);
          if (line) tally.changes.push(line);
          // In-memory, so the push pass below re-times the event from the
          // adopted position rather than moving it straight back.
          slot.date = divergence.schedule.date;
          slot.time_local = divergence.schedule.timeLocal;
          slot.week_key = divergence.schedule.weekKey;
          slot.scheduled_at = divergence.schedule.scheduledAt;
          tally.adopted += 1;
        }
        break;
      }

      case "deleted":
      case "missing": {
        const updated = await cancelFromGoogle(clientId, slot.id);
        if (updated) {
          const line = describeChange(slot, divergence);
          if (line) tally.changes.push(line);
          // Both matter: "cancelled" makes the push loop take the dropped
          // branch, and a null id makes it skip that branch entirely instead
          // of deleting an event that is already gone.
          slot.status = "cancelled";
          slot.google_event_id = null;
          slot.google_sync_status = "removed";
          tally.cancelled += 1;
        }
        break;
      }

      case "edited": {
        // Record what the event now says, not what we last wrote. Otherwise the
        // fingerprint keeps the app's old title and every later sync reports
        // the same edit again — and an unlock could never survive this pass.
        const updated = await setEventLock(clientId, slot.id, true, {
          title: remote!.summary,
          bodyHash: hashBody(remote!.description ?? ""),
        });
        if (updated) {
          const line = describeChange(slot, divergence);
          if (line) tally.changes.push(line);
          slot.google_event_locked = true;
          tally.locked += 1;
        }
        break;
      }

      case "recurring": {
        const line = describeChange(slot, divergence);
        if (line) tally.changes.push(line);
        // Left entirely alone — pushing start/end to a series master would
        // rewrite every occurrence.
        slot.google_event_locked = true;
        break;
      }

      default:
        // "none". refreshFingerprint is handled by the push pass, which
        // records the fingerprint on every successful write anyway.
        break;
    }
  }

  return tally;
}

/* -------------------------------------------------------------- syncing -- */

export interface SyncResult {
  /** Events written by the push pass. */
  synced: number;
  failed: number;
  /** Events deleted because the SLOT was dropped in the app. */
  removed: number;
  /** Slots whose schedule moved to match Google. */
  adopted: number;
  /** Slots cancelled because their event is gone. */
  cancelled: number;
  /** Slots newly handed to Google this run. */
  locked: number;
  calendarId: string;
  errors: string[];
  /** Reconcile refused or degraded — not a per-slot failure. */
  warnings: string[];
  /** One line per Google-side change adopted, written for a person. */
  changes: string[];
}

/**
 * Push every slot in the window to Google.
 *
 * Insert or patch by googleEventId, so re-running is safe and an edited slot
 * updates its event rather than creating a second one. Cancelled and skipped
 * slots have their event deleted — they are no longer on the plan, and leaving
 * them would mean the calendar disagrees with the app.
 *
 * Per-slot failures are recorded on the slot and counted, never thrown: one bad
 * event must not stop the other twenty from landing.
 */
export async function syncSlots(
  agencyId: string,
  clientId: string,
  opts: { start?: string; end?: string; appUrl?: string } = {}
): Promise<SyncResult> {
  const auth = await getAuthorizedClient(agencyId);
  if (!auth) throw new NotConnectedError();

  const calendarId = await ensureClientCalendar(agencyId, clientId);
  const calendar = google.calendar({ version: "v3", auth });

  const snap = await db()
    .collection(COLLECTIONS.slots)
    .where("clientId", "==", clientId)
    .get();

  const slots = snap.docs
    .map((d) => serializeSlot(d.id, d.data()) as Slot)
    .filter((s) => {
      if (opts.start && s.date < opts.start) return false;
      if (opts.end && s.date > opts.end) return false;
      return true;
    });

  const result: SyncResult = {
    synced: 0,
    failed: 0,
    removed: 0,
    adopted: 0,
    cancelled: 0,
    locked: 0,
    calendarId,
    errors: [],
    warnings: [],
    changes: [],
  };

  // Read Google before writing to it. A failure here must never turn into a
  // write: reconcile is skipped and the push pass runs exactly as it did
  // before Phase 5, so a transient list error costs the two-way half of the
  // sync and nothing else.
  let remoteEvents: Map<string, RemoteEvent> | null = null;
  try {
    remoteEvents = await listCalendarEvents(calendar, calendarId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.warnings.push(
      `Could not read the calendar (${message}): nothing was reconciled, ` +
        `${slots.length} slot${slots.length === 1 ? "" : "s"} still pushed.`
    );
  }

  if (remoteEvents) {
    const tally = await reconcileSlots(clientId, slots, remoteEvents, opts.appUrl);
    result.adopted = tally.adopted;
    result.cancelled = tally.cancelled;
    result.locked = tally.locked;
    result.changes = tally.changes;
    result.warnings.push(...tally.warnings);
  }

  for (const slot of slots) {
    const ref = db().collection(COLLECTIONS.slots).doc(slot.id);
    const dropped = slot.status === "cancelled" || slot.status === "skipped";

    try {
      if (dropped) {
        if (slot.google_event_id) {
          await calendar.events
            .delete({ calendarId, eventId: slot.google_event_id })
            .catch((e: unknown) => {
              // 404/410 means it is already gone, which is the desired state.
              const code = (e as { code?: number })?.code;
              if (code !== 404 && code !== 410) throw e;
            });
          await ref.update({
            googleEventId: null,
            googleSyncStatus: "removed",
            updatedAt: FieldValue.serverTimestamp(),
          });
          result.removed += 1;
        }
        continue;
      }

      const times = eventTimes(slot);
      const title = eventTitle(slot);
      const description = eventDescription(slot, opts.appUrl);
      const locked = slot.google_event_locked === true;

      // A locked event's text belongs to whoever edited it in Google. Timing
      // is still ours, so the piece stays where the plan says it is.
      //
      // status: "confirmed" revives a tombstone in place. A deleted event is
      // not gone — Google keeps it as status "cancelled" — so patching it back
      // to confirmed is how a slot that reconcile decided to keep gets its
      // event returned, without a 404 and without minting a second event.
      const body: calendar_v3.Schema$Event = locked
        ? { status: "confirmed", start: times.start, end: times.end }
        : {
            status: "confirmed",
            summary: title,
            description,
            start: times.start,
            end: times.end,
          };

      let eventId = slot.google_event_id;
      if (eventId) {
        await calendar.events
          .patch({ calendarId, eventId, requestBody: body })
          .catch(async (e: unknown) => {
            // The event is gone and reconcile did not catch it — the listing
            // failed, or it was deleted between the two passes. Recreate it
            // rather than parking the slot in "error", which is what happened
            // before Phase 5 and left no visible reason.
            const code = (e as { code?: number })?.code;
            if (code !== 404 && code !== 410) throw e;
            const recreated = await calendar.events.insert({
              calendarId,
              requestBody: { ...body, summary: title, description, id: eventId! },
            });
            eventId = recreated.data.id ?? eventId;
          });
      } else {
        // A supplied id makes a duplicate insert a 409 instead of a second
        // event. Two concurrent syncs would otherwise each create one, and the
        // orphan could never be cleaned up: deleting events no slot claims is
        // exactly the inference reconcile.ts refuses to make.
        const id = deterministicEventId(slot.id);
        const created = await calendar.events
          .insert({ calendarId, requestBody: { ...body, id } })
          .catch(async (e: unknown) => {
            if ((e as { code?: number })?.code !== 409) throw e;
            return calendar.events.patch({ calendarId, eventId: id, requestBody: body });
          });
        eventId = created.data.id ?? id;
      }

      await ref.update({
        googleEventId: eventId,
        // "locked" rather than "synced" so the header's "N changed since the
        // last sync" can reach zero. Calling a locked slot synced would be a
        // lie — its text edit never left the app.
        googleSyncStatus: locked ? "locked" : "synced",
        // What we just wrote, so the next reconcile compares against our own
        // output instead of the slot's current rendering.
        ...(locked ? {} : { googleEventTitle: title, googleEventBodyHash: hashBody(description) }),
        googleSyncError: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      result.synced += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed += 1;
      result.errors.push(`${slot.date} ${slot.channel}: ${message}`);
      // Recorded on the slot so a retry can find it and a human can see why.
      await ref
        .update({
          googleSyncStatus: "error",
          googleSyncError: message.slice(0, 500),
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => {});
    }
  }

  await db()
    .collection(COLLECTIONS.clients)
    .doc(clientId)
    .update({ googleSyncedAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  return result;
}
