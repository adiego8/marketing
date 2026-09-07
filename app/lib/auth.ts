import { adminAuth, adminInitError } from "./firebase-admin";
import { db, COLLECTIONS, FieldValue } from "./firestore";
import type { DecodedIdToken } from "firebase-admin/auth";

// Two distinct concerns, deliberately kept apart:
//
//   1. WHO ARE YOU     -> Firebase Auth ID token, verified here.
//   2. MAY I USE YOUR  -> a separate Google OAuth grant with the calendar
//      GOOGLE CALENDAR     scope, stored encrypted (Phase 4).
//
// The Python prototype fused them into one "Sign in with Google" and then
// trusted a hardcoded DEFAULT_AGENCY_ID on every route (auth.py:28), which is
// why its API had no request authentication at all. Splitting them means API
// routes can be authenticated even when Calendar is not connected.
//
// Authorisation is marketing-specific. The Firebase project is shared with
// numerico-website, so a valid ID token only proves the caller is a numerico
// user; membership in marketing_members is what grants access here.
//
// marketing_members is a RECORD, not a rule. Today the first person to sign in
// claims the agency and becomes its admin, which is what an MVP needs. When
// billing goes live, numerico grants a `marketer` entitlement on a
// customers/{id} document — the same rail already carrying engage, handy and
// mywelltax — and that grant writes the member document here. Routes keep
// asking one question and only the source of the answer moves, so none of them
// change. numericoDb in lib/firebase-admin.ts is the handle for reading those
// entitlements when that lands.

export interface Session {
  uid: string;
  email: string | null;
  agencyId: string;
  role: string;
}

/**
 * Whether the server can verify tokens at all.
 *
 * Without this, a missing service account is indistinguishable from a bad
 * token: verifyToken returns null either way and every route answers 401,
 * which reads as "you are signed out" when the truth is "this server was never
 * given credentials". Callers use it to say which.
 */
export function isAuthConfigured(): boolean {
  return Boolean(adminAuth);
}

const AUTH_VARS_MISSING =
  "Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, " +
  "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local (see .env.example).";

/**
 * Why auth is unavailable, in the caller's words.
 *
 * Present-but-invalid is a different problem from absent and needs a different
 * fix, so it gets a different sentence. The commonest cause by far is a
 * FIREBASE_PRIVATE_KEY pasted into a hosting dashboard with the surrounding
 * quotes still attached — dotenv strips those, a dashboard does not.
 */
export function authNotConfigured(): string {
  if (adminInitError) {
    // The SDK's messages end in a full stop; a second one reads as a typo.
    const why = adminInitError.replace(/\.\s*$/, "");
    return `Firebase Admin credentials were rejected: ${why}. Check FIREBASE_PRIVATE_KEY — it must have no surrounding quotes.`;
  }
  return AUTH_VARS_MISSING;
}

/** @deprecated Prefer authNotConfigured(), which names the actual failure. */
export const AUTH_NOT_CONFIGURED = AUTH_VARS_MISSING;

export async function verifyToken(authHeader: string | null): Promise<DecodedIdToken | null> {
  if (!adminAuth || !authHeader?.startsWith("Bearer ")) return null;
  try {
    return await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
  } catch {
    return null;
  }
}

// Verify the caller and load their marketing membership. Returns null for a
// valid Firebase user who is not a marketing member, so routes answer 401
// uniformly whether the token is bad or the person simply has no access here.
export async function getSession(authHeader: string | null): Promise<Session | null> {
  const decoded = await verifyToken(authHeader);
  if (!decoded) return null;
  try {
    const snap = await db().collection(COLLECTIONS.members).doc(decoded.uid).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (!data.agencyId) return null;
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      agencyId: String(data.agencyId),
      role: String(data.role ?? "member"),
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(authHeader: string | null): Promise<Session | null> {
  const session = await getSession(authHeader);
  return session && session.role === "admin" ? session : null;
}

// Load a client and confirm it belongs to the caller's agency. Returns null for
// both "missing" and "not yours" so a caller cannot probe for the existence of
// another agency's clients. Archived clients are excluded — matching the
// soft-delete used by DELETE /clients/{id}.
export async function getClientForSession(
  session: Session,
  clientId: string
): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  try {
    const snap = await db().collection(COLLECTIONS.clients).doc(clientId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (data.agencyId !== session.agencyId) return null;
    if (data.status === "archived") return null;
    return { id: snap.id, data };
  } catch {
    return null;
  }
}

// Called on every token change from the browser. Creates the membership record
// on first sign-in: the very first user to arrive bootstraps an agency and
// becomes its admin; anyone after that is refused until an admin invites them,
// so a numerico-website user cannot self-serve into this app.
export async function ensureMember(decoded: DecodedIdToken): Promise<Session | null> {
  const memberRef = db().collection(COLLECTIONS.members).doc(decoded.uid);
  const existing = await memberRef.get();

  if (existing.exists) {
    const data = existing.data() ?? {};
    if (!data.agencyId) return null;
    // Keep the denormalised email fresh; it is what the members list displays.
    if (decoded.email && data.email !== decoded.email) {
      await memberRef.update({ email: decoded.email });
    }
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      agencyId: String(data.agencyId),
      role: String(data.role ?? "member"),
    };
  }

  // Bootstrap is gated on there being no MEMBERS, not no agencies.
  //
  // Gating on agencies locks everyone out permanently the moment an agency
  // document exists without a member to go with it — which the seed script
  // does, and which any half-finished setup would too. Nobody could then sign
  // in to claim it, and nobody could be invited, because inviting requires an
  // admin who cannot exist.
  const members = await db().collection(COLLECTIONS.members).limit(1).get();
  if (!members.empty) return null; // someone is already here: membership is by invitation

  // Adopt an ownerless agency if one is sitting there, rather than creating a
  // second one beside it.
  const agencies = await db().collection(COLLECTIONS.agencies).limit(1).get();
  let agencyId: string;

  if (!agencies.empty) {
    agencyId = agencies.docs[0].id;
  } else {
    const agencyRef = db().collection(COLLECTIONS.agencies).doc();
    await agencyRef.set({
      name: decoded.email ? `${decoded.email.split("@")[0]}'s agency` : "My agency",
      createdAt: FieldValue.serverTimestamp(),
    });
    agencyId = agencyRef.id;
  }

  await memberRef.set({
    agencyId,
    email: decoded.email ?? null,
    name: decoded.name ?? null,
    role: "admin",
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    agencyId,
    role: "admin",
  };
}
