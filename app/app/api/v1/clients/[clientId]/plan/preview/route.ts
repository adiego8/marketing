import { NextResponse } from "next/server";
import {
  previewPlan,
  NoStrategyError,
  NoActiveCampaignsError,
} from "@/lib/marketing/planner/run";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

// One LLM call per campaign, plus a handful of Firestore reads. A preview now
// covers everything the campaigns owe rather than a two-week slice, so it is
// bigger than it was.
export const maxDuration = 120;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/plan/preview
//
// Writes every piece the active campaigns still owe, and stores it as a
// plan-run document. Takes no body: there is no horizon to choose, because the
// demand is the campaigns' and nothing here places a date.
//
// Writes NO slots — that is the commit step. Safe to call repeatedly.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const run = await previewPlan(clientId, {
      timezone: String(ctx.client.data.timezone || "UTC"),
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
