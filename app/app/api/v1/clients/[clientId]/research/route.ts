import { NextResponse, after } from "next/server";
import { researchClient, ResearchFailedError } from "@/lib/marketing/research/run";
import {
  startResearchRun,
  updateResearchProgress,
  finishResearchRun,
  failResearchRun,
  findRunningRun,
  listResearchRuns,
} from "@/lib/marketing/research/runs";
import { parseSteer } from "@/lib/marketing/research/parse";
import {
  requireClient,
  serverError,
  jsonError,
  readBody,
} from "@/lib/marketing/route-helpers";

// The response returns in milliseconds; this budget is for the after() work,
// which the runtime caps at the route's maxDuration (see the Duration section
// of next/dist/docs/.../after.md). Two web searches and a synthesis run about
// three minutes, so this is the same ceiling slot copy uses.
export const maxDuration = 300;

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/research
//
// Opens a run, answers immediately, and does the work in after(). The browser
// holds nothing open, so closing the tab or moving to another page costs
// nothing — the run keeps going and the page picks it up again by polling.
//
// Writes NOTHING to the strategy. Accepting the draft is a separate, deliberate
// step, because a strategy assembled from public sources is a proposal until a
// human has checked it with the client.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    // One at a time. Each run is minutes of searching and a real spend, and the
    // silence is exactly when someone clicks again.
    const inFlight = await findRunningRun(clientId);
    if (inFlight) {
      return jsonError(
        "Research is already running for this client. Wait for it to finish before starting another.",
        409
      );
    }

    const steer = parseSteer(await readBody(request));
    const client = {
      name: String(ctx.client.data.name || ""),
      website_url: ctx.client.data.websiteUrl ?? null,
      description: ctx.client.data.description ?? null,
    };

    // The row exists before any model call, so there is something to show the
    // moment the button is pressed and something to find on the next visit.
    const run = await startResearchRun(clientId, {
      business_name: client.name,
      website: client.website_url,
      domain: null,
      notes: client.description,
      steer: steer.steer,
      competitors: steer.competitors,
    });

    // after() must be called inside the request scope, and it runs even when
    // the response has already gone out.
    after(async () => {
      try {
        const result = await researchClient(client, {
          steer,
          onProgress: (step) => updateResearchProgress(run.id, step),
        });
        await finishResearchRun(run.id, result);
      } catch (error) {
        const message =
          error instanceof ResearchFailedError
            ? error.message
            : `Research failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error("Research run failed:", error);
        await failResearchRun(run.id, message).catch(() => {
          // If even this write fails the row is left running, and the staleness
          // rule in listResearchRuns reports it as interrupted.
        });
      }
    });

    // 202: taken, not finished. The body is the run to start polling.
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    return serverError("Research error", error);
  }
}

// GET /api/v1/clients/[clientId]/research — past runs, newest first. Polled
// while the newest is still running.
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
