import { NextResponse } from "next/server";
import { writeCopy, WriteCopyFailedError } from "@/lib/marketing/write-copy";
import { SlotNotFoundError } from "@/lib/marketing/planner/regenerate";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

// One model call, and the longest output the app asks for: a carousel is a
// dozen blocks plus a caption. The client-side OpenAI timeout is 120s with a
// retry behind it, so the 60 every other route uses would cut a slow generation
// off mid-flight. Platforms that cap below this clamp it themselves.
export const maxDuration = 300;

// POST /api/v1/clients/[clientId]/slots/[slotId]/copy
//
// Writes the finished, publishable words from the brief the slot already
// carries. The brief itself is not touched — that is what regenerate is for.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const steer = typeof body.steer === "string" ? body.steer.slice(0, 500) : undefined;

    const { slot, warnings } = await writeCopy(clientId, slotId, { steer });
    return NextResponse.json({ ...slot, warnings });
  } catch (error) {
    if (error instanceof SlotNotFoundError) {
      return jsonError(error.message, 404);
    }
    if (error instanceof WriteCopyFailedError) {
      // 502: the request was fine, the model was not. The slot is untouched,
      // so this is safe to retry.
      return jsonError(error.message, 502);
    }
    return serverError("Write copy error", error);
  }
}
