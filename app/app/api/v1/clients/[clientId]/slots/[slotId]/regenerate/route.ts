import { NextResponse } from "next/server";
import {
  regenerateSlot,
  RegenerateFailedError,
  SlotNotFoundError,
  type RegenerateMode,
} from "@/lib/marketing/planner/regenerate";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

// One model call.
export const maxDuration = 60;

const MODES: RegenerateMode[] = ["angle", "rewrite"];

// POST /api/v1/clients/[clientId]/slots/[slotId]/regenerate
//
// Rewrites one slot's content. Date, time, channel and format are fixed and
// never reach the model as anything but context.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const mode = body.mode;
    if (typeof mode !== "string" || !MODES.includes(mode as RegenerateMode)) {
      return jsonError(`mode must be one of: ${MODES.join(", ")}`, 400);
    }
    const steer = typeof body.steer === "string" ? body.steer.slice(0, 500) : undefined;

    const slot = await regenerateSlot(clientId, slotId, {
      mode: mode as RegenerateMode,
      steer,
    });
    return NextResponse.json(slot);
  } catch (error) {
    if (error instanceof SlotNotFoundError) {
      return jsonError("Slot not found", 404);
    }
    // 502: the request was fine, the model was not. The slot is untouched, so
    // this is safe to retry.
    if (error instanceof RegenerateFailedError) {
      return jsonError(error.message, 502);
    }
    return serverError("Regenerate slot error", error);
  }
}
