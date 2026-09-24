// Encrypting a secret before it goes into Firestore, and naming it afterwards.
//
// These were written for Google refresh tokens and lived in google.ts, which
// was the right place while a refresh token was the only secret this app
// stored. The OpenAI key is the second, so they move here rather than being
// imported out of a module about calendars.
//
// WHY ENCRYPT AT ALL. firestore.rules denies every client read and write, and
// the Admin SDK bypasses rules entirely — so the rules protect nothing that
// this process does. Encryption at rest is the only thing standing between a
// database dump and a working credential.
//
// WHAT CANNOT MOVE. The key that protects these secrets stays in env, and has
// to: you cannot store the key beside the thing it protects. GOOGLE_TOKEN_ENC_KEY
// is that key. The name is historical — it now covers every secret this app
// stores, not only Google's — and renaming it would break every existing
// deployment for no gain. Rotating it invalidates ALL of them at once: everyone
// must reconnect Google AND the OpenAI key must be entered again.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function encKey(): Buffer {
  const key = Buffer.from(process.env.GOOGLE_TOKEN_ENC_KEY || "", "hex");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENC_KEY must be 32 bytes of hex (64 characters).");
  }
  return key;
}

/** Stored as iv:tag:ciphertext, all hex. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ct.toString("hex"),
  ].join(":");
}

export function decrypt(blob: string): string {
  const [ivHex, tagHex, ctHex] = blob.split(":");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The fragment of a secret that is safe to show back.
 *
 * The LAST four characters, not the leading prefix api-keys.ts displays. That
 * module shows the front because it mints its own keys and the front is the
 * random part; an OpenAI key begins "sk-proj-" and the front distinguishes
 * nothing. Four is what OpenAI's own dashboard shows, so it is the fragment
 * someone can actually match against their list of keys.
 *
 * Returns "" for anything too short to have four characters left over, so a
 * hint can never be the whole secret.
 */
export function keyHint(secret: unknown): string {
  if (typeof secret !== "string") return "";
  const trimmed = secret.trim();
  return trimmed.length > 4 ? trimmed.slice(-4) : "";
}
