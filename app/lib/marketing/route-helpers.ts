import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getSession,
  getClientForSession,
  isAgencyOwner,
  isAuthConfigured,
  authNotConfigured,
  type Session,
} from "../auth";
import { db, COLLECTIONS } from "../firestore";

// Shared plumbing for the /api/v1 handlers. Response shapes follow the house
// convention: { resource } for reads, { error } for failures.

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function serverError(context: string, error: unknown) {
  console.error(`${context}:`, error);
  const message =
    error instanceof Error && error.message.includes("not configured")
      ? error.message // surface misconfig rather than hiding it as "internal"
      : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Resolve the caller's session, or an error response to return as-is. */
export async function requireSession(): Promise<
  { session: Session } | { response: NextResponse }
> {
  // Answered before the 401 so a server with no credentials reports its own
  // misconfiguration instead of blaming the caller's token.
  if (!isAuthConfigured()) {
    return { response: jsonError(authNotConfigured(), 503) };
  }

  const headersList = await headers();
  const session = await getSession(headersList.get("authorization"));
  if (!session) return { response: jsonError("Unauthorized", 401) };
  return { session };
}

/**
 * Resolve the session AND require that the caller owns their agency.
 *
 * The gate on install-wide settings. `role === "admin"` would be the obvious
 * choice and is the wrong one: resolveGrant hands every paying customer admin
 * of their own agency, so an admin check means "any customer" rather than
 * "whoever runs this install".
 *
 * Costs one document read, and only on the routes that need it — which is why
 * this is not a field on Session. /auth/me already fetches the same agency
 * document for its existence check, so the flag the UI renders from is free.
 *
 * 403 rather than 404: the caller is authenticated and the route exists, and
 * pretending otherwise would mean someone debugging a permissions problem sees
 * the same thing as a typo.
 */
export async function requireOwner(): Promise<
  { session: Session } | { response: NextResponse }
> {
  const auth = await requireSession();
  if ("response" in auth) return auth;

  const snap = await db().collection(COLLECTIONS.agencies).doc(auth.session.agencyId).get();
  if (!isAgencyOwner(snap.data(), auth.session.uid)) {
    // Named rather than generic, because the recoverable case is invisible
    // otherwise: an agency created by a teammate first has no ownerUid until
    // the owner signs in again, and ensureMember backfills it when they do.
    return {
      response: jsonError(
        "Only the owner of this agency can change these settings. If you are the owner, sign out and back in once — the account that created the agency is recorded on first sign-in.",
        403
      ),
    };
  }
  return auth;
}

/**
 * Resolve the session AND confirm the client belongs to the caller's agency.
 * A client that is missing, archived, or owned by another agency all read as
 * 404, so callers cannot probe for other agencies' data.
 */
export async function requireClient(
  clientId: string
): Promise<
  | { session: Session; client: { id: string; data: FirebaseFirestore.DocumentData } }
  | { response: NextResponse }
> {
  const auth = await requireSession();
  if ("response" in auth) return auth;

  const client = await getClientForSession(auth.session, clientId);
  if (!client) return { response: jsonError("Client not found", 404) };

  return { session: auth.session, client };
}

/** Parse a JSON body, tolerating an empty one (action endpoints take no body). */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
