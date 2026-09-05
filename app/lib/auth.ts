import { adminAuth } from "./firebase-admin";
import { db, COLLECTIONS } from "./firestore";
import type { DecodedIdToken } from "firebase-admin/auth";

// Two distinct concerns, deliberately kept apart:
//
//   1. WHO ARE YOU     -> Firebase Auth ID token, verified here.
//   2. MAY I USE YOUR  -> a separate Google OAuth grant with the calendar
//      GOOGLE CALENDAR     scope, stored encrypted in google_credentials/{uid}.
//
// The Python prototype fused them into one "Sign in with Google" and then
// trusted a hardcoded DEFAULT_AGENCY_ID on every route (auth.py:28), which is
// why its API had no request authentication at all. Splitting them means API
// routes can be authenticated even when Calendar is not connected.

export interface Session {
  uid: string;
  email: string | null;
  agencyId: string;
  role: string;
}

export async function verifyToken(authHeader: string | null): Promise<DecodedIdToken | null> {
  if (!adminAuth || !authHeader?.startsWith("Bearer ")) return null;
  try {
    return await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
  } catch {
    return null;
  }
}

// Verify the caller and load their users/{uid} document, which carries the
// agency binding. Returns null for an unknown or unprovisioned user rather
// than throwing, so routes can answer 401 uniformly.
export async function getSession(authHeader: string | null): Promise<Session | null> {
  const decoded = await verifyToken(authHeader);
  if (!decoded) return null;
  try {
    const snap = await db().collection(COLLECTIONS.users).doc(decoded.uid).get();
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
// another agency's clients.
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
