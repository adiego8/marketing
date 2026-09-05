import { NextResponse } from "next/server";
import { getPlanRun } from "@/lib/marketing/planner/plan-runs";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// GET /api/v1/clients/[clientId]/plan/runs/[runId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const run = await getPlanRun(clientId, runId);
    if (!run) return jsonError("Plan run not found", 404);
    return NextResponse.json(run);
  } catch (error) {
    return serverError("Get plan run error", error);
  }
}
