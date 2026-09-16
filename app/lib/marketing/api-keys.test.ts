import { describe, it, expect } from "vitest";
import {
  KEY_PREFIX,
  generateKey,
  hashKey,
  keyPrefix,
  looksLikeKey,
  keyFromHeader,
  keyRefusal,
  hasScope,
  parseScopes,
  shouldStampLastUsed,
  LAST_USED_THROTTLE_MS,
} from "./api-keys";

/**
 * A key is the only credential in this app that a third party holds, and every
 * mistake here is silent: a key that is guessable, a revoked key that still
 * works, a scope check that passes because the array happened to be empty.
 * None of it shows up in a manual click-through, which is exactly why these
 * functions were pulled out of the Firestore path to begin with.
 */

describe("generateKey", () => {
  it("mints a key that passes its own format check", () => {
    const { secret } = generateKey();
    expect(looksLikeKey(secret)).toBe(true);
    expect(secret.startsWith(KEY_PREFIX)).toBe(true);
  });

  it("never repeats", () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateKey().secret));
    expect(secrets.size).toBe(200);
  });

  // The hash is the document id, so a collision would silently hand one
  // agency's key the other's client.
  it("hashes to the id it will be stored under", () => {
    const { secret, hash } = generateKey();
    expect(hash).toBe(hashKey(secret));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows back a fragment far too short to guess the rest", () => {
    const { secret, prefix } = generateKey();
    expect(prefix).toBe(keyPrefix(secret));
    expect(secret.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(secret.length / 2);
  });
});

describe("hashKey", () => {
  it("is stable across calls", () => {
    expect(hashKey("mk_live_abc")).toBe(hashKey("mk_live_abc"));
  });

  // Whitespace arrives from a copy-paste out of a terminal or a YAML file.
  // Hashing it as-is would reject a key the operator can see is correct.
  it("ignores surrounding whitespace", () => {
    expect(hashKey("  mk_live_abc\n")).toBe(hashKey("mk_live_abc"));
  });

  it("separates keys that differ by one character", () => {
    expect(hashKey("mk_live_abc")).not.toBe(hashKey("mk_live_abd"));
  });
});

describe("looksLikeKey", () => {
  const good = generateKey().secret;

  it("accepts a real key", () => {
    expect(looksLikeKey(good)).toBe(true);
  });

  it("rejects anything without the prefix", () => {
    // The case that matters: a Firebase ID token presented on the agent rail.
    expect(looksLikeKey("eyJhbGciOiJSUzI1NiIsImtpZCI6IjE")).toBe(false);
    expect(looksLikeKey(good.slice(KEY_PREFIX.length))).toBe(false);
  });

  it("rejects a wrong-length body", () => {
    expect(looksLikeKey(`${KEY_PREFIX}tooshort`)).toBe(false);
    expect(looksLikeKey(good + "x")).toBe(false);
  });

  // Without the length bound, a megabyte of "a" becomes a megabyte of hashing
  // per request, for free, from an unauthenticated caller.
  it("rejects an enormous body", () => {
    expect(looksLikeKey(KEY_PREFIX + "a".repeat(100_000))).toBe(false);
  });

  it("rejects characters outside base64url", () => {
    expect(looksLikeKey(`${KEY_PREFIX}${"a".repeat(42)}+`)).toBe(false);
    expect(looksLikeKey(`${KEY_PREFIX}${"a".repeat(42)}/`)).toBe(false);
  });

  it("rejects non-strings rather than throwing", () => {
    expect(looksLikeKey(null)).toBe(false);
    expect(looksLikeKey(undefined)).toBe(false);
    expect(looksLikeKey(42)).toBe(false);
    expect(looksLikeKey({})).toBe(false);
  });
});

describe("keyFromHeader", () => {
  const good = generateKey().secret;

  it("reads a bearer key", () => {
    expect(keyFromHeader(`Bearer ${good}`)).toBe(good);
  });

  it("returns null for a missing or malformed header", () => {
    expect(keyFromHeader(null)).toBeNull();
    expect(keyFromHeader(good)).toBeNull();
    expect(keyFromHeader(`Basic ${good}`)).toBeNull();
    expect(keyFromHeader("Bearer ")).toBeNull();
  });

  // The whole point of the prefix: this rail must decline a session token
  // rather than hash it and answer 401 by accident.
  it("declines a Firebase ID token", () => {
    expect(keyFromHeader("Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toBeNull();
  });
});

describe("keyRefusal", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const fine = { scopes: ["schedule:read"], revokedAt: null, expiresAt: null };

  it("lets a live key through", () => {
    expect(keyRefusal(fine, now)).toBeNull();
  });

  it("refuses a revoked key", () => {
    expect(keyRefusal({ ...fine, revokedAt: "2026-09-01T00:00:00.000Z" }, now)).toBe(
      "revoked"
    );
  });

  it("refuses an expired key", () => {
    expect(keyRefusal({ ...fine, expiresAt: "2026-09-14T00:00:00.000Z" }, now)).toBe(
      "expired"
    );
  });

  it("lets a key with a future expiry through", () => {
    expect(keyRefusal({ ...fine, expiresAt: "2026-10-01T00:00:00.000Z" }, now)).toBeNull();
  });

  // The boundary is closed: a key expiring exactly now is expired. Off by one
  // in the other direction leaves a key usable for a whole extra request.
  it("treats the expiry instant itself as expired", () => {
    expect(keyRefusal({ ...fine, expiresAt: now.toISOString() }, now)).toBe("expired");
  });

  // Revocation is the emergency stop. It must win over anything else.
  it("reports revocation ahead of expiry", () => {
    expect(
      keyRefusal(
        { ...fine, revokedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z" },
        now
      )
    ).toBe("revoked");
  });
});

describe("hasScope", () => {
  it("honours only what was granted", () => {
    const key = { scopes: ["schedule:read", "brand:read"] };
    expect(hasScope(key, "schedule:read")).toBe(true);
    expect(hasScope(key, "brand:read")).toBe(true);
    expect(hasScope(key, "schedule:publish")).toBe(false);
  });

  // A key whose scopes failed to deserialize must grant nothing, not
  // everything. This is the failure mode that turns a read key into a writer.
  it("grants nothing on an empty list", () => {
    expect(hasScope({ scopes: [] }, "schedule:read")).toBe(false);
  });
});

describe("parseScopes", () => {
  it("keeps the scopes it knows", () => {
    expect(parseScopes(["schedule:read", "brand:read"])).toEqual([
      "schedule:read",
      "brand:read",
    ]);
  });

  it("drops what it does not recognise rather than refusing the whole list", () => {
    expect(parseScopes(["schedule:read", "admin:everything", "*"])).toEqual([
      "schedule:read",
    ]);
  });

  it("de-duplicates", () => {
    expect(parseScopes(["brand:read", "brand:read"])).toEqual(["brand:read"]);
  });

  it("returns a canonical order regardless of how they were sent", () => {
    expect(parseScopes(["schedule:publish", "brand:read", "schedule:read"])).toEqual([
      "schedule:read",
      "brand:read",
      "schedule:publish",
    ]);
  });

  it("returns nothing for junk rather than throwing", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("schedule:read")).toEqual([]);
    expect(parseScopes([1, null, {}])).toEqual([]);
  });
});

describe("shouldStampLastUsed", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  it("stamps a key that has never been used", () => {
    expect(shouldStampLastUsed(null, now)).toBe(true);
  });

  it("does not stamp again within the window", () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    expect(shouldStampLastUsed(recent, now)).toBe(false);
  });

  it("stamps once the window has passed", () => {
    const old = new Date(now.getTime() - LAST_USED_THROTTLE_MS - 1).toISOString();
    expect(shouldStampLastUsed(old, now)).toBe(true);
  });

  // An unparseable timestamp should cost one write, not permanently freeze the
  // field at a value nobody can interpret.
  it("stamps over an unreadable value", () => {
    expect(shouldStampLastUsed("not a date", now)).toBe(true);
  });
});
