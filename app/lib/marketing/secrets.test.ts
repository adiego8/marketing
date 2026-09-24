import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "crypto";
import { encrypt, decrypt, keyHint } from "./secrets";

// Encryption at rest is the only thing between a database dump and a working
// credential: firestore.rules denies every client read, and the Admin SDK this
// process uses bypasses rules entirely, so the rules protect nothing here.
//
// The encrypt/decrypt cases are carried over verbatim from google.test.ts,
// where they were written for refresh tokens. Nothing about the algorithm or
// the stored format changed when the module moved, and these passing unchanged
// is the evidence for that.
beforeAll(() => {
  process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
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

describe("keyHint", () => {
  it("shows the last four characters, which is what OpenAI shows", () => {
    expect(keyHint("sk-proj-abcdefgh1234")).toBe("1234");
  });

  it("ignores surrounding whitespace, as the stored key would be trimmed", () => {
    expect(keyHint("  sk-proj-abcdefgh1234  ")).toBe("1234");
  });

  it("says nothing rather than leak a short secret whole", () => {
    // Four characters of a four-character string IS the string. A hint can
    // never be the secret, so below the threshold it returns nothing at all.
    expect(keyHint("abcd")).toBe("");
    expect(keyHint("abc")).toBe("");
    expect(keyHint("")).toBe("");
  });

  it("survives a value that is not a string", () => {
    expect(keyHint(null)).toBe("");
    expect(keyHint(undefined)).toBe("");
    expect(keyHint(1234)).toBe("");
  });
});
