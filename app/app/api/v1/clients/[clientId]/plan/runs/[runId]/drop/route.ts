import { NextResponse } from "next/server";
import { getPlanRun, updatePlanRunSlots } from "@/lib/marketing/planner/plan-runs";
import { applyDrops, parseDrops } from "@/lib/marketing/planner/drop";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// POST /api/v1/clients/[clientId]/plan/runs/[runId]/drop
//
// Takes an idea out of the preview so it is not committed, with an optional
// reason that later steers its replacement. Idempotent: dropping something
// already dropped edits its reason, which is what lets the page save the
// reason box on blur without a second endpoint.
//
// No model call and no calendar write — this only rewrites the run document.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const drops = parseDrops(await readBody(request));
    if (drops.length === 0) return jsonError("No slots given to drop.", 400);

    const run = await getPlanRun(clientId, runId);
    if (!run) return jsonError("Plan run not found", 404);
    if (run.committed_at) {
      return jsonError(
        "This plan is already committed. Cancel the slot from the Schedule page instead.",
        409
      );
    }

    const result = applyDrops(
      run.proposed_slots,
      run.dropped_slots,
      drops,
      new Date().toISOString()
    );

    const updated = await updatePlanRunSlots(clientId, runId, {
      proposedSlots: result.proposed,
      droppedSlots: result.dropped,
    });
    if (!updated) return jsonError("Plan run not found", 404);

    return NextResponse.json({ ...updated, drop_warnings: result.warnings });
  } catch (error) {
    return serverError("Drop plan slot error", error);
  }
}
