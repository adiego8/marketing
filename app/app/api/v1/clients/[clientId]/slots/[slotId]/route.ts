import { NextResponse } from "next/server";
import { isSlotStatus, updateSlot, type SlotPatch } from "@/lib/marketing/slots";
import { SLOT_STATUSES } from "@/lib/marketing/planner/types";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

// PATCH /api/v1/clients/[clientId]/slots/[slotId]
//
// Status and pinning only — see updateSlot for why the planner's own output
// (date, channel, theme) is not editable here.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const patch: SlotPatch = {};

    if ("status" in body) {
      // An unrecognised status would silently stop counting against quota, so
      // it is rejected rather than stored.
      if (!isSlotStatus(body.status)) {
        return jsonError(
          `status must be one of: ${SLOT_STATUSES.join(", ")}`,
          400
        );
      }
      patch.status = body.status;
    }
    if ("pinned" in body) {
      if (typeof body.pinned !== "boolean") {
        return jsonError("pinned must be a boolean", 400);
      }
      patch.pinned = body.pinned;
    }
    if (Object.keys(patch).length === 0) {
      return jsonError("Nothing to update. Send status and/or pinned.", 400);
    }

    const slot = await updateSlot(clientId, slotId, patch);
    if (!slot) return jsonError("Slot not found", 404);

    return NextResponse.json(slot);
  } catch (error) {
    return serverError("Update slot error", error);
  }
}
