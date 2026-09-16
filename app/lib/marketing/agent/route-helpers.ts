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
 * Resolve the calling key and the client it speaks for.
 *
 * Mirrors requireSession's discriminated union so handlers keep the house
 * shape — `if ("response" in ctx) return ctx.response;` as the first statement
 * — while sharing none of its code.
 *
 * Every refusal before the scope check answers 401 with the same message.
 * Telling an unauthorized caller that its key is merely expired, or that it
 * exists but is revoked, is more than it needs and more than we should say.
 */
export async function requireApiKey(
  scope: ApiKeyScope
): Promise<KeyContext | { response: NextResponse }> {
  const headersList = await headers();
  const secret = keyFromHeader(headersList.get("authorization"));
  if (!secret) {
    return { response: unauthorized() };
  }

  const key = await findApiKey(secret);
  if (!key) {
    return { response: unauthorized() };
  }

  if (!hasScope(key, scope)) {
    return {
      response: keyError(
        "scope_missing",
        `This key does not carry the ${scope} scope.`,
        403
      ),
    };
  }

  const client = await loadClient(key);
  if (!client) {
    return {
      response: keyError(
        "not_found",
        "The client this key was issued for is no longer available.",
        404
      ),
    };
  }

  // Awaited rather than fired off: a serverless function can freeze the moment
  // it responds. It is throttled to once an hour and never throws, so the cost
  // is a rounding error and the failure mode is a stale timestamp.
  await touchApiKey(key);

  return { key, client };
}

function unauthorized() {
  return keyError("invalid_key", "That API key is not valid.", 401);
}

/**
 * The client a key speaks for.
 *
 * The agency comparison is redundant today — the key names one client, and the
 * key was minted against that client's agency. It is here because a key
 * document outlives the client record it points at: if a client is ever moved
 * between agencies, or an id is reused, this fails closed instead of handing
 * one agency's key another agency's content.
 */
async function loadClient(
  key: StoredKey
): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const snap = await db().collection(COLLECTIONS.clients).doc(key.clientId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  if (data.agencyId !== key.agencyId) return null;
  if (data.status === "archived") return null;
  return { id: snap.id, data };
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
