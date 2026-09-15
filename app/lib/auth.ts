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

// Whether a numerico customer's entitlements carry an ACTIVE `marketing` product
// — the paid grant that lets someone own a marketing agency and seat teammates.
function hasActiveMarketing(entitlements: unknown): boolean {
  return (
    Array.isArray(entitlements) &&
    entitlements.some((e) => e?.key === MARKETING_KEY && e?.status === "active")
  );
}

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

// Read-only lookup against numerico-website's Firestore: the id of the customer
// who OWNS the marketing subscription for this person, or null. Mirrors numerico's
// own resolveCustomerForUser order — by ownerUid first, then a lowercased email
// match so an as-yet-unlinked customer still resolves. Never writes to numericoDb.
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

  return hasActiveMarketing(snap.docs[0].data().entitlements) ? snap.docs[0].id : null;
}

// Read-only lookup: is this email seated on a paying customer's Marketing team?
// Finds a numerico customer whose `marketingSeats` contains the email AND who
// still holds an active `marketing` entitlement (a lapsed owner can't keep
// teammates in). Returns that OWNER's customer id + display name — the teammate
// joins the owner's agency. One agency per person for now: if seated on several,
// take the first and warn.
async function findSeatOwner(
  email: string | null
): Promise<{ customerId: string; name: string } | null> {
  if (!numericoDb || !email) return null;

  const snap = await numericoDb
    .collection("customers")
    .where("marketingSeats", "array-contains", email.trim().toLowerCase())
    .limit(5)
    .get();

  const active = snap.docs.filter((d) => hasActiveMarketing(d.data().entitlements));
  if (active.length === 0) return null;
  if (active.length > 1) {
    console.warn(`marketing: ${email} is seated on ${active.length} agencies; using the first.`);
  }

  const data = active[0].data();
  const name =
    (typeof data.company === "string" && data.company) ||
    (typeof data.name === "string" && data.name) ||
    (typeof data.email === "string" ? data.email.split("@")[0] : "") ||
    "Agency";
  return { customerId: active[0].id, name };
}

interface Grant {
  agencyId: string;
  role: "admin" | "member";
  numericoCustomerId: string | null;
  /** The agency owner's uid, when the person signing in IS the owner; else null. */
  agencyOwnerUid: string | null;
  agencyName: string;
}

// The single source of truth for who gets into which agency, and as what. Order
// matters: a paying owner always lands in their OWN agency as admin; otherwise a
// seated teammate joins the owner's agency as a member; otherwise numerico staff
// get an internal agency. Everyone else is refused (null).
async function resolveGrant(decoded: DecodedIdToken): Promise<Grant | null> {
  const email = decoded.email ?? null;
  const selfName = decoded.name ?? (email ? email.split("@")[0] : "Agency");

  const ownCustomerId = await findMarketingCustomerId(decoded.uid, email);
  if (ownCustomerId) {
    return {
      agencyId: `cust_${ownCustomerId}`,
      role: "admin",
      numericoCustomerId: ownCustomerId,
      agencyOwnerUid: decoded.uid,
      agencyName: selfName,
    };
  }

  const seat = await findSeatOwner(email);
  if (seat) {
    return {
      agencyId: `cust_${seat.customerId}`,
      role: "member",
      numericoCustomerId: seat.customerId,
      agencyOwnerUid: null, // the owner may not have signed in yet; backfilled later
      agencyName: seat.name,
    };
  }

  if (isStaff(decoded)) {
    return {
      agencyId: `staff_${decoded.uid}`,
      role: "admin",
      numericoCustomerId: null,
      agencyOwnerUid: decoded.uid,
      agencyName: selfName,
    };
  }

  return null;
}

// Called on every token change from the browser (sign-in and each token
// refresh). Resolves the grant from numerico's entitlement/seat rail and
// materialises it into a member record: owners and staff are admins of their own
// agency; seated teammates are members of the OWNER's agency. Losing the grant
// (entitlement lapsed, seat removed, or owner cascade) deletes the member record,
// so getSession denies from the next request on. Returns null → the route 403s.
export async function ensureMember(decoded: DecodedIdToken): Promise<Session | null> {
  const memberRef = db().collection(COLLECTIONS.members).doc(decoded.uid);
  const email = decoded.email ?? null;

  const grant = await resolveGrant(decoded);

  if (!grant) {
    // Revoke — delete() is a no-op when the doc doesn't already exist.
    await memberRef.delete();
    return null;
  }

  // Provision (or refresh) the tenant. Deterministic agency ids keep repeated
  // sign-ins idempotent; a teammate always lands in the OWNER's agency, never a
  // new one. Agency (created only if absent) and member are written together.
  const agencyRef = db().collection(COLLECTIONS.agencies).doc(grant.agencyId);

  await db().runTransaction(async (tx) => {
    const [agencySnap, memberSnap] = await tx.getAll(agencyRef, memberRef);

    if (!agencySnap.exists) {
      tx.set(agencyRef, {
        name: grant.agencyName,
        numericoCustomerId: grant.numericoCustomerId,
        ownerUid: grant.agencyOwnerUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (grant.agencyOwnerUid && !agencySnap.data()?.ownerUid) {
      // Backfill the owner's uid if a teammate created the agency first.
      tx.update(agencyRef, { ownerUid: grant.agencyOwnerUid });
    }

    if (!memberSnap.exists) {
      tx.set(memberRef, {
        agencyId: grant.agencyId,
        email,
        name: decoded.name ?? null,
        role: grant.role,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Keep denormalised fields fresh (email display, role/agency changes).
      const data = memberSnap.data() ?? {};
      const patch: Record<string, unknown> = {};
      if (email && data.email !== email) patch.email = email;
      if (data.role !== grant.role) patch.role = grant.role;
      if (data.agencyId !== grant.agencyId) patch.agencyId = grant.agencyId;
      if (Object.keys(patch).length > 0) tx.update(memberRef, patch);
    }
  });

  return { uid: decoded.uid, email, agencyId: grant.agencyId, role: grant.role };
}
