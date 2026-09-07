import { NextResponse } from "next/server";
import { serializeClient } from "@/lib/firestore";
import {
  updateClient,
  archiveClient,
  parseClientPatch,
} from "@/lib/marketing/clients";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    return NextResponse.json(serializeClient(ctx.client.id, ctx.client.data));
  } catch (error) {
    return serverError("Get client error", error);
  }
}

// PATCH /api/v1/clients/[clientId]
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const parsed = parseClientPatch(await readBody(request));
    if ("error" in parsed) return jsonError(parsed.error, 400);

    return NextResponse.json(await updateClient(clientId, parsed.data));
  } catch (error) {
    return serverError("Update client error", error);
  }
}

// DELETE /api/v1/clients/[clientId] — soft archive, not a cascade delete.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    await archiveClient(clientId);
    return NextResponse.json({ archived: true });
  } catch (error) {
    return serverError("Archive client error", error);
  }
}
