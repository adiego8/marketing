import { NextResponse } from "next/server";
import {
  previewPlan,
  NoStrategyError,
  CampaignNotFoundError,
  CampaignNotActiveError,
} from "@/lib/marketing/planner/run";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

// One LLM call for the campaign's outstanding pieces — decide only splits the
// request above 40 gaps — plus a handful of Firestore reads.
export const maxDuration = 120;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/plan/preview
//
// Writes every piece ONE campaign still owes, and stores it as a plan-run
// document. `campaign_id` is required: a run belongs to a campaign, and what
// the campaign page shows is what its commit will write.
//
// There is no horizon to choose, because the demand is the campaign's and
// nothing here places a date.
//
// Writes NO slots — that is the commit step. Safe to call repeatedly.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const campaignId =
      typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
    if (!campaignId) {
      return jsonError("campaign_id is required — a plan is written for one campaign.", 400);
    }

    const run = await previewPlan(clientId, {
      timezone: String(ctx.client.data.timezone || "UTC"),
      campaignId,
    });
    return NextResponse.json(run);
  } catch (error) {
    // Another client's campaign reads as missing, matching getCampaign.
    if (error instanceof CampaignNotFoundError) {
      return jsonError(error.message, 404);
    }
    // Preconditions the user can act on, rather than a 500 they cannot.
    if (error instanceof NoStrategyError || error instanceof CampaignNotActiveError) {
      return jsonError(error.message, 400);
    }
    return serverError("Plan preview error", error);
  }
}
