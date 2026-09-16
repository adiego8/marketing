import { NextResponse } from "next/server";
import { getSlot } from "@/lib/marketing/slots";
import { projectSlot, slotWarnings } from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyError,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

type Params = { params: Promise<{ slotId: string }> };

// GET /api/agent/v1/schedule/[slotId]
//
// One piece, for re-reading immediately before publishing — a queued job may
// have been holding its copy for hours, and the brief can have moved since.
//
// Unlike the list, this serves a piece whatever its state: the caller already
// has the id, and `publishable` plus `copy.state` say whether to act on it.
// Hiding it would leave an agent unable to find out why its piece vanished.
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey("schedule:read");
    if ("response" in ctx) return ctx.response;

    const { slotId } = await params;
    // getSlot checks the slot belongs to this client, so a key for one client
    // cannot read another's piece by guessing an id — it reads as missing.
    const slot = await getSlot(ctx.key.clientId, slotId);
    if (!slot) {
      return keyError("not_found", "No such piece.", 404);
    }

    return NextResponse.json({
      ...projectSlot(slot),
      // Computed at read time, never stored: "the caption is 240 characters
      // over Instagram's limit" is worth knowing before you try to post it.
      warnings: slotWarnings(slot),
    });
  } catch (error) {
    return keyServerError("Agent slot error", error);
  }
}
