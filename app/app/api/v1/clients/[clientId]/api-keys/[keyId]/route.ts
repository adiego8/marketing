import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/marketing/api-keys-store";
import {
  requireClient,
  jsonError,
  serverError,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; keyId: string }> };

// DELETE /api/v1/clients/[clientId]/api-keys/[keyId]
//
// Revokes rather than deletes. A deleted key makes a leaked one
// indistinguishable from one that never existed, and every publication this
// key reported carries its prefix — that trail should not dangle.
//
// Effective on the very next request: findApiKey refuses anything with a
// revokedAt, so there is nothing to expire or propagate.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId, keyId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    // Both the agency AND the client are checked. Passing the client is what
    // stops this client-scoped screen revoking an agency-wide key, which would
    // cut off every other client at once.
    const revoked = await revokeApiKey(ctx.session.agencyId, keyId, clientId);
    if (!revoked) return jsonError("Key not found", 404);

    return NextResponse.json(revoked);
  } catch (error) {
    return serverError("Revoke API key error", error);
  }
}
