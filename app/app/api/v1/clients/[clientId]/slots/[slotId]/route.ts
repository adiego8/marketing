import { NextResponse } from "next/server";
import {
  isSlotStatus,
  updateSlot,
  setEventLock,
  type SlotPatch,
} from "@/lib/marketing/slots";
import {
  SLOT_STATUSES,
  MAX_THEME_CHARS,
  MAX_BRIEF_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_HOOK_CHARS,
  MAX_CTA_CHARS,
  MAX_BODY_ITEMS,
  MAX_BODY_ITEM_CHARS,
} from "@/lib/marketing/planner/types";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

// The same caps the model is held to, so a hand edit cannot produce a slot the
// planner could not have produced.
const TEXT_LIMITS: Record<string, number> = {
  theme: MAX_THEME_CHARS,
  brief: MAX_BRIEF_CHARS,
  rationale: MAX_RATIONALE_CHARS,
  hook: MAX_HOOK_CHARS,
  cta: MAX_CTA_CHARS,
};

// PATCH /api/v1/clients/[clientId]/slots/[slotId]
//
// Status, pinning, and the piece itself. Scheduling — date, time, channel,
// format — stays the planner's; see updateSlot for why.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;

    // Taking an event's text back from Google. Its own write, not a SlotPatch
    // field: it clears the lock AND marks the slot stale so the next sync
    // actually pushes the app's text over the hand-edited event. Handled first
    // and alone, because pairing it with a content edit would push the two
    // writes into an order that is not worth reasoning about.
    if ("google_event_locked" in body) {
      if (typeof body.google_event_locked !== "boolean") {
        return jsonError("google_event_locked must be a boolean", 400);
      }
      const unlocked = await setEventLock(clientId, slotId, body.google_event_locked);
      if (!unlocked) return jsonError("Slot not found", 404);
      return NextResponse.json(unlocked);
    }

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
    for (const [key, max] of Object.entries(TEXT_LIMITS)) {
      if (!(key in body)) continue;
      const value = body[key];
      if (typeof value !== "string") {
        return jsonError(`${key} must be a string`, 400);
      }
      if (value.length > max) {
        return jsonError(`${key} must be at most ${max} characters`, 400);
      }
      (patch as Record<string, unknown>)[key] = value;
    }

    if ("body" in body) {
      if (!Array.isArray(body.body) || body.body.some((x) => typeof x !== "string")) {
        return jsonError("body must be an array of strings", 400);
      }
      if (body.body.length > MAX_BODY_ITEMS) {
        return jsonError(`body must have at most ${MAX_BODY_ITEMS} entries`, 400);
      }
      if ((body.body as string[]).some((x) => x.length > MAX_BODY_ITEM_CHARS)) {
        return jsonError(
          `each body entry must be at most ${MAX_BODY_ITEM_CHARS} characters`,
          400
        );
      }
      patch.body = (body.body as string[]).map((x) => x.trim()).filter(Boolean);
    }

    if (Object.keys(patch).length === 0) {
      return jsonError(
        "Nothing to update. Send status, pinned, or any of theme, brief, rationale, hook, body, cta.",
        400
      );
    }

    const slot = await updateSlot(clientId, slotId, patch);
    if (!slot) return jsonError("Slot not found", 404);

    return NextResponse.json(slot);
  } catch (error) {
    return serverError("Update slot error", error);
  }
}
