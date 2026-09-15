import { NextResponse } from "next/server";
import { listSignals } from "@/lib/marketing/signals";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/signals?limit=…
//
// The evidence: every piece rejected, rewritten or steered. Read-only — signals
// are written as a side effect of the actions themselves, never posted here.
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);
    return NextResponse.json(await listSignals(clientId, limit));
  } catch (error) {
    return serverError("List signals error", error);
  }
}
