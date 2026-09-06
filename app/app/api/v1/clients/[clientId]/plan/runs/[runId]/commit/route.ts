import { NextResponse } from "next/server";
import {
  commitPlan,
  NothingToCommitError,
  PlanAlreadyCommittedError,
  StalePlanError,
} from "@/lib/marketing/planner/commit";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// POST /api/v1/clients/[clientId]/plan/runs/[runId]/commit
//
// Writes the run's proposed slots to marketing_slots. This is the only endpoint
// in the planner that creates calendar state; preview writes nothing.
//
// No LLM call, so this is fast — but it is the one planner write that must not
// half-succeed, hence the atomic batch inside commitPlan.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const run = await commitPlan(clientId, runId);
    if (!run) return jsonError("Plan run not found", 404);

    return NextResponse.json(run);
  } catch (error) {
    // 409: the request was well formed, the state says no. Each of these is
    // something the user resolves themselves, not a failure to report.
    if (
      error instanceof PlanAlreadyCommittedError ||
      error instanceof StalePlanError ||
      error instanceof NothingToCommitError
    ) {
      return jsonError(error.message, 409);
    }
    return serverError("Plan commit error", error);
  }
}
