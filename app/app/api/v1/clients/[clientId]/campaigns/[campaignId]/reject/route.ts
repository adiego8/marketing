import { NextResponse } from "next/server";
import { getCampaign, updateCampaign } from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

// POST .../reject — the only transition that records a reason.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    const body = (await readBody(request)) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return jsonError("Reason is required.", 400);

    const updated = await updateCampaign(campaignId, {
      status: "rejected",
      rejectionReason: reason,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return serverError("Reject campaign error", error);
  }
}
