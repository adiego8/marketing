import { NextResponse } from "next/server";
import { getCampaign, updateCampaign } from "@/lib/marketing/campaigns";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

// POST .../complete — terminal state; the planner stops drawing from it.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    return NextResponse.json(await updateCampaign(campaignId, { status: "completed" }));
  } catch (error) {
    return serverError("Complete campaign error", error);
  }
}
