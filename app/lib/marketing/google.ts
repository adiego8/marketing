// Server-only: Google OAuth (offline) and encrypted refresh-token storage.
// Never import this from a client component.
//
// Modelled on numerico-website/lib/google.ts, which is the working
// implementation in this codebase. Three deliberate differences:
//
//  1. SCOPE. The website asks for `calendar.events`, which can only write
//     events into calendars that already exist. This app creates a calendar per
//     client, and that needs the broader `auth/calendar`. Asking for it on the
//     website's OAuth client would re-trigger consent for every website user,
//     which is why .env.example has always said to use a separate client here.
//
//  2. KEYED BY AGENCY, not by uid. The website stores one credential per admin
//     because a Gmail draft belongs to a person. A client's calendar belongs to
//     the agency: keying it per-user would mean a second member cannot sync,
//     and one person's revoked grant would orphan every calendar.
//
//  3. The signed state carries the agency alongside the uid, because the
//     callback is a top-level browser redirect with no Authorization header and
//     therefore cannot resolve membership itself.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { google } from "googleapis";
import { db, COLLECTIONS, FieldValue } from "../firestore";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // Full calendar access: calendars().insert is not covered by calendar.events.
  "https://www.googleapis.com/auth/calendar",
];

export function googleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REDIRECT_URI &&
    process.env.GOOGLE_TOKEN_ENC_KEY &&
    process.env.GOOGLE_OAUTH_STATE_SECRET
  );
}

/** Names the missing pieces, so a 503 can say what to set rather than just failing. */
export function googleMissingEnv(): string[] {
  return [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_TOKEN_ENC_KEY",
    "GOOGLE_OAUTH_STATE_SECRET",
  ].filter((k) => !process.env[k]);
}

// A fresh client per call: credentials are per-agency, so there is nothing
// safe to cache on the module.
function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

/* ------------------------------------------------------ OAuth + exchange -- */

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    // Google returns a refresh token only on first consent. Without this, a
    // reconnect silently yields no refresh token and the grant is useless.
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export async function exchangeCode(code: string): Promise<{
  refreshToken: string | null;
  email: string | null;
  scopes: string[];
}> {
  const { tokens } = await oauthClient().getToken(code);
  return {
    refreshToken: tokens.refresh_token ?? null,
    email: tokens.id_token ? emailFromIdToken(tokens.id_token) : null,
    scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
  };
}

// The signature is not verified: this token came straight from getToken() over
// TLS, so it has not passed through anything untrusted. Do NOT reuse this for a
// token received from a browser.
function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- signed state --- */

export interface StatePayload {
  uid: string;
  agencyId: string;
  /** Where to send the browser afterwards. Must be an app-relative path. */
  returnTo?: string;
}

/**
 * Only same-origin paths survive.
 *
 * The state is signed, so a value cannot be forged — but it is minted from a
 * request parameter, and echoing that into a redirect without this check is
 * how an open redirect gets built by accident. "//evil.com" is a protocol
 * relative URL, which is why a leading "//" is rejected along with anything
 * that is not a plain path.
 */
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value.includes("\\")) return undefined;
  return value;
}

export function signState(payload: StatePayload): string {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET!;
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string | null): StatePayload | null {
  if (!state || !state.includes(".")) return null;
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!secret) return null;

  const [body, sig] = state.split(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length is checked first: timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { uid, agencyId, returnTo, exp } = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );
    if (typeof uid !== "string" || typeof agencyId !== "string") return null;
    if (typeof exp !== "number" || Date.now() > exp) return null;
    return { uid, agencyId, returnTo: safeReturnTo(returnTo) };
  } catch {
    return null;
  }
}

/* ---------------------------------------- refresh token encryption (GCM) -- */

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

/* ---------------------------------------------------- credential storage -- */

export async function saveGoogleCredentials(
  agencyId: string,
  data: { refreshToken: string; email: string | null; scopes: string[] }
): Promise<void> {
  const ref = db().collection(COLLECTIONS.googleCredentials).doc(agencyId);
  const exists = (await ref.get()).exists;
  await ref.set(
    {
      email: data.email ?? null,
      refreshTokenEnc: encrypt(data.refreshToken),
      scopes: data.scopes,
      updatedAt: FieldValue.serverTimestamp(),
      // Only on the first connect, so reconnecting does not reset the date.
      ...(exists ? {} : { connectedAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function getConnectionStatus(agencyId: string): Promise<{
  connected: boolean;
  email: string | null;
  scopes: string[];
  /** True when the grant predates the calendar scope and cannot create calendars. */
  needsReconnect: boolean;
}> {
  const snap = await db().collection(COLLECTIONS.googleCredentials).doc(agencyId).get();
  if (!snap.exists) {
    return { connected: false, email: null, scopes: [], needsReconnect: false };
  }
  const d = snap.data()!;
  const scopes: string[] = Array.isArray(d.scopes) ? d.scopes : [];
  return {
    connected: true,
    email: d.email ?? null,
    scopes,
    needsReconnect: !scopes.includes("https://www.googleapis.com/auth/calendar"),
  };
}

export async function disconnect(agencyId: string): Promise<void> {
  const ref = db().collection(COLLECTIONS.googleCredentials).doc(agencyId);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.refreshTokenEnc && googleConfigured()) {
    try {
      await oauthClient().revokeToken(decrypt(snap.data()!.refreshTokenEnc));
    } catch {
      // Best effort. The record goes regardless — leaving it would show
      // "connected" for a grant we can no longer use.
    }
  }
  await ref.delete();
}

/**
 * An OAuth2 client carrying only the refresh token; googleapis mints access
 * tokens per call. Access tokens are never persisted.
 *
 * @returns null when this agency has not connected Google.
 */
export async function getAuthorizedClient(agencyId: string) {
  const snap = await db().collection(COLLECTIONS.googleCredentials).doc(agencyId).get();
  if (!snap.exists || !snap.data()?.refreshTokenEnc) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(snap.data()!.refreshTokenEnc) });
  return client;
}

/** Thrown when an operation needs Google and the agency has not connected it. */
export class NotConnectedError extends Error {
  constructor() {
    super("Google Calendar is not connected for this agency.");
    this.name = "NotConnectedError";
  }
}
