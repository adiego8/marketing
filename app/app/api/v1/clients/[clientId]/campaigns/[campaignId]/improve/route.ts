import { NextResponse } from "next/server";
import { improveCampaign } from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

// POST .../improve — rewrites the campaign from feedback via the LLM.
// Deliberately does NOT change status, matching the Python.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) return jsonError("Comment is required.", 400);

    const updated = await improveCampaign(clientId, campaignId, comment);
    if (!updated) return jsonError("Campaign not found", 404);

    return NextResponse.json(updated);
  } catch (error) {
    return serverError("Improve campaign error", error);
  }
}
