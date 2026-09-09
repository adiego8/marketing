// Dropping ideas out of a preview, and putting replacements back.
//
// The preview used to be take-it-or-leave-it: Accept all nine, or Discard and
// pay for a whole new plan. One weak idea cost the other eight. This is the
// pure half of the fix — moving slots between the run's proposed and dropped
// lists, and rebuilding a slot from a fresh fill — with no Firestore and no
// model, so all of it is testable.
//
// What a drop does NOT touch is the commit guard. fingerprintInputs hashes the
// quota, the campaigns, the slots in the horizon and the horizon itself
// (plan-runs.ts:127) — none of which a drop changes. So a partly-dropped plan
// stays committable, and commitPlan needs no change at all: it writes
// proposed_slots, which is now simply shorter.

import type { DroppedSlot, ProposedSlot } from "../../types";
import type { Fill } from "./types";

/** Long enough for a real objection, short enough to stay a steer. */
export const MAX_DROP_REASON_CHARS = 300;

export interface DropRequest {
  slotId: string;
  reason: string;
}

/**
 * Read a drop request off a JSON body.
 *
 * The house line, from slots/[slotId]/copy/route.ts:30 — cap, never reject. A
 * malformed entry is skipped rather than failing the batch, because the cost of
 * refusing a whole drop over one bad reason string is higher than the cost of
 * dropping with no reason.
 */
export function parseDrops(body: unknown): DropRequest[] {
  const rows = (body as { drops?: unknown })?.drops;
  if (!Array.isArray(rows)) return [];

  const seen = new Set<string>();
  const out: DropRequest[] = [];
  for (const row of rows) {
    const entry = (row ?? {}) as Record<string, unknown>;
    const slotId = typeof entry.slotId === "string" ? entry.slotId.trim() : "";
    if (!slotId || seen.has(slotId)) continue;
    seen.add(slotId);
    out.push({
      slotId,
      reason:
        typeof entry.reason === "string"
          ? entry.reason.trim().slice(0, MAX_DROP_REASON_CHARS)
          : "",
    });
  }
  return out;
}

/** `{ slotIds: [...] }`, deduped. An absent or junk list reads as empty. */
export function parseSlotIds(body: unknown): string[] {
  const rows = (body as { slotIds?: unknown })?.slotIds;
  if (!Array.isArray(rows)) return [];
  return Array.from(
    new Set(
      rows
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter(Boolean)
    )
  );
}

/**
 * The ProposedSlot inside a DroppedSlot, with the drop bookkeeping removed.
 *
 * A rest destructure rather than a field-by-field rebuild, so a field added to
 * ProposedSlot later is carried through here without anyone remembering to.
 */
function withoutDropFields(entry: DroppedSlot): ProposedSlot {
  const slot: Partial<DroppedSlot> = { ...entry };
  delete slot.reason;
  delete slot.droppedAt;
  delete slot.replacedAt;
  return slot as ProposedSlot;
}

/**
 * The order the preview reads in: by campaign, then type, then id.
 *
 * Not calendar order any more — a proposed piece has no date until someone
 * schedules it, so there is nothing to sort by. The slot id already encodes
 * (campaign, type, n), which is why the tie-break alone is nearly enough.
 */
function inOrder(slots: ProposedSlot[]): ProposedSlot[] {
  return [...slots].sort(
    (a, b) =>
      a.campaignTitle.localeCompare(b.campaignTitle) ||
      a.type.localeCompare(b.type) ||
      a.slotId.localeCompare(b.slotId)
  );
}

export interface DropResult {
  proposed: ProposedSlot[];
  dropped: DroppedSlot[];
  warnings: string[];
}

/**
 * Move slots out of the proposed set.
 *
 * Idempotent on purpose: dropping something already dropped updates its reason
 * instead of erroring, which is what lets the page save a reason on blur
 * through the same endpoint rather than needing a second one.
 */
export function applyDrops(
  proposed: ProposedSlot[],
  dropped: DroppedSlot[],
  drops: DropRequest[],
  now: string
): DropResult {
  const byId = new Map(proposed.map((s) => [s.slotId, s]));
  const nextDropped = [...dropped];
  const warnings: string[] = [];
  const removed = new Set<string>();

  for (const drop of drops) {
    const slot = byId.get(drop.slotId);
    if (slot) {
      removed.add(drop.slotId);
      nextDropped.push({ ...slot, reason: drop.reason, droppedAt: now, replacedAt: null });
      continue;
    }

    // Already dropped: this is a reason edit, not a second drop. Only an open
    // one can be edited — a reason on a slot that has already been replaced
    // would silently change the avoid-list under a slot now on screen.
    const existing = nextDropped.findIndex(
      (d) => d.slotId === drop.slotId && d.replacedAt === null
    );
    if (existing >= 0) {
      nextDropped[existing] = { ...nextDropped[existing], reason: drop.reason };
      continue;
    }
    warnings.push(`No proposed slot "${drop.slotId}" to drop.`);
  }

  return {
    proposed: proposed.filter((s) => !removed.has(s.slotId)),
    dropped: nextDropped,
    warnings,
  };
}

/**
 * Put dropped slots back exactly as they were.
 *
 * Refused once a replacement exists, because the replacement holds the same
 * slot id — ids are deterministic on (date, type, channel, n), see slot-id.ts —
 * and restoring would put two slots with one id into the commit batch, where
 * create() would fail the whole thing.
 */
export function applyRestores(
  proposed: ProposedSlot[],
  dropped: DroppedSlot[],
  slotIds: string[]
): DropResult {
  const taken = new Set(proposed.map((s) => s.slotId));
  const wanted = new Set(slotIds);
  const restored: ProposedSlot[] = [];
  const warnings: string[] = [];
  const keep: DroppedSlot[] = [];

  for (const entry of dropped) {
    if (!wanted.has(entry.slotId)) {
      keep.push(entry);
      continue;
    }
    if (taken.has(entry.slotId)) {
      warnings.push(
        `"${entry.theme || entry.slotId}" has already been replaced, so the original cannot come back. Drop the replacement instead.`
      );
      keep.push(entry);
      continue;
    }
    // What goes back is the slot exactly as it was.
    restored.push(withoutDropFields(entry));
    taken.add(entry.slotId);
  }

  const missing = slotIds.filter(
    (id) => !dropped.some((d) => d.slotId === id)
  );
  for (const id of missing) warnings.push(`No dropped slot "${id}" to restore.`);

  return { proposed: inOrder([...proposed, ...restored]), dropped: keep, warnings };
}

/** The drops still waiting for a replacement, optionally narrowed to a selection. */
export function openDrops(dropped: DroppedSlot[], slotIds?: string[]): DroppedSlot[] {
  const open = dropped.filter((d) => d.replacedAt === null);
  if (!slotIds || slotIds.length === 0) return open;
  const wanted = new Set(slotIds);
  return open.filter((d) => wanted.has(d.slotId));
}

/**
 * Every theme this run has already turned down, shaped like recent_themes.
 *
 * The planner's avoid-list is built by loadRecentThemes from COMMITTED slots,
 * so a theme dropped thirty seconds ago is invisible to it. Without this the
 * model cheerfully returns the idea you just rejected, which is the one failure
 * that would make the whole feature feel broken.
 */
export function rejectedThemes(
  dropped: DroppedSlot[]
): { date: string; type: string; theme: string }[] {
  const seen = new Set<string>();
  const out: { date: string; type: string; theme: string }[] = [];
  for (const entry of dropped) {
    const theme = entry.theme?.trim();
    if (!theme || seen.has(theme.toLowerCase())) continue;
    seen.add(theme.toLowerCase());
    // A dropped piece has no date; recent_themes carries one for the committed
    // slots it is merged with, so an empty string keeps the shape without
    // claiming this was scheduled.
    out.push({ date: entry.date ?? "", type: entry.type, theme });
  }
  return out;
}

/**
 * Rebuild a proposed slot from a fresh fill.
 *
 * Everything the assign stage decided — the id, date, time, channel, type and
 * campaign — is carried over untouched. Only the idea changes, which is why
 * this needs no re-observe and no re-assign, and why a replacement can never
 * move a piece onto a different day.
 */
export function replacementSlot(original: DroppedSlot, fill: Fill): ProposedSlot {
  return {
    ...withoutDropFields(original),
    theme: fill.theme,
    brief: fill.brief,
    rationale: fill.rationale,
    hook: fill.hook,
    body: fill.body,
    cta: fill.cta,
    needsTheme: fill.needsTheme,
  };
}

export interface ReplaceResult {
  proposed: ProposedSlot[];
  dropped: DroppedSlot[];
  replaced: number;
  warnings: string[];
}

/**
 * Fold a set of fills back into the run.
 *
 * A fill with no theme leaves its slot dropped. This is the one place the
 * planner's "degrade, never fail" habit is wrong: the plan path returns dated
 * skeletons because a skeleton is better than no calendar, but here the user
 * already HAS the slot and is asking for something better. Handing back an
 * empty one would be a downgrade they did not ask for — same argument as
 * RegenerateFailedError in regenerate.ts:28-34.
 */
export function applyReplacements(
  proposed: ProposedSlot[],
  dropped: DroppedSlot[],
  fills: Fill[],
  gapIdToSlotId: Map<string, string>,
  now: string
): ReplaceResult {
  const bySlotId = new Map<string, Fill>();
  for (const fill of fills) {
    const slotId = gapIdToSlotId.get(fill.gapId);
    if (slotId) bySlotId.set(slotId, fill);
  }

  const added: ProposedSlot[] = [];
  const warnings: string[] = [];
  const nextDropped = dropped.map((entry) => {
    const fill = bySlotId.get(entry.slotId);
    if (!fill || entry.replacedAt !== null) return entry;

    if (fill.needsTheme || !fill.theme) {
      warnings.push(
        `No replacement came back for "${entry.theme || entry.slotId}", so it is still dropped.`
      );
      return entry;
    }

    added.push(replacementSlot(entry, fill));
    return { ...entry, replacedAt: now };
  });

  return {
    proposed: inOrder([...proposed, ...added]),
    dropped: nextDropped,
    replaced: added.length,
    warnings,
  };
}
