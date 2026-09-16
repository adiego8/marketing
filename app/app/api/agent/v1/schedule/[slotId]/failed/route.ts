import { NextResponse } from "next/server";
import { markSlotFailed } from "@/lib/marketing/slots";
import { parseFailedBody } from "@/lib/marketing/agent/publish";
import { projectSlot } from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyError,
  keyServerError,
  readAgentBody,
} from "@/lib/marketing/agent/route-helpers";

type Params = { params: Promise<{ slotId: string }> };

// POST /api/agent/v1/schedule/[slotId]/failed
//
// The agent tried and could not. Records why, so a human sees a piece that did
// not go out rather than one stuck on "confirmed" with no explanation.
//
// The status deliberately does not move: cancelled and skipped free the slot's
// quota, so demoting a failure would have the next plan run propose a
// replacement for a piece still sitting there waiting to be retried.
//
// Body: { reason }
export async function POST(request: Request, { params }: Params) {
  try {
    const body = await readAgentBody(request);
    const ctx = await requireApiKey(
      "schedule:publish",
      typeof body.client_id === "string" ? body.client_id : null
    );
    if ("response" in ctx) return ctx.response;

    const { slotId } = await params;
    const parsed = parseFailedBody(body);
    if ("error" in parsed) {
      return keyError("invalid_body", parsed.error, 400);
    }

    const slot = await markSlotFailed(
      ctx.client.id,
      slotId,
      parsed.value,
      ctx.key.prefix
    );
    if (!slot) {
      return keyError("not_found", "No such piece.", 404);
    }

    return NextResponse.json(projectSlot(slot));
  } catch (error) {
    return keyServerError("Agent publish failure error", error);
  }
}
