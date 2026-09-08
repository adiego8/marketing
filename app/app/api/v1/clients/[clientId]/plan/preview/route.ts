import { NextResponse } from "next/server";
import {
  previewPlan,
  NoStrategyError,
  NoActiveCampaignsError,
} from "@/lib/marketing/planner/run";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

// One LLM call plus a handful of Firestore reads.
export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/plan/preview
//
// Computes a plan and stores it as a plan-run document. Writes NO slots — the
// commit step lands in Phase 3. Safe to call repeatedly.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const horizonWeeks =
      typeof body.weeks === "number" && body.weeks > 0 ? Math.floor(body.weeks) : 2;

    const run = await previewPlan(clientId, {
      timezone: String(ctx.client.data.timezone || "UTC"),
      horizonWeeks,
    });
    return NextResponse.json(run);
  } catch (error) {
    // Preconditions the user can act on, rather than a 500 they cannot.
    if (error instanceof NoStrategyError || error instanceof NoActiveCampaignsError) {
      return jsonError(error.message, 400);
    }
    return serverError("Plan preview error", error);
  }
}
