import { adminAuth, adminInitError, numericoDb } from "./firebase-admin";
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
// marketing_members is a RECORD, not a rule. numerico grants the `marketing`
// product on a customers/{id} document — the same entitlement rail that carries
// engage, handy and mywelltax — and ensureMember materialises that grant into a
// member record on sign-in, provisioning the customer as admin of their own
// agency. Routes keep asking one question (getSession -> marketing_members);
// only the source of the answer is the entitlement. numericoDb in
// lib/firebase-admin.ts is the read-only handle for those entitlements. A staff
// allowlist (MARKETING_STAFF_UIDS) covers numerico's own team off the rail.

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

const MARKETING_KEY = "marketing";

// Staff allowlist: uids or emails that get in regardless of the customer
// entitlement rail, for numerico's own team. Comma-separated in
// MARKETING_STAFF_UIDS; unset (the default) means the entitlement is the only
// way in. Compared case-insensitively.
function isStaff(decoded: DecodedIdToken): boolean {
  const allow = new Set(
    (process.env.MARKETING_STAFF_UIDS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (allow.size === 0) return false;
  if (allow.has(decoded.uid.toLowerCase())) return true;
  const email = decoded.email?.trim().toLowerCase();
  return Boolean(email && allow.has(email));
}

// Read-only lookup against numerico-website's Firestore: does this person's
// customer record carry an ACTIVE `marketing` entitlement? Mirrors numerico's
// own resolveCustomerForUser order — by ownerUid first, then a lowercased email
// match so an as-yet-unlinked customer still resolves. Returns the customer id
// (used as the agency's stable key) or null. Never writes to numericoDb.
async function findMarketingCustomerId(
  uid: string,
  email: string | null
): Promise<string | null> {
  if (!numericoDb) return null;
  const customers = numericoDb.collection("customers");

  let snap = await customers.where("ownerUid", "==", uid).limit(1).get();
  if (snap.empty && email) {
    snap = await customers.where("email", "==", email.trim().toLowerCase()).limit(1).get();
  }
  if (snap.empty) return null;

  const entitlements = snap.docs[0].data().entitlements;
  if (!Array.isArray(entitlements)) return null;

  const active = entitlements.some(
    (e) => e?.key === MARKETING_KEY && e?.status === "active"
  );
  return active ? snap.docs[0].id : null;
}

// Called on every token change from the browser (sign-in and each token
// refresh). Resolves marketing membership from numerico's entitlement rail:
// a customer granted the `marketing` product — or a member of the staff
// allowlist — is admitted and, on first arrival, provisioned as the admin of
// their OWN agency. Removing the entitlement revokes access on the next
// sign-in/refresh by deleting the member record (getSession then denies from
// the following request on). Returns null for anyone without access, so the
// route answers 403.
export async function ensureMember(decoded: DecodedIdToken): Promise<Session | null> {
  const memberRef = db().collection(COLLECTIONS.members).doc(decoded.uid);
  const email = decoded.email ?? null;

  // Grant source: staff allowlist, or an active `marketing` entitlement on the
  // linked numerico customer. The customer id doubles as the agency's stable key.
  const staff = isStaff(decoded);
  const customerId = staff ? null : await findMarketingCustomerId(decoded.uid, email);
  const entitled = staff || customerId !== null;

  const existing = await memberRef.get();

  if (!entitled) {
    // Revoke: someone who had access but no longer qualifies loses their record.
    if (existing.exists) await memberRef.delete();
    return null;
  }

  if (existing.exists) {
    const data = existing.data() ?? {};
    if (!data.agencyId) return null;
    // Keep the denormalised email fresh; it is what the members list displays.
    if (email && data.email !== email) {
      await memberRef.update({ email });
    }
    return {
      uid: decoded.uid,
      email,
      agencyId: String(data.agencyId),
      role: String(data.role ?? "member"),
    };
  }

  // First admit: provision the tenant. The agency doc id is derived from the
  // grant source (numerico customer id, or the uid for staff) so repeated
  // sign-ins are idempotent — no duplicate agencies. Agency + member are written
  // together in a transaction; the agency is created only if absent.
  const agencyId = customerId ? `cust_${customerId}` : `staff_${decoded.uid}`;
  const agencyRef = db().collection(COLLECTIONS.agencies).doc(agencyId);

  await db().runTransaction(async (tx) => {
    const agencySnap = await tx.get(agencyRef);
    if (!agencySnap.exists) {
      tx.set(agencyRef, {
        name: decoded.name ?? (email ? email.split("@")[0] : "My agency"),
        numericoCustomerId: customerId,
        ownerUid: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(memberRef, {
      agencyId,
      email,
      name: decoded.name ?? null,
      role: "admin",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { uid: decoded.uid, email, agencyId, role: "admin" };
}
