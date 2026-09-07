import { NextResponse } from "next/server";
import { syncSlots } from "@/lib/marketing/calendar";
import { calendarEmbedUrl, calendarOpenUrl } from "@/lib/marketing/calendar-links";
import { NotConnectedError } from "@/lib/marketing/google";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// Up to one Google call per slot, plus a calendar create on first run.
export const maxDuration = 60;

// POST /api/v1/clients/[clientId]/calendar/sync
//
// Pushes committed slots to the client's Google calendar. Separate from accept
// on purpose: that write is an atomic Firestore batch, and an external API call
// cannot join it. This is the retryable half.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const result = await syncSlots(ctx.session.agencyId, clientId, {
      start: typeof body.start === "string" ? body.start : undefined,
      end: typeof body.end === "string" ? body.end : undefined,
      appUrl: new URL(request.url).origin,
    });

    const timezone = String(ctx.client.data.timezone || "UTC");
    return NextResponse.json({
      ...result,
      embed_url: calendarEmbedUrl(result.calendarId, timezone),
      open_url: calendarOpenUrl(result.calendarId),
    });
  } catch (error) {
    // 428: the request was fine, a precondition is missing. Same code
    // numerico-website uses for "link Google first".
    if (error instanceof NotConnectedError) {
      return jsonError(error.message, 428);
    }
    return serverError("Calendar sync error", error);
  }
}
