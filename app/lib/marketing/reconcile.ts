// Deciding what changed in Google, and what that means.
//
// Every decision reconciliation makes lives here, and nothing here touches
// Firestore or googleapis. That is not tidiness: this repo mocks nothing (there
// is no vi.mock anywhere, and no vitest setup file), so logic that reaches for
// the network is logic that never gets a test. calendar.ts keeps the I/O and
// calls into these functions for every judgement.
//
// The rules, decided with the operator:
//
//   moved in Google   -> adopt it; the slot follows the event
//   deleted in Google -> cancel the slot, which frees its quota gap
//   retitled/rewritten -> stop overwriting that text, permanently
//
// Two of those are destructive if the detection is wrong, which is most of what
// this file is careful about.

import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import {
  MAX_SLOTS_PER_DAY,
  MIN_GAP_MINUTES,
  windowFor,
} from "./posting-windows";
import { weekKeyOf, toUtcInstant, zoneOrUTC, minutesOf } from "./planner/weeks";
import { contentTypeLabel } from "./content-types";
import type { Slot } from "../types";

/**
 * The part of a Google event this file understands.
 *
 * Deliberately not calendar_v3.Schema$Event: that type is enormous, almost
 * entirely nullable, and would drag googleapis into every test. calendar.ts
 * adapts at the boundary.
 */
export interface RemoteEvent {
  id: string;
  /** "confirmed" | "tentative" | "cancelled" — cancelled is a tombstone. */
  status: string;
  summary: string;
  description: string;
  start: { dateTime?: string | null; date?: string | null };
  /** Non-empty when the user made this a repeating event. */
  recurrence?: string[] | null;
}

/** The scheduling fields a slot needs to follow its event. */
export interface SlotSchedule {
  date: string;
  timeLocal: string;
  weekKey: string;
  scheduledAt: string;
}

export type Divergence =
  /** Nothing to do. refreshFingerprint means "re-record what we last wrote". */
  | { kind: "none"; refreshFingerprint: boolean }
  | { kind: "moved"; schedule: SlotSchedule; allDay: boolean; warnings: string[] }
  /** A real tombstone: Google returned it with status "cancelled". */
  | { kind: "deleted" }
  /** Absent from the calendar, and we have grounds to believe that means gone. */
  | { kind: "missing" }
  /** The title or body was edited by hand. Lock the text. */
  | { kind: "edited" }
  /** Made repeating. Hands off entirely — see classify. */
  | { kind: "recurring" };

export interface ClassifyContext {
  /** eventTitle(slot) — what the push pass would write right now. */
  renderedTitle: string;
  /** hashBody(eventDescription(slot)) — likewise. */
  renderedBodyHash: string;
  /**
   * Did the listing contain at least one event id we stored?
   *
   * The single most important input here. See classify.
   */
  recognisedAny: boolean;
}

/* ------------------------------------------------------- fingerprinting -- */

/**
 * Flatten the incidental differences out of a description before hashing.
 *
 * Google normalises line endings and is inconsistent about trailing space, so
 * a byte comparison reports an edit nobody made — which, under rule 3, would
 * lock a slot's text forever.
 */
export function normalizeDescription(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

/** sha256 of the normalized text. Hashed rather than stored: bodies are long. */
export function hashBody(value: string): string {
  return createHash("sha256").update(normalizeDescription(value)).digest("hex");
}

/**
 * A Google event id derived from the slot id.
 *
 * Two concurrent syncs on a slot with no event id both insert, and only one id
 * survives on the slot — leaving an orphan event that reconciliation can never
 * clean up, because "delete events no slot claims" is exactly the inference
 * this file refuses to make (see classify). Supplying the id makes the second
 * insert a 409 instead of a duplicate.
 *
 * Google requires base32hex: characters a-v and 0-9, 5 to 1024 long. Hex digits
 * are a strict subset, so a truncated sha256 is always valid.
 */
export function deterministicEventId(slotId: string): string {
  return createHash("sha256").update(slotId).digest("hex").slice(0, 32);
}

/* ------------------------------------------------------------ the clock -- */

/**
 * Google's start → the four scheduling fields, in the CLIENT's timezone.
 *
 * Three things this gets right that a naive fromISO does not:
 *
 *  - The event's offset is not the client's zone. Google returns the offset it
 *    stored; the slot is scheduled in the client's local calendar. So the
 *    instant is parsed with setZone, then moved into the client's zone. The
 *    event's own start.timeZone is never consulted.
 *  - Seconds are truncated. scheduledAt has to agree with
 *    toUtcInstant(date, timeLocal, tz), or the next push nudges the event by a
 *    few seconds, which bumps `updated`, which looks like another edit.
 *  - An all-day event has no dateTime at all. Callers keep the slot's time.
 */
export function scheduleFromEvent(
  start: { dateTime?: string | null; date?: string | null },
  timezone: string,
  fallbackTime: string
): { schedule: SlotSchedule; allDay: boolean; valid: boolean } | null {
  const { zone } = zoneOrUTC(timezone);

  if (!start.dateTime) {
    // All-day. Adopt the date, keep the time we already had: the push pass then
    // restores a timed event, so this self-heals in one round trip.
    if (!start.date) return null;
    const date = start.date;
    const instant = toUtcInstant(date, fallbackTime, zone);
    return {
      allDay: true,
      valid: instant !== null,
      schedule: {
        date,
        timeLocal: fallbackTime,
        weekKey: weekKeyOf(date, zone),
        scheduledAt: (instant ?? new Date(`${date}T00:00:00Z`)).toISOString(),
      },
    };
  }

  const dt = DateTime.fromISO(start.dateTime, { setZone: true });
  if (!dt.isValid) return null;

  const local = dt.setZone(zone).startOf("minute");
  const date = local.toFormat("yyyy-MM-dd");
  const timeLocal = local.toFormat("HH:mm");

  // Round-tripped rather than taken from `local`, so scheduledAt is derived
  // from the same date+time pair the slot will store.
  //
  // This branch cannot actually fail: an instant converted into a zone never
  // lands in a DST gap. Only the all-day branch above can, because there the
  // date is Google's and the time is the slot's. Kept symmetrical anyway.
  const instant = toUtcInstant(date, timeLocal, zone);

  return {
    allDay: false,
    valid: instant !== null,
    schedule: {
      date,
      timeLocal,
      weekKey: weekKeyOf(date, zone),
      scheduledAt: (instant ?? local.toUTC().toJSDate()).toISOString(),
    },
  };
}

/** Same instant? Compares milliseconds, never strings — see classify. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = DateTime.fromISO(a, { setZone: true });
  const right = DateTime.fromISO(b, { setZone: true });
  if (!left.isValid || !right.isValid) return false;
  return left.startOf("minute").toMillis() === right.startOf("minute").toMillis();
}

/* ------------------------------------------------------- classification -- */

/**
 * What happened to this slot's event, if anything.
 *
 * @param remote the event with this slot's googleEventId, or undefined if the
 *   listing did not contain one.
 *
 * Three judgements here are load-bearing:
 *
 * 1. A repeating event is left completely alone. With singleEvents:false Google
 *    returns the series master under our id with a recurrence rule; pushing a
 *    start to a master rewrites the whole series, and adopting an instance's
 *    time is meaningless. So: never adopt, never lock, never cancel.
 *
 * 2. Absent does NOT mean deleted unless we recognised something. A deleted
 *    calendar, a revoked scope, a stale googleCalendarId or an event the user
 *    moved to a different calendar all produce an absent event — and the first
 *    two produce it for EVERY slot, which under rule 2 would cancel a client's
 *    entire schedule in one click. One recognised id proves the calendar, the
 *    token and the id space are all sound. Zero proves nothing, so we do
 *    nothing.
 *
 * 3. Text is only locked when the remote differs from BOTH the fingerprint and
 *    what we would write right now. The second half matters more than it looks:
 *    if events.patch succeeds and the Firestore write recording the fingerprint
 *    fails — a blip, or the 60s route budget with twenty slots — then remote
 *    holds the new title while the fingerprint holds the old one, and a
 *    fingerprint-only test would lock the slot permanently with no way back.
 *    Comparing against the render also means a null fingerprint (every slot
 *    synced before this shipped) needs no special case, and that a concurrent
 *    sync rewriting the title between our list and our classify is not read as
 *    a human edit.
 */
export function classify(
  slot: Slot,
  remote: RemoteEvent | undefined,
  ctx: ClassifyContext
): Divergence {
  // Have we ever pushed this event under reconciliation? A null fingerprint
  // means no — the slot predates Phase 5 — and we therefore know nothing about
  // what happened to its event or when.
  //
  // This gates the DELETE rules, not just the edit rule. Found by dry-running
  // the classifier against the real calendar before letting it write: all 25
  // events there were tombstones from deletions made months before any of this
  // existed, so the first sync would have cancelled the client's whole
  // schedule — freeing every gap, and inviting the next plan run to refill
  // them with different content. Acting on history nobody was watching is
  // exactly what the null fingerprint is supposed to prevent.
  //
  // One sync costs us the delay: it re-pushes and records fingerprints, and
  // every deletion after that is a real one.
  const managed = slot.google_event_title !== null;

  if (!remote) {
    if (!ctx.recognisedAny || !managed) {
      return { kind: "none", refreshFingerprint: false };
    }
    return { kind: "missing" };
  }

  if (remote.recurrence && remote.recurrence.length > 0) {
    return { kind: "recurring" };
  }

  if (remote.status === "cancelled") {
    return managed ? { kind: "deleted" } : { kind: "none", refreshFingerprint: true };
  }

  // Timing first: a slot can be both moved and retitled, and the move is the
  // one that has to be adopted before the push pass reads eventTimes(slot).
  const ourStart = toUtcInstant(slot.date, slot.time_local, slot.timezone || "UTC");
  const theirStart = remote.start.dateTime ?? null;
  const movedInTime = !remote.start.dateTime
    ? Boolean(remote.start.date) && remote.start.date !== slot.date
    : !sameInstant(theirStart, ourStart?.toISOString() ?? null);

  if (movedInTime) {
    const derived = scheduleFromEvent(
      remote.start,
      slot.timezone || "UTC",
      slot.time_local
    );
    if (derived) {
      return {
        kind: "moved",
        schedule: derived.schedule,
        allDay: derived.allDay,
        warnings: derived.valid
          ? []
          : [`${derived.schedule.timeLocal} does not exist on ${derived.schedule.date} in ${slot.timezone}.`],
      };
    }
    // Unparseable start: say nothing rather than guess at a date.
    return { kind: "none", refreshFingerprint: false };
  }

  const titleDiverged =
    remote.summary !== (slot.google_event_title ?? null) &&
    remote.summary !== ctx.renderedTitle;
  const remoteBodyHash = hashBody(remote.description ?? "");
  const bodyDiverged =
    remoteBodyHash !== (slot.google_event_body_hash ?? null) &&
    remoteBodyHash !== ctx.renderedBodyHash;

  if (titleDiverged || bodyDiverged) return { kind: "edited" };

  // Equal to the render but not to the stored fingerprint: our own write, whose
  // bookkeeping did not land. Re-record it rather than reporting an edit.
  const stale =
    slot.google_event_title !== remote.summary ||
    slot.google_event_body_hash !== remoteBodyHash;
  return { kind: "none", refreshFingerprint: stale };
}

/* ------------------------------------------------------------ warnings -- */

/**
 * Does the adopted position break what the planner would have enforced?
 *
 * Advisory only, by decision: dragging an event is an instruction, not a
 * proposal. These are the same rules assign.ts applies when placing a slot
 * (assign.ts:93 and :123), so the wording matches what a plan run would say.
 */
export function plannerWarnings(
  slot: Slot,
  schedule: SlotSchedule,
  siblings: Slot[]
): string[] {
  const warnings: string[] = [];
  const others = siblings.filter(
    (s) => s.id !== slot.id && s.status !== "cancelled" && s.status !== "skipped"
  );

  const sameDay = others.filter((s) => s.date === schedule.date);
  if (sameDay.length + 1 > MAX_SLOTS_PER_DAY) {
    warnings.push(
      `${sameDay.length + 1} pieces now on ${schedule.date} (the planner allows ${MAX_SLOTS_PER_DAY})`
    );
  }

  const crowding = sameDay.find(
    (s) =>
      s.channel === slot.channel &&
      Math.abs(minutesOf(s.time_local) - minutesOf(schedule.timeLocal)) < MIN_GAP_MINUTES
  );
  if (crowding) {
    const gap = Math.abs(
      minutesOf(crowding.time_local) - minutesOf(schedule.timeLocal)
    );
    warnings.push(
      `${gap} min from another ${slot.channel} piece (the planner keeps ${MIN_GAP_MINUTES})`
    );
  }

  const { zone } = zoneOrUTC(slot.timezone || "UTC");
  const weekday = DateTime.fromISO(schedule.date, { zone }).weekday;
  const window = windowFor(slot.channel);
  if (!window.weekdays.includes(weekday)) {
    warnings.push(`outside ${slot.channel}'s posting days (${window.label})`);
  }

  return warnings;
}

/* -------------------------------------------------------------- copy ----- */

function label(slot: Slot): string {
  const channel = slot.channel.charAt(0).toUpperCase() + slot.channel.slice(1);
  const format = contentTypeLabel(slot.type).toLowerCase();
  // Older slots carry types that already name the channel — "instagram_reel" —
  // so prefixing produces "Instagram instagram reel".
  if (format.startsWith(slot.channel.toLowerCase())) {
    return format.charAt(0).toUpperCase() + format.slice(1);
  }
  return `${channel} ${format}`;
}

function when(date: string, time: string, tz: string): string {
  const { zone } = zoneOrUTC(tz);
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  return dt.isValid ? `${dt.toFormat("ccc d LLL")} ${time}` : `${date} ${time}`;
}

/**
 * One line per change, written for the person who made it.
 *
 * Both sides of a move, so it can be undone in Google without opening the app;
 * and the quota consequence spelled out, because a cancelled slot frees its gap
 * and the replacement appearing later would otherwise look like a bug.
 */
export function describeChange(slot: Slot, divergence: Divergence): string | null {
  const tz = slot.timezone || "UTC";
  const from = when(slot.date, slot.time_local, tz);

  switch (divergence.kind) {
    case "moved": {
      const to = when(divergence.schedule.date, divergence.schedule.timeLocal, tz);
      const notes = [...divergence.warnings];
      if (divergence.allDay) notes.push(`made all-day — kept ${slot.time_local}`);
      const suffix = notes.length > 0 ? ` — ${notes.join("; ")}` : "";
      return `Moved ${from} → ${to} · ${label(slot)}${suffix}`;
    }
    case "deleted":
      return (
        `Cancelled ${from} · ${label(slot)} — its event was deleted in Google. ` +
        `Its quota is free again, so the next plan may refill the gap.`
      );
    case "missing":
      return (
        `Cancelled ${from} · ${label(slot)} — its event is no longer on this calendar. ` +
        `Its quota is free again, so the next plan may refill the gap.`
      );
    case "edited":
      return `Google now owns the title and notes for ${from} · ${label(slot)}. Timing still syncs.`;
    case "recurring":
      return `${from} · ${label(slot)} was made repeating in Google — left untouched.`;
    default:
      return null;
  }
}
