import { NextResponse } from "next/server";
import {
  previewPlan,
  NoStrategyError,
  CampaignNotFoundError,
  CampaignNotActiveError,
} from "@/lib/marketing/planner/run";
import {
  commitPlan,
  NothingToCommitError,
  StalePlanError,
} from "@/lib/marketing/planner/commit";
import { deletePlanRun } from "@/lib/marketing/planner/plan-runs";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

// One LLM call for the campaign's outstanding pieces — decide only splits the
// request above 40 gaps — then the commit batch, which makes no model call.
// 120 for the first plus room for the second.
export const maxDuration = 180;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/plan/generate
//
// Writes every piece one campaign still owes, and creates them for real —
// undated, status "planned". `campaign_id` is required: a run belongs to a
// campaign, and what it writes is that campaign's content and nothing else.
//
// This replaced a two-step preview-then-accept. Generating something the
// operator then had to accept meant the pieces did not exist while they were
// being reviewed, so nothing could be opened, edited, or given copy until after
// a decision had already been made about it. Creating them immediately is what
// lets a piece be read on its own page at every step.
//
// Rejecting a piece is now cancel-and-regenerate, which the quota model already
// supported: countsAgainstQuota excludes "cancelled", so the gap reopens and
// the next generate refills it, while loadRecentThemes still sees the cancelled
// theme and keeps the model off the angle that was just rejected.
//
// There is no horizon to choose: the demand is the campaign's, and nothing here
// places a date. Days are chosen afterwards, by a person.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const campaignId =
      typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
    if (!campaignId) {
      return jsonError("campaign_id is required — content is written for one campaign.", 400);
    }

    const run = await previewPlan(clientId, {
      timezone: String(ctx.client.data.timezone || "UTC"),
      campaignId,
    });

    // A run that proposed nothing is a real answer — the campaign owes nothing
    // — and commitPlan would refuse it. Return it so the page can say so.
    if (run.proposed_slots.length === 0) return NextResponse.json(run);

    try {
      const committed = await commitPlan(clientId, run.id);
      // commitPlan returns null only when the run is missing, which cannot
      // happen for one written a moment ago in this same request.
      return NextResponse.json(committed ?? run);
    } catch (error) {
      // The run exists but holds nothing anyone can act on: there is no preview
      // in this UI any more, so leaving it would strand a document that shows
      // up in the run history as a plan that was never anything. The commit
      // batch is atomic, so no slots were created and nothing is orphaned.
      await deletePlanRun(clientId, run.id, ctx.session.agencyId).catch(() => {});
      throw error;
    }
  } catch (error) {
    // Another client's campaign reads as missing, matching getCampaign.
    if (error instanceof CampaignNotFoundError) {
      return jsonError(error.message, 404);
    }
    // Preconditions the user can act on, rather than a 500 they cannot.
    if (error instanceof NoStrategyError || error instanceof CampaignNotActiveError) {
      return jsonError(error.message, 400);
    }
    // StalePlanError here means a concurrent generate committed first and moved
    // the inputs underneath this one. The guard cannot fire within a single
    // request, and that it can fire across two is the point: without it both
    // would write the same pieces twice.
    if (error instanceof StalePlanError || error instanceof NothingToCommitError) {
      return jsonError(error.message, 409);
    }
    return serverError("Plan generate error", error);
  }
}
