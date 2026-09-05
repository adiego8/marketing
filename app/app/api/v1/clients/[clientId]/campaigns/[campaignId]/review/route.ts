import { NextResponse } from "next/server";
import { Timestamp } from "@/lib/firestore";
import { getCampaign, appendFeedback } from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

// POST .../review — records feedback without calling the LLM.
// The entry shape ({feedback, submitted_at}) differs from the one improve
// writes; the history array is heterogeneous by design.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    const body = (await readBody(request)) as Record<string, unknown>;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) return jsonError("Comment is required.", 400);

    const updated = await appendFeedback(
      campaignId,
      { feedback: comment, submitted_at: Timestamp.now().toDate().toISOString() },
      { status: "in_review" }
    );
    return NextResponse.json(updated);
  } catch (error) {
    return serverError("Review campaign error", error);
  }
}
