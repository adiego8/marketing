import { NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@/lib/marketing/api-keys-store";
import { parseScopes } from "@/lib/marketing/api-keys";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

const MAX_NAME_CHARS = 80;

// GET /api/v1/clients/[clientId]/api-keys
//
// Session-authed, deliberately. Minting and revoking keys is never reachable
// from the agent rail — a key must not be able to issue itself a better one.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    return NextResponse.json(await listApiKeys(clientId));
  } catch (error) {
    return serverError("List API keys error", error);
  }
}

// POST /api/v1/clients/[clientId]/api-keys
//
// Returns the key itself, exactly once. It is never stored and cannot be shown
// again — only its sha256, which is the document id.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
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

    const { key, secret } = await createApiKey(clientId, ctx.session.agencyId, {
      name,
      scopes,
      createdBy: ctx.session.email ?? ctx.session.uid,
      expiresAt,
    });

    // `secret` appears in this response and nowhere else, ever.
    return NextResponse.json({ ...key, secret }, { status: 201 });
  } catch (error) {
    return serverError("Create API key error", error);
  }
}
