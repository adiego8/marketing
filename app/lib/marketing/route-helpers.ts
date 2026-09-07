import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getSession,
  getClientForSession,
  isAuthConfigured,
  AUTH_NOT_CONFIGURED,
  type Session,
} from "../auth";

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
    return { response: jsonError(AUTH_NOT_CONFIGURED, 503) };
  }

  const headersList = await headers();
  const session = await getSession(headersList.get("authorization"));
  if (!session) return { response: jsonError("Unauthorized", 401) };
  return { session };
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
