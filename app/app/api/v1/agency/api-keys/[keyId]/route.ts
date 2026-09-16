import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/marketing/api-keys-store";
import {
  requireSession,
  jsonError,
  serverError,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ keyId: string }> };

// DELETE /api/v1/agency/api-keys/[keyId]
//
// Revokes rather than deletes, for the same reason as the per-client route: a
// deleted key makes a leaked one indistinguishable from one that never existed.
//
// No client is passed, so this can revoke any key in the agency — which is the
// point of an agency-level screen, and why the client-scoped route passes one.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { keyId } = await params;
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    const revoked = await revokeApiKey(ctx.session.agencyId, keyId);
    if (!revoked) return jsonError("Key not found", 404);

    return NextResponse.json(revoked);
  } catch (error) {
    return serverError("Revoke agency API key error", error);
  }
}
