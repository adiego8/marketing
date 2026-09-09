// Deterministic slot document ids.
//
// The id is (client, campaign, type, n) — all INPUTS to planning, taken from
// the campaign's content plan. It used to be (client, date, type, channel, n),
// which were outputs of the assign stage, so the same intent produced a
// different id on every run and the id deduped nothing across runs.
//
// Being derived from the demand buys two things:
//
//  1. Within-preview idempotency, as before. A double-clicked commit or a
//     retried write cannot create a second copy, because Firestore's create()
//     refuses an id that already exists.
//  2. Cross-run idempotency, which is new. Re-proposing a piece a campaign
//     still owes yields the id it would have had, so committing the same piece
//     twice fails loudly instead of silently doubling the campaign's delivery.
//
// Do NOT hash the theme into the id: that makes the id change whenever the
// wording changes, which breaks the drop/replace flow — a replacement has to
// keep the id of the piece it replaces.

/** Firestore document ids cannot contain "/", and free-form type keys can. */
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
  campaignId: string,
  type: string,
  n: number
): string {
  return `${clientId}__${slugSegment(campaignId)}__${slugSegment(type)}__${n}`;
}

/**
 * Mint the next free id for a (campaign, type) pair.
 *
 * `taken` must be seeded with the ids of the client's existing slots, so a
 * piece already delivered against this campaign never has its id reused.
 * Mutates `taken` so repeated calls in one run keep advancing.
 */
export function mintSlotId(
  taken: Set<string>,
  clientId: string,
  campaignId: string,
  type: string
): string {
  for (let n = 0; n < 500; n++) {
    const id = slotId(clientId, campaignId, type, n);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error(`Could not mint a slot id for ${campaignId}/${type}`);
}
