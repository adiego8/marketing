import { NextResponse } from "next/server";
import { researchClient, ResearchFailedError } from "@/lib/marketing/research/run";
import { createResearchRun, listResearchRuns } from "@/lib/marketing/research/runs";
import { requireClient, serverError, jsonError } from "@/lib/marketing/route-helpers";

// Two web searches and a synthesis. The searches are the slow part — the model
// browses several pages per pass — so this gets the same budget as slot copy,
// the other route that waits on real work rather than one quick completion.
export const maxDuration = 300;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/research
//
// Researches the company and stores the findings as a run. Writes NOTHING to
// the strategy: accepting the draft is a separate, deliberate step, because a
// strategy assembled from public sources is a proposal until a human has
// checked it with the client.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const result = await researchClient({
      name: String(ctx.client.data.name || ""),
      website_url: ctx.client.data.websiteUrl ?? null,
      description: ctx.client.data.description ?? null,
    });

    const run = await createResearchRun(clientId, result);
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    // Nothing usable came back. Storing a half-run would leave a draft nobody
    // should accept sitting in the list looking like a result.
    if (error instanceof ResearchFailedError) return jsonError(error.message, 502);
    return serverError("Research error", error);
  }
}

// GET /api/v1/clients/[clientId]/research — past runs, newest first.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    return NextResponse.json({ runs: await listResearchRuns(clientId) });
  } catch (error) {
    return serverError("Research list error", error);
  }
}
