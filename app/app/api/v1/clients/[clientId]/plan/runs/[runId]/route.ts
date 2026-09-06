import { NextResponse } from "next/server";
import { getPlanRun, deletePlanRun } from "@/lib/marketing/planner/plan-runs";
import { NotConnectedError } from "@/lib/marketing/google";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// One Google call per slot when a committed run is removed.
export const maxDuration = 60;

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

// DELETE /api/v1/clients/[clientId]/plan/runs/[runId]
//
// Removes the run and, when it was committed, the slots it created and their
// Google Calendar events. A cascade, unlike the client delete which is a
// deliberate soft archive — a plan run is a record of a decision, and undoing
// the decision means undoing what it put on the calendar.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const result = await deletePlanRun(clientId, runId, ctx.session.agencyId);
    if (!result) return jsonError("Plan run not found", 404);

    return NextResponse.json({ deleted: true, ...result });
  } catch (error) {
    // 428: there are live calendar events and no way to reach them. Deleting
    // the slots anyway would orphan what is on someone's calendar.
    if (error instanceof NotConnectedError) {
      return jsonError(
        "This plan has events on Google Calendar. Connect Google so they can be removed too.",
        428
      );
    }
    return serverError("Delete plan run error", error);
  }
}
