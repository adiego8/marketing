import { NextResponse } from "next/server";
import { listSlots } from "@/lib/marketing/slots";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/slots?start=&end=&status=
//
// Committed slots. Everything the planner produced and a human accepted lives
// here; the plan run itself only holds the proposal it was accepted from.
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const url = new URL(request.url);
    const slots = await listSlots(clientId, {
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return NextResponse.json(slots);
  } catch (error) {
    return serverError("List slots error", error);
  }
}
