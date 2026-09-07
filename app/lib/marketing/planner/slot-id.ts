import type { IsoDate } from "./types";

// Deterministic slot document ids.
//
// WHAT THIS DOES AND DOES NOT BUY YOU — read before "improving" it.
//
// The id contains `date` and `channel`, and both are OUTPUTS of the assign
// stage: they depend on the LLM's channel pick and on the slot set at the
// moment of the run. So re-running the preview tomorrow legitimately produces
// different ids for the same intent, and this id does NOT dedupe across two
// preview runs.
//
// What it does buy: within-preview idempotency. A double-clicked commit, a
// retried write, or a partially-failed batch cannot create a second copy,
// because Firestore's create() refuses an id that already exists.
//
// Cross-run duplication is prevented somewhere else entirely: the observe
// stage re-counts existing slots, so a second run sees the first run's
// committed slots against quota and finds no gap to fill. Do not try to fix
// cross-run dedupe here by hashing the theme into the id — that makes the id
// change whenever the wording changes, which is strictly worse.

/** Firestore document ids cannot contain "/", and free-form quota keys can. */
export function slugSegment(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "x";
}

export function slotId(
  clientId: string,
  date: IsoDate,
  type: string,
  channel: string,
  n: number
): string {
  return `${clientId}__${date}__${slugSegment(type)}__${slugSegment(channel)}__${n}`;
}

/**
 * Mint the next free id for a (date, type, channel) triple.
 *
 * `taken` must be seeded with the ids of existing slots in the horizon, so a
 * human-created slot that already owns `..._0` is never clobbered. Mutates
 * `taken` so repeated calls in one run keep advancing.
 */
export function mintSlotId(
  taken: Set<string>,
  clientId: string,
  date: IsoDate,
  type: string,
  channel: string
): string {
  for (let n = 0; n < 100; n++) {
    const id = slotId(clientId, date, type, channel, n);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  // Unreachable in practice: MAX_SLOTS_PER_DAY caps a day long before 100.
  throw new Error(`Could not mint a slot id for ${date} ${type}/${channel}`);
}
