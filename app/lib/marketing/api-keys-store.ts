// Firestore for API keys. Every judgement lives in api-keys.ts; this is the I/O.

import { db, COLLECTIONS, FieldValue, serializeApiKey } from "../firestore";
import {
  generateKey,
  hashKey,
  keyRefusal,
  shouldStampLastUsed,
  type KeyRecord,
} from "./api-keys";
import type { ApiKey, ApiKeyScope } from "../types";

/** The stored document, plus the id it lives under (which is the key's hash). */
export interface StoredKey extends KeyRecord {
  id: string;
  clientId: string;
  agencyId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
}

export interface CreateKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  createdBy: string | null;
  /** ISO instant, or null for a key that never expires. */
  expiresAt?: string | null;
}

/**
 * Mint a key.
 *
 * The plaintext comes back exactly once, in the return value, and is never
 * written anywhere — not to the document, not to a log. Losing it means
 * revoking and minting another, which is the intended cost.
 */
export async function createApiKey(
  clientId: string,
  agencyId: string,
  input: CreateKeyInput
): Promise<{ key: ApiKey; secret: string }> {
  const { secret, hash, prefix } = generateKey();

  const doc = {
    clientId,
    agencyId,
    name: input.name,
    prefix,
    scopes: input.scopes,
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };

  // create(), not set(): the id is a hash of 32 random bytes, so an existing
  // document means either a collision (impossible in practice) or a bug that
  // would otherwise silently overwrite somebody's live key.
  const ref = db().collection(COLLECTIONS.apiKeys).doc(hash);
  await ref.create(doc);

  const snap = await ref.get();
  return { key: serializeApiKey(hash, snap.data() ?? doc) as ApiKey, secret };
}

/**
 * Resolve a presented key to its document.
 *
 * One get() on the hash — no query, no index, and no way to enumerate keys by
 * guessing a field. Returns null for anything unusable so callers have a single
 * branch; keyRefusal() tells revoked from expired for the log.
 */
export async function findApiKey(secret: string): Promise<StoredKey | null> {
  const hash = hashKey(secret);
  const snap = await db().collection(COLLECTIONS.apiKeys).doc(hash).get();
  if (!snap.exists) return null;

  const d = snap.data() ?? {};
  const record: StoredKey = {
    id: hash,
    clientId: String(d.clientId ?? ""),
    agencyId: String(d.agencyId ?? ""),
    name: String(d.name ?? ""),
    prefix: String(d.prefix ?? ""),
    scopes: Array.isArray(d.scopes) ? d.scopes.map((s: unknown) => String(s)) : [],
    lastUsedAt: isoOrNull(d.lastUsedAt),
    expiresAt: isoOrNull(d.expiresAt),
    revokedAt: isoOrNull(d.revokedAt),
  };

  // A document with no client is not a key, it is debris. Fail closed.
  if (!record.clientId || !record.agencyId) return null;
  return keyRefusal(record) ? null : record;
}

/**
 * Record that a key was used, at most once an hour.
 *
 * Never throws and is awaited by the caller. Telemetry must not fail a request
 * that was otherwise fine — but firing it off unawaited is not an option
 * either, because a serverless function can freeze the moment it responds.
 */
export async function touchApiKey(record: StoredKey): Promise<void> {
  if (!shouldStampLastUsed(record.lastUsedAt)) return;
  try {
    await db()
      .collection(COLLECTIONS.apiKeys)
      .doc(record.id)
      .update({ lastUsedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    console.error("Could not stamp API key use", error);
  }
}

/** Every key ever minted for a client, revoked ones included. */
export async function listApiKeys(clientId: string): Promise<ApiKey[]> {
  const snap = await db()
    .collection(COLLECTIONS.apiKeys)
    .where("clientId", "==", clientId)
    .get();

  // Sorted in memory, like every other list here: no composite index to deploy.
  return snap.docs
    .map((doc) => serializeApiKey(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) as ApiKey[];
}

/**
 * Revoke a key. Kept rather than deleted, so "which key was that, and when did
 * we stop trusting it" stays answerable.
 *
 * @returns null when the key does not exist or belongs to another client.
 */
export async function revokeApiKey(
  clientId: string,
  keyId: string
): Promise<ApiKey | null> {
  const ref = db().collection(COLLECTIONS.apiKeys).doc(keyId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  if (snap.data()?.clientId !== clientId) return null;

  // Already revoked: leave the original timestamp alone rather than moving it.
  if (!snap.data()?.revokedAt) {
    await ref.update({ revokedAt: FieldValue.serverTimestamp() });
  }
  const after = await ref.get();
  return serializeApiKey(keyId, after.data() ?? {}) as ApiKey;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toDate" in (value as object)) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}
