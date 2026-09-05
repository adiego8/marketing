import { NextResponse } from "next/server";
import { listPlanRuns } from "@/lib/marketing/planner/plan-runs";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/plan/runs
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 50);
    return NextResponse.json(await listPlanRuns(clientId, limit));
  } catch (error) {
    return serverError("List plan runs error", error);
  }
}
