import { NextResponse } from "next/server";
import {
  listCampaigns,
  createCampaign,
  parseCampaignCreate,
} from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/campaigns?status=
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const { searchParams } = new URL(request.url);
    const campaigns = await listCampaigns(
      clientId,
      searchParams.get("status") || undefined
    );
    return NextResponse.json(campaigns);
  } catch (error) {
    return serverError("List campaigns error", error);
  }
}

// POST /api/v1/clients/[clientId]/campaigns — a hand-created campaign ("idea").
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const parsed = parseCampaignCreate(await readBody(request));
    if ("error" in parsed) return jsonError(parsed.error, 400);

    return NextResponse.json(await createCampaign(clientId, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return serverError("Create campaign error", error);
  }
}
