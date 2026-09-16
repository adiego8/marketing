// Minting and checking API keys. Pure — nothing here touches Firestore.
//
// Same split as lessons.ts / lessons-store.ts: every judgement about a key
// lives here so it can be tested, and api-keys-store.ts does the I/O. This repo
// mocks nothing, so logic that reaches for the network is logic that never gets
// a test.
//
// No secret is involved, and that is deliberate rather than an oversight. A key
// is 32 bytes from randomBytes, so a plain sha256 is not brute-forceable and a
// pepper would buy nothing — while adding an env var that, if rotated or
// missing on one deploy, silently invalidates every key in existence. Compare
// GOOGLE_TOKEN_ENC_KEY in google.ts, which encrypts a token issued by somebody
// else and therefore genuinely needs one.

import { createHash, randomBytes } from "crypto";
import { API_KEY_SCOPES, type ApiKeyScope } from "../types";

/**
 * Marks the string as ours at a glance, and is what tells the two auth rails
 * apart inside one Authorization header: the agent rail claims a token only
 * when it carries this prefix, so a Firebase ID token can never be mistaken for
 * a key, or the reverse.
 *
 * "live" leaves room for a "mk_test_" sibling later without a format change.
 */
export const KEY_PREFIX = "mk_live_";

/** Bytes of entropy behind a key. 32 is the same budget as a session token. */
const KEY_BYTES = 32;

/**
 * How much of a key is shown back to the operator.
 *
 * Enough to tell two keys apart in a list, far too little to guess the rest —
 * it leaves 30 base64url characters, about 180 bits, unknown.
 */
const PREFIX_CHARS = KEY_PREFIX.length + 8;

export interface NewKey {
  /** Shown once, at creation, and never stored. */
  secret: string;
  /** sha256 of the secret. The Firestore document id. */
  hash: string;
  /** The displayable fragment. */
  prefix: string;
}

export function generateKey(): NewKey {
  const secret = KEY_PREFIX + randomBytes(KEY_BYTES).toString("base64url");
  return { secret, hash: hashKey(secret), prefix: keyPrefix(secret) };
}

/**
 * The document id for a key.
 *
 * Hashing to the id rather than to a queried field means verification is one
 * get() with no index, and a stolen database dump yields no usable key — the
 * ids are the hashes, and sha256 of 32 random bytes does not invert.
 */
export function hashKey(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

export function keyPrefix(secret: string): string {
  return secret.trim().slice(0, PREFIX_CHARS);
}

/**
 * A cheap shape check before hashing, so a malformed header never becomes a
 * Firestore read.
 *
 * Length is bounded on both sides: base64url of 32 bytes is always 43
 * characters, and refusing anything longer stops an attacker making us hash
 * megabytes per request.
 */
export function looksLikeKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v.startsWith(KEY_PREFIX)) return false;
  const body = v.slice(KEY_PREFIX.length);
  return body.length === 43 && /^[A-Za-z0-9_-]+$/.test(body);
}

/** Pull the key out of an Authorization header, or null. */
export function keyFromHeader(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return looksLikeKey(token) ? token : null;
}

// No constant-time comparison anywhere in this file, deliberately. The secret
// is never compared in our process at all: the hash IS the document id, so
// Firestore's key lookup does the matching and there is no string equality
// over key material to leak a timing signal. Compare verifyState in google.ts,
// which does need timingSafeEqual because it compares an HMAC by hand.

/** The stored fields this module judges. A subset of the document. */
export interface KeyRecord {
  scopes: string[];
  revokedAt: string | null;
  expiresAt: string | null;
}

export type KeyRefusal = "revoked" | "expired";

/**
 * Is this key usable right now?
 *
 * Returns the reason rather than a boolean so the caller can log which of the
 * two it was — both answer 401 to the caller, because telling an unauthorized
 * client that its key is merely expired is more than it needs to know.
 */
export function keyRefusal(record: KeyRecord, now = new Date()): KeyRefusal | null {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) {
    return "expired";
  }
  return null;
}

export function hasScope(record: { scopes: string[] }, scope: ApiKeyScope): boolean {
  return record.scopes.includes(scope);
}

/**
 * Narrow whatever the operator asked for to scopes we actually honour.
 *
 * An unknown scope is dropped rather than rejected: a key minted by a newer
 * version of the UI must not become unusable, and a scope we do not understand
 * grants nothing anyway.
 */
export function parseScopes(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(API_KEY_SCOPES);
  const kept = new Set<ApiKeyScope>();
  for (const scope of value) {
    if (typeof scope === "string" && known.has(scope)) {
      kept.add(scope as ApiKeyScope);
    }
  }
  // Returned in the canonical order, not the caller's, so two keys granted the
  // same access always read the same in the UI.
  return API_KEY_SCOPES.filter((s) => kept.has(s));
}

/**
 * How stale lastUsedAt is allowed to get before it is worth a write.
 *
 * Stamping it per request turns every read endpoint into a read plus a write.
 * Nobody needs this field to the minute — it answers "is this key still in
 * use", and an hour answers that just as well.
 */
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function shouldStampLastUsed(
  lastUsedAt: string | null,
  now = new Date()
): boolean {
  if (!lastUsedAt) return true;
  const previous = Date.parse(lastUsedAt);
  if (Number.isNaN(previous)) return true;
  return now.getTime() - previous >= LAST_USED_THROTTLE_MS;
}
