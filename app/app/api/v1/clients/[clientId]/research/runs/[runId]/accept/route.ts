import { NextResponse } from "next/server";
import { getResearchRun, markResearchAccepted } from "@/lib/marketing/research/runs";
import { parseStrategyInput, upsertStrategy } from "@/lib/marketing/strategy";
import { requireClient, jsonError, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; runId: string }> };

// POST /api/v1/clients/[clientId]/research/runs/[runId]/accept
//
// Writes the run's draft into the strategy. This is the only place research
// touches the strategy document, and it goes through parseStrategyInput and
// upsertStrategy like any other edit — so the draft is validated on the way in
// exactly as a hand-typed one would be, and one code path owns the write.
//
// The accepted stamp is claimed in a transaction BEFORE the write. Two clicks
// on Accept would otherwise both pass the check and both overwrite.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId, runId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const run = await getResearchRun(clientId, runId);
    if (!run) return jsonError("Research run not found", 404);

    if (run.accepted_at) {
      return jsonError("This research has already been accepted into the strategy.", 409);
    }
    if (run.status === "insufficient") {
      return jsonError(
        "This run found nothing to work from, so there is no draft to accept. Add a website to the client and run it again.",
        409
      );
    }

    const parsed = parseStrategyInput(run.draft_strategy, true);
    if ("error" in parsed) return jsonError(parsed.error, 400);

    if (!(await markResearchAccepted(runId))) {
      return jsonError("This research has already been accepted into the strategy.", 409);
    }

    const strategy = await upsertStrategy(clientId, parsed.data);
    return NextResponse.json({ strategy, run: await getResearchRun(clientId, runId) });
  } catch (error) {
    return serverError("Research accept error", error);
  }
}
