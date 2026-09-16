import { NextResponse } from "next/server";
import { createApiKey, listAgencyKeys } from "@/lib/marketing/api-keys-store";
import { parseScopes } from "@/lib/marketing/api-keys";
import {
  requireSession,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

const MAX_NAME_CHARS = 80;

// GET /api/v1/agency/api-keys
//
// Agency-wide keys — the ones that reach every client rather than one. Agency
// scoped rather than client scoped, so this sits outside /clients/[clientId].
export async function GET() {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    return NextResponse.json(await listAgencyKeys(ctx.session.agencyId));
  } catch (error) {
    return serverError("List agency API keys error", error);
  }
}

// POST /api/v1/agency/api-keys
//
// One key that covers every client in the agency. The reason it exists: over
// MCP a person adds a connector by hand, and one per client does not scale past
// about three.
//
// Returns the key itself, exactly once — only its sha256 is stored.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonError("Give the key a name, so you know what it is for.", 400);
    if (name.length > MAX_NAME_CHARS) {
      return jsonError(`Keep the name under ${MAX_NAME_CHARS} characters.`, 400);
    }

    const scopes = parseScopes(body.scopes);
    if (scopes.length === 0) {
      return jsonError("Pick at least one thing the key may do.", 400);
    }

    let expiresAt: string | null = null;
    if (typeof body.expires_at === "string" && body.expires_at.trim()) {
      const parsed = Date.parse(body.expires_at);
      if (Number.isNaN(parsed)) return jsonError("Expiry must be a date.", 400);
      if (parsed <= Date.now()) {
        return jsonError("An expiry in the past would make the key dead on arrival.", 400);
      }
      expiresAt = new Date(parsed).toISOString();
    }

    // null clientId is what makes it agency-wide. Everything else is identical
    // to a per-client key, including how it is stored and verified.
    const { key, secret } = await createApiKey(null, ctx.session.agencyId, {
      name,
      scopes,
      createdBy: ctx.session.email ?? ctx.session.uid,
      expiresAt,
    });

    return NextResponse.json({ ...key, secret }, { status: 201 });
  } catch (error) {
    return serverError("Create agency API key error", error);
  }
}
