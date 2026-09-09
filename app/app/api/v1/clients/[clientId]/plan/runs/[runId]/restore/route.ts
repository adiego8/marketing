import { NextResponse } from "next/server";
import { getPlanRun, updatePlanRunSlots } from "@/lib/marketing/planner/plan-runs";
import { applyRestores, parseSlotIds } from "@/lib/marketing/planner/drop";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// POST /api/v1/clients/[clientId]/plan/runs/[runId]/restore
//
// Undo for a drop. Refused once the slot has been replaced — the replacement
// carries the same deterministic id, so both in one commit batch would fail
// the whole write. applyRestores reports that per slot rather than erroring,
// so restoring three where one is unrestorable still restores the other two.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const slotIds = parseSlotIds(await readBody(request));
    if (slotIds.length === 0) return jsonError("No slots given to restore.", 400);

    const run = await getPlanRun(clientId, runId);
    if (!run) return jsonError("Plan run not found", 404);
    if (run.committed_at) {
      return jsonError("This plan is already committed.", 409);
    }

    const result = applyRestores(run.proposed_slots, run.dropped_slots, slotIds);

    const updated = await updatePlanRunSlots(clientId, runId, {
      proposedSlots: result.proposed,
      droppedSlots: result.dropped,
    });
    if (!updated) return jsonError("Plan run not found", 404);

    return NextResponse.json({ ...updated, drop_warnings: result.warnings });
  } catch (error) {
    return serverError("Restore plan slot error", error);
  }
}
