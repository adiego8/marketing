import { NextResponse } from "next/server";
import { disconnect } from "@/lib/marketing/google";
import { requireSession, serverError } from "@/lib/marketing/route-helpers";

// POST /api/v1/google/disconnect
// Revokes the grant with Google where possible, and drops the stored token.
// Calendars and their events are left in place — they are the client's record.
export async function POST() {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    await disconnect(ctx.session.agencyId);
    return NextResponse.json({ connected: false });
  } catch (error) {
    return serverError("Google disconnect error", error);
  }
}
