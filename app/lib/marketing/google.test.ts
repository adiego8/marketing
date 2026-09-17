import { describe, it, expect, beforeAll } from "vitest";
import { createHmac, randomBytes } from "crypto";
import {
  signState,
  verifyState,
  safeReturnTo,
  encrypt,
  decrypt,
  googleConfigured,
  googleMissingEnv,
  decideConnect,
} from "./google";

// The state is the only thing standing between the callback and anyone who can
// present a code, and the encryption is the only thing protecting a refresh
// token at rest. Both are pure, so both get tested.
beforeAll(() => {
  process.env.GOOGLE_OAUTH_STATE_SECRET = randomBytes(32).toString("hex");
  process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
});

describe("signState / verifyState", () => {
  it("round-trips the identity it was given", () => {
    const state = signState({ uid: "u1", agencyId: "a1" });
    expect(verifyState(state)).toMatchObject({ uid: "u1", agencyId: "a1" });
  });

  it("rejects a tampered payload", () => {
    // The whole point: someone who edits the agency cannot re-sign it.
    const state = signState({ uid: "u1", agencyId: "a1" });
    const [body, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ uid: "u1", agencyId: "SOMEONE_ELSE", exp: Date.now() + 60000 })
    ).toString("base64url");
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.${sig.slice(0, -2)}xx`)).toBeNull();
  });

  it("rejects an expired state", () => {
    const body = Buffer.from(
      JSON.stringify({ uid: "u1", agencyId: "a1", exp: Date.now() - 1 })
    ).toString("base64url");
    // Signed correctly, but stale — re-sign it the same way signState does.
    const sig = createHmac("sha256", process.env.GOOGLE_OAUTH_STATE_SECRET!)
      .update(body)
      .digest("base64url");
    expect(verifyState(`${body}.${sig}`)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to run first.
    for (const bad of [null, "", "nodot", "a.b", ".", "x.".repeat(50)]) {
      expect(() => verifyState(bad as string | null)).not.toThrow();
      expect(verifyState(bad as string | null)).toBeNull();
    }
  });

  it("carries a safe return path and drops an unsafe one", () => {
    expect(verifyState(signState({ uid: "u", agencyId: "a", returnTo: "/clients/x/schedule" })))
      .toMatchObject({ returnTo: "/clients/x/schedule" });
    // Even signed by us, an absolute URL must not come back out.
    expect(verifyState(signState({ uid: "u", agencyId: "a", returnTo: "//evil.com" })))
      .toMatchObject({ returnTo: undefined });
  });
});

describe("safeReturnTo", () => {
  it("accepts an app-relative path", () => {
    expect(safeReturnTo("/clients/abc/schedule")).toBe("/clients/abc/schedule");
    expect(safeReturnTo("/")).toBe("/");
  });

  it("refuses anything that could leave the origin", () => {
    // "//evil.com" is protocol-relative and would navigate off-site.
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "http://evil.com",
      "evil.com",
      "\\\\evil.com",
      "/path\\..\\x",
      123,
      null,
      undefined,
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips a token", () => {
    const token = "1//0abcDEF-refresh_token_example";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call: identical tokens must not produce identical blobs.
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("stores as iv:tag:ciphertext hex", () => {
    const parts = encrypt("x").split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte GCM tag
  });

  it("refuses to decrypt tampered ciphertext", () => {
    // GCM authenticates: a flipped byte must fail loudly, not decode to junk.
    const blob = encrypt("secret");
    const [iv, tag, ct] = blob.split(":");
    const flipped = ct.startsWith("0") ? "1" + ct.slice(1) : "0" + ct.slice(1);
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    const good = process.env.GOOGLE_TOKEN_ENC_KEY;
    process.env.GOOGLE_TOKEN_ENC_KEY = "abcd";
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.GOOGLE_TOKEN_ENC_KEY = good;
  });
});

describe("googleConfigured", () => {
  it("names exactly what is missing", () => {
    const saved = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(googleConfigured()).toBe(false);
    expect(googleMissingEnv()).toContain("GOOGLE_OAUTH_CLIENT_ID");
    if (saved) process.env.GOOGLE_OAUTH_CLIENT_ID = saved;
  });
});

/**
 * The gate that keeps one Google account per agency.
 *
 * Both failure directions are silent and expensive. Too loose and a different
 * account takes over, leaving every client pointing at a calendar it cannot
 * see — no error until the next sync 404s on every slot. Too strict and the
 * needsReconnect scope upgrade becomes impossible, stranding exactly the grants
 * that cannot do anything useful.
 */
describe("decideConnect", () => {
  const connected = (email: string | null) => ({ connected: true, email });

  it("allows the first connection", () => {
    expect(decideConnect({ connected: false, email: null }, "a@x.com")).toEqual({
      allow: true,
    });
  });

  /**
   * The reason this is not simply "refuse while connected": reconnecting the
   * same account is the only way to widen a grant that predates the calendar
   * scope, which getConnectionStatus surfaces as needsReconnect.
   */
  it("allows the same account to reconnect, which is the scope-upgrade path", () => {
    expect(decideConnect(connected("a@x.com"), "a@x.com")).toEqual({ allow: true });
  });

  it("treats case and stray whitespace as the same account", () => {
    expect(decideConnect(connected("Team.Leader@Numerico.co"), "team.leader@numerico.co"))
      .toEqual({ allow: true });
    expect(decideConnect(connected("a@x.com"), "  a@x.com  ")).toEqual({ allow: true });
  });

  /** The bug this whole change exists for. */
  it("refuses a different account", () => {
    expect(decideConnect(connected("info@numericosoftware.com"), "team.leader@numerico.co"))
      .toEqual({ allow: false, reason: "account-mismatch" });
  });

  /**
   * An email we do not have is not evidence of a mismatch. Refusing on unknown
   * would lock out an agency whose stored credential predates the email being
   * recorded, with disconnect as the only escape.
   */
  it("allows when either side's email is unknown", () => {
    expect(decideConnect(connected(null), "a@x.com")).toEqual({ allow: true });
    expect(decideConnect(connected("a@x.com"), null)).toEqual({ allow: true });
    expect(decideConnect(connected(""), "a@x.com")).toEqual({ allow: true });
  });
});
