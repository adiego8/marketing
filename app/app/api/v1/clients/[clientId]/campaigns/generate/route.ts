import { NextResponse } from "next/server";
import { generateCampaignIdeas, NoStrategyError } from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

// An LLM call plus a batched write; well inside the limit but not instant.
export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/campaigns/generate
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const count =
      typeof body.count === "number" && body.count > 0
        ? Math.min(Math.floor(body.count), 10)
        : 3;

    const campaigns = await generateCampaignIdeas(clientId, {
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      count,
    });
    return NextResponse.json(campaigns);
  } catch (error) {
    // The Python let this surface as a 500 via the global handler. It is a
    // precondition failure the user can act on, so it gets a 400.
    if (error instanceof NoStrategyError) {
      return jsonError(
        "No strategy configured for this client. Set a strategy before generating campaigns.",
        400
      );
    }
    return serverError("Generate campaigns error", error);
  }
}
