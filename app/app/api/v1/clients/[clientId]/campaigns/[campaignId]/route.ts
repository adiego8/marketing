import { NextResponse } from "next/server";
import {
  getCampaign,
  updateCampaign,
  deleteCampaign,
  parseCampaignPatch,
} from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

// GET /api/v1/clients/[clientId]/campaigns/[campaignId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    return NextResponse.json(campaign);
  } catch (error) {
    return serverError("Get campaign error", error);
  }
}

// PATCH /api/v1/clients/[clientId]/campaigns/[campaignId]
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    const parsed = parseCampaignPatch(await readBody(request));
    if ("error" in parsed) return jsonError(parsed.error, 400);

    return NextResponse.json(await updateCampaign(campaignId, parsed.data));
  } catch (error) {
    return serverError("Update campaign error", error);
  }
}

// DELETE /api/v1/clients/[clientId]/campaigns/[campaignId]
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    await deleteCampaign(campaignId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return serverError("Delete campaign error", error);
  }
}
