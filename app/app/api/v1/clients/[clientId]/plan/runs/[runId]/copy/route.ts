import { NextResponse } from "next/server";
import {
  writeProposedCopy,
  ProposedSlotNotFoundError,
} from "@/lib/marketing/planner/copy-run";
import { PlanCommittedError } from "@/lib/marketing/planner/replace";
import { WriteCopyFailedError } from "@/lib/marketing/write-copy";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// One model call, and the longest output in the app. 300 rather than the
// planner's usual 60 for the same reason the post-commit copy route uses it: a
// carousel can run past the client-side OpenAI timeout, which has a retry
// behind it.
export const maxDuration = 300;

// POST /api/v1/clients/[clientId]/plan/runs/[runId]/copy
//
// Writes the publishable copy for one proposed piece, before the plan is
// accepted — so the words can be read and judged alongside the brief rather
// than after committing to them. The copy travels through commit with the
// piece, so accepting costs nothing extra.
//
// Returns the whole run, like every other edit to a preview, so the page
// replaces its state rather than patching one entry.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const slotId = typeof body.slotId === "string" ? body.slotId.trim() : "";
    if (!slotId) return jsonError("slotId is required.", 400);

    // Cap, never reject — the house line from the post-commit copy route.
    const steer = typeof body.steer === "string" ? body.steer.slice(0, 500) : undefined;

    const run = await writeProposedCopy(clientId, runId, slotId, { steer });
    if (!run) return jsonError("Plan run not found", 404);

    return NextResponse.json(run);
  } catch (error) {
    if (error instanceof PlanCommittedError) return jsonError(error.message, 409);
    if (error instanceof ProposedSlotNotFoundError) return jsonError(error.message, 404);
    // The request was fine, the model was not. The run is untouched, so this is
    // safe to retry.
    if (error instanceof WriteCopyFailedError) return jsonError(error.message, 502);
    return serverError("Write proposed copy error", error);
  }
}
