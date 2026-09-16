import { NextResponse } from "next/server";
import { listPlanRuns } from "@/lib/marketing/planner/plan-runs";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/plan/runs?limit=&campaign_id=
//
// campaign_id is optional here, unlike on preview: the client overview lists
// every run deliberately. The campaign workspace always passes one.
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 50);
    const campaignId = searchParams.get("campaign_id") || undefined;
    return NextResponse.json(await listPlanRuns(clientId, limit, campaignId));
  } catch (error) {
    return serverError("List plan runs error", error);
  }
}
