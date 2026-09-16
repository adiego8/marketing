// What an external agent is allowed to see. Pure.
//
// Deliberately NOT serializeSlot. That function is the app talking to its own
// browser, and it carries plan_run_id, gap_id, needs_theme and six google_*
// fields — planner and calendar-sync state that means nothing to a publisher
// and that we would then be committed to keeping stable forever. Every field
// below is a promise to a third party; the narrow list is the point.

import { readCopy, sourceHash, normalizeFormat, copyWarnings } from "../copy";
import { contentTypeLabel } from "../content-types";
import type { AgentSlot, Branding, CopyState, Slot } from "../../types";

/**
 * Is this piece's copy usable right now?
 *
 * Three-valued, and the order of the checks is the whole point. isCopyStale
 * returns FALSE when there is no copy at all, which collapses "nothing to
 * publish" and "good to publish" into one answer — so this reads the copy
 * first and only then asks whether it has drifted. Delegating to isCopyStale
 * would reproduce the bug it exists to avoid.
 */
export function copyState(slot: Slot): CopyState {
  const copy = readCopy(slot);
  if (!copy) return "missing";
  return copy.sourceHash !== sourceHash(slot) ? "stale" : "ready";
}

/**
 * The publish gate.
 *
 * NOT `status === "confirmed"` alone. A human confirms a piece, someone then
 * fixes a typo in the hook, and the copy is now written from a brief that no
 * longer exists — while the status still says confirmed, because nothing
 * demotes it. Publishing that is the worst thing this API could do, so
 * readiness is part of the gate rather than advice alongside it.
 */
export function publishable(slot: Slot): boolean {
  return slot.status === "confirmed" && copyState(slot) === "ready";
}

/**
 * One piece, as an agent sees it.
 *
 * `status` is passed through rather than narrowed, matching the reasoning on
 * Slot.status: a value put there by hand should read as itself instead of
 * being coerced into "planned", which would quietly change whether it counts
 * against quota.
 */
export function projectSlot(slot: Slot): AgentSlot {
  const copy = readCopy(slot);
  const state = copyState(slot);

  return {
    id: slot.id,
    date: slot.date,
    time_local: slot.time_local,
    timezone: slot.timezone,
    scheduled_at: slot.scheduled_at,
    channel: slot.channel,
    format: normalizeFormat(slot.type, slot.channel),
    format_label: contentTypeLabel(slot.type),
    status: slot.status,
    publishable: publishable(slot),
    campaign: slot.campaign_id
      ? { id: slot.campaign_id, title: slot.campaign_title }
      : null,
    theme: slot.needs_theme ? "" : slot.theme,
    brief: {
      one_line: slot.brief,
      hook: slot.hook,
      body: slot.body,
      cta: slot.cta,
      rationale: slot.rationale,
    },
    copy: {
      state,
      headline: copy?.headline ?? null,
      // `note` is production direction — camera, art, framing — and copy.ts
      // says outright that it is never published. Stripping it here is the
      // only thing standing between "shot 2: cut to the whiteboard" and a
      // client's live feed.
      blocks: (copy?.blocks ?? []).map((b) => ({
        label: b.label,
        text: b.text,
        on_screen: b.onScreen ?? null,
      })),
      caption: copy?.caption ?? null,
      hashtags: copy?.hashtags ?? [],
      authored_by: copy ? (copy.model ? "agent" : "human") : null,
      generated_at: copy?.generatedAt || null,
      edited_at: copy?.editedAt ?? null,
    },
    published: slot.publication
      ? {
          external_id: slot.publication.external_id,
          external_url: slot.publication.external_url,
          published_at: slot.publication.published_at,
        }
      : null,
    updated_at: slot.updated_at,
  };
}

/** Platform limit warnings, computed at read time. Never stored. */
export function slotWarnings(slot: Slot): string[] {
  const copy = readCopy(slot);
  return copy ? copyWarnings(copy, slot) : [];
}

/**
 * The client's visual identity, narrowed to the fields we actually promise.
 *
 * `branding` is stored as an opaque object and is never validated on write —
 * parseClientPatch only checks that it is an object. Passing whatever someone
 * typed straight to a third party is a data-shape promise we cannot keep, so
 * this whitelists and drops the rest.
 */
export function projectBranding(value: unknown): Branding {
  const b = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const colors = (b.colors && typeof b.colors === "object" ? b.colors : {}) as Record<string, unknown>;
  const fonts = (b.fonts && typeof b.fonts === "object" ? b.fonts : {}) as Record<string, unknown>;

  return {
    colors: {
      primary: text(colors.primary),
      secondary: text(colors.secondary),
      accent: text(colors.accent),
    },
    fonts: {
      headline: text(fonts.headline),
      body: text(fonts.body),
    },
    visual_style: text(b.visual_style),
    mood: text(b.mood),
    dos: text(b.dos),
    donts: text(b.donts),
  };
}

/**
 * A logo URL safe to redirect a caller to.
 *
 * logo_url is a hand-typed string that nothing validates beyond a trim, and
 * GET /logo answers a 302 with it. Without this, anyone who can edit a client
 * turns our domain into an open redirect — to another host, or to a
 * javascript: URL. Same class of bug safeReturnTo in google.ts exists for.
 */
export function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- paging --- */

/**
 * A total ordering over pieces.
 *
 * Date and time first because that is the order a publisher works in, then the
 * id as a tiebreaker — two pieces can share a slot on the calendar, and
 * without the tiebreaker the order between them is whatever Firestore felt
 * like, which makes a cursor skip or repeat one.
 */
export function sortKeyOf(slot: { date: string | null; time_local: string | null; id: string }): string {
  return `${slot.date ?? ""} ${slot.time_local ?? ""} ${slot.id}`;
}

export function encodeCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeCursor(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded || null;
  } catch {
    return null;
  }
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Silently clamped rather than rejected, as the planner clamps model output. */
export function clampLimit(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Keyset paging over an already-sorted list.
 *
 * Keyset rather than offset because the underlying list is re-read on every
 * request: a piece rescheduled between two pages would shift every index after
 * it, and an offset cursor would silently skip whatever moved into the gap.
 */
export function paginate<T extends { date: string | null; time_local: string | null; id: string }>(
  items: T[],
  cursor: string | null,
  limit: number
): { items: T[]; nextCursor: string | null } {
  const after = cursor ? items.filter((i) => sortKeyOf(i) > cursor) : items;
  const page = after.slice(0, limit);
  const more = after.length > page.length;
  return {
    items: page,
    nextCursor: more && page.length ? encodeCursor(sortKeyOf(page[page.length - 1])) : null,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
