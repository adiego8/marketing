// Shared plumbing for /api/agent/v1 — the API-key rail.
//
// Deliberately a separate file from ../route-helpers.ts, and it imports nothing
// from it. Serving two auth rails through one helper is how a handler ends up
// with privileges it did not ask for: there is no Session anywhere in this
// file, so there is nothing for a key-authenticated request to inherit.
//
// The other divergence from house style is the response body. Errors here are
// { error, code } rather than { error }: a person reading the UI reads the
// sentence, but an external agent has to branch, and branching on prose breaks
// the moment the prose is improved.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, COLLECTIONS } from "../../firestore";
import { keyFromHeader, hasScope } from "../api-keys";
import { findApiKey, touchApiKey, type StoredKey } from "../api-keys-store";
import { targetClientId } from "./tenancy";
import type { ApiKeyScope } from "../../types";

export type ErrorCode =
  | "not_configured"
  | "invalid_key"
  | "scope_missing"
  | "not_found"
  | "already_published"
  | "invalid_range"
  | "invalid_body"
  | "rate_limited"
  | "server_error";

export function keyError(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export function keyServerError(context: string, error: unknown) {
  console.error(`${context}:`, error);
  // A missing Firebase credential is the server's fault and worth naming, the
  // same judgement ../route-helpers.ts makes. Everything else stays opaque.
  if (error instanceof Error && error.message.includes("not configured")) {
    return keyError("not_configured", error.message, 503);
  }
  return keyError("server_error", "Internal server error", 500);
}

export interface KeyContext {
  key: StoredKey;
  client: { id: string; data: FirebaseFirestore.DocumentData };
}

/**
 * Resolve the calling key, with no client attached.
 *
 * For the endpoints that are not about one client — listing what a key can
 * see, and anything an agency-wide key does before it has chosen one.
 *
 * Every refusal here answers 401 with the same message. Telling an
 * unauthorized caller that its key is merely expired, or that it exists but is
 * revoked, is more than it needs and more than we should say.
 */
export async function requireKey(
  scope: ApiKeyScope
): Promise<{ key: StoredKey } | { response: NextResponse }> {
  const key = await resolveKey();
  if (!key) return { response: unauthorized() };

  if (!hasScope(key, scope)) {
    return {
      response: keyError(
        "scope_missing",
        `This key does not carry the ${scope} scope.`,
        403
      ),
    };
  }

  return { key };
}

/**
 * The key on this request, with no scope check and no HTTP shape.
 *
 * MCP decides scope per tool rather than per request — one connection offers
 * several tools with different requirements — so it resolves the key once here
 * and checks `hasScope` at each call site instead.
 */
export async function resolveKey(): Promise<StoredKey | null> {
  const headersList = await headers();
  const secret = keyFromHeader(headersList.get("authorization"));
  if (!secret) return null;

  const key = await findApiKey(secret);
  if (!key) return null;

  // Awaited rather than fired off: a serverless function can freeze the moment
  // it responds. It is throttled to once an hour and never throws, so the cost
  // is a rounding error and the failure mode is a stale timestamp.
  await touchApiKey(key);
  return key;
}

/**
 * Resolve the calling key AND the client this request is about.
 *
 * Mirrors requireClient's discriminated union so handlers keep the house shape
 * — `if ("response" in ctx) return ctx.response;` as the first statement —
 * while sharing none of its code with the session rail.
 *
 * @param requestedClientId from `?client_id=` over REST, or the tool argument
 *   over MCP. Optional for a client-scoped key, required for an agency-wide one.
 */
export async function requireApiKey(
  scope: ApiKeyScope,
  requestedClientId?: string | null
): Promise<KeyContext | { response: NextResponse }> {
  const auth = await requireKey(scope);
  if ("response" in auth) return auth;

  const resolved = await resolveClient(auth.key, requestedClientId);
  if ("error" in resolved) {
    return {
      response:
        resolved.error === "needs_client"
          ? keyError("invalid_body", NEEDS_CLIENT, 400)
          : notFound(),
    };
  }

  return { key: auth.key, client: resolved.client };
}

export const NEEDS_CLIENT =
  "This key covers the whole agency, so it needs a client_id. List the clients first to find one.";

/**
 * Which client, and may this key see it — without an HTTP shape.
 *
 * Shared by the REST routes and the MCP tools so the two faces cannot drift on
 * the one decision where drifting would be a tenancy bug.
 */
export async function resolveClient(
  key: StoredKey,
  requestedClientId?: string | null
): Promise<
  | { client: { id: string; data: FirebaseFirestore.DocumentData } }
  | { error: "needs_client" | "not_found" }
> {
  const target = targetClientId(key, requestedClientId);
  if ("error" in target) return { error: target.error };

  const client = await loadClient(key, target.id);
  if (!client) return { error: "not_found" };
  return { client };
}

function unauthorized() {
  return keyError("invalid_key", "That API key is not valid.", 401);
}

/** Missing, archived, and belonging to another agency are all this. */
function notFound() {
  return keyError("not_found", "No such client.", 404);
}

/**
 * Load a client and confirm this key may see it.
 *
 * The agency comparison IS the authorisation. targetClientId decided which id
 * to load and deliberately does not authorise it — an agency-wide key may name
 * any id at all, and this is what stops it naming one from another agency.
 *
 * Missing, archived, and belonging to someone else all return null, so a caller
 * cannot tell them apart and cannot probe for ids.
 */
async function loadClient(
  key: StoredKey,
  clientId: string
): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const snap = await db().collection(COLLECTIONS.clients).doc(clientId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  if (data.agencyId !== key.agencyId) return null;
  if (data.status === "archived") return null;
  return { id: snap.id, data };
}

/** Every active client this key can reach. One for a client key, many for an agency key. */
export async function clientsForKey(
  key: StoredKey
): Promise<{ id: string; data: FirebaseFirestore.DocumentData }[]> {
  if (key.clientId) {
    const one = await loadClient(key, key.clientId);
    return one ? [one] : [];
  }

  const snap = await db()
    .collection(COLLECTIONS.clients)
    .where("agencyId", "==", key.agencyId)
    .get();

  // Sorted in memory, like every other list here: no composite index to deploy.
  return snap.docs
    .filter((doc) => doc.data()?.status !== "archived")
    .map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
    .sort((a, b) =>
      String(a.data.name ?? "").localeCompare(String(b.data.name ?? ""))
    );
}

/** Parse a JSON body, tolerating an empty one. */
export async function readAgentBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
