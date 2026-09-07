// Server-only Firestore access for strategy. One strategy per client, enforced
// by using the clientId AS the document id — stronger than the Postgres UNIQUE
// constraint it replaces, and it makes reads a single get() with no query.
import { db, COLLECTIONS, FieldValue, serializeStrategy } from "../firestore";
import { CHANNELS, type Channel } from "./posting-windows";

/** A weekly quota entry, after normalisation. */
export interface QuotaEntry {
  count: number;
  channels: Channel[];
}

// The planner assigns each slot a channel, so the quota has to say which
// channels a content type may go out on. The old shape was a bare
// type -> number map; a bare number still parses, as an entry with no channel
// preference, so existing data and hand-written input both degrade instead of
// breaking.
export function normalizeQuotaWeekly(raw: unknown): Record<string, QuotaEntry> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, QuotaEntry> = {};

  for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number") {
      out[type] = { count: Math.max(0, Math.floor(value)), channels: [] };
      continue;
    }
    if (value && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      const count = typeof entry.count === "number" ? Math.max(0, Math.floor(entry.count)) : 0;
      const channels = Array.isArray(entry.channels)
        ? entry.channels.filter((c): c is Channel =>
            (CHANNELS as readonly string[]).includes(c as string)
          )
        : [];
      out[type] = { count, channels };
    }
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const NESTED_FIELDS = [
  ["icp", "icp"],
  ["voice", "voice"],
  ["positioning", "positioning"],
  ["messaging", "messaging"],
  ["goals", "goals"],
  ["content_strategy", "contentStrategy"],
] as const;

// PUT is an upsert and a partial merge: an absent key is left untouched.
// `isCreate` is passed because business_name is required to create but may be
// omitted when updating. The Python let a create without it reach the database
// and fail a NOT NULL constraint, surfacing as a 500.
export function parseStrategyInput(
  body: unknown,
  isCreate: boolean
): { data: Record<string, unknown> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  if ("business_name" in b) {
    const name = typeof b.business_name === "string" ? b.business_name.trim() : "";
    if (!name) return { error: "Business name cannot be empty." };
    update.businessName = name;
  } else if (isCreate) {
    return { error: "Business name is required to create a strategy." };
  }

  for (const [apiField, docField] of NESTED_FIELDS) {
    if (apiField in b) update[docField] = asObject(b[apiField]);
  }

  if ("content_quota" in b) {
    const quota = asObject(b.content_quota);
    update.contentQuota = {
      weekly: normalizeQuotaWeekly(quota.weekly),
      rationale: typeof quota.rationale === "string" ? quota.rationale : "",
    };
  }

  if (Object.keys(update).length === 0) {
    return { error: "No recognised fields to update." };
  }
  return { data: update };
}

export async function getStrategy(clientId: string) {
  const snap = await db().collection(COLLECTIONS.strategies).doc(clientId).get();
  if (!snap.exists) return null;
  return serializeStrategy(clientId, snap.data() ?? {});
}

export async function upsertStrategy(clientId: string, update: Record<string, unknown>) {
  const ref = db().collection(COLLECTIONS.strategies).doc(clientId);
  const existing = await ref.get();

  if (!existing.exists) {
    // Seed every field so a strategy created with only a business_name still
    // reads back with the full shape the editor expects.
    await ref.set({
      clientId,
      businessName: "",
      icp: {},
      voice: {},
      positioning: {},
      messaging: {},
      goals: {},
      contentStrategy: {},
      contentQuota: { weekly: {}, rationale: "" },
      ...update,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.set({ ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  const snap = await ref.get();
  return serializeStrategy(clientId, snap.data() ?? {});
}
