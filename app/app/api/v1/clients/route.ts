import { NextResponse } from "next/server";
import {
  listClients,
  createClient,
  parseClientCreate,
} from "@/lib/marketing/clients";
import {
  requireSession,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

// GET /api/v1/clients?status=&search=
export async function GET(request: Request) {
  try {
    const auth = await requireSession();
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const clients = await listClients(auth.session, {
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search") || undefined,
    });

    // The client layer expects a bare array here (lib/api.ts listClients).
    return NextResponse.json(clients);
  } catch (error) {
    return serverError("List clients error", error);
  }
}

// POST /api/v1/clients
export async function POST(request: Request) {
  try {
    const auth = await requireSession();
    if ("response" in auth) return auth.response;

    const parsed = parseClientCreate(await readBody(request));
    if ("error" in parsed) return jsonError(parsed.error, 400);

    // The dashboard redirects to /clients/{id} on success, so the response must
    // carry the id.
    const client = await createClient(auth.session, parsed.data);
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    return serverError("Create client error", error);
  }
}
