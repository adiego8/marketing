import { NextResponse } from "next/server";
import {
  replaceDropped,
  NothingToReplaceError,
  PlanCommittedError,
  ReplaceFailedError,
} from "@/lib/marketing/planner/replace";
import { parseSlotIds } from "@/lib/marketing/planner/drop";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// One model call covering every dropped slot at once, so this is closer to a
// preview than to a single-slot regenerate.
export const maxDuration = 60;

// POST /api/v1/clients/[clientId]/plan/runs/[runId]/replace
//
// Generates a fresh idea for each dropped slot, keeping its date, time,
// channel and campaign. An empty `slotIds` means every drop still waiting for
// one. Nothing reaches the calendar — the run document is still a preview.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const slotIds = parseSlotIds(await readBody(request));
    const result = await replaceDropped(clientId, runId, slotIds);
    if (!result) return jsonError("Plan run not found", 404);

    return NextResponse.json({
      ...result.run,
      replaced: result.replaced,
      drop_warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof PlanCommittedError) return jsonError(error.message, 409);
    if (error instanceof NothingToReplaceError) return jsonError(error.message, 400);
    // The drops are untouched, so this is retryable and says so.
    if (error instanceof ReplaceFailedError) return jsonError(error.message, 502);
    return serverError("Replace dropped slots error", error);
  }
}
