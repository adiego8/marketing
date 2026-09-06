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
 * The production brief, in the event body.
 *
 * A calendar event is often the only surface someone sees on the day, so it
 * carries everything needed to actually make the piece rather than a link
 * back to the app.
 */
export function eventDescription(slot: Slot, appUrl?: string): string {
  const lines: string[] = [];

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
  if (appUrl && slot.client_id) {
    lines.push(`${appUrl}/clients/${slot.client_id}/schedule`);
  }
  return lines.join("\n").trim();
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

/* -------------------------------------------------------------- syncing -- */

export interface SyncResult {
  synced: number;
  failed: number;
  removed: number;
  calendarId: string;
  errors: string[];
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

  const result: SyncResult = { synced: 0, failed: 0, removed: 0, calendarId, errors: [] };

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
      const body: calendar_v3.Schema$Event = {
        summary: eventTitle(slot),
        description: eventDescription(slot, opts.appUrl),
        start: times.start,
        end: times.end,
      };

      let eventId = slot.google_event_id;
      if (eventId) {
        await calendar.events.patch({ calendarId, eventId, requestBody: body });
      } else {
        const created = await calendar.events.insert({ calendarId, requestBody: body });
        eventId = created.data.id ?? null;
      }

      await ref.update({
        googleEventId: eventId,
        googleSyncStatus: "synced",
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
