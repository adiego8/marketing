import { NextResponse } from "next/server";
import { disconnect } from "@/lib/marketing/google";
import { requireSession, serverError } from "@/lib/marketing/route-helpers";

// POST /api/v1/google/disconnect
//
// Revokes the grant with Google where possible, drops the stored token, and
// forgets every calendar the account created.
//
// The forgetting is what makes reconnecting a DIFFERENT account work at all.
// Calendars belong to the connected account but are remembered per client, so
// a grant swapped underneath them leaves every client pointing at a calendar
// the new account cannot see — and ensureClientCalendar returns stored ids
// without checking, so nothing would ever repair it.
//
// Nothing is deleted from Google. The calendars and their events stay in the
// account that owns them, as the client's record; this drops our pointers at
// them, and the next sync builds fresh ones under whoever connects next.
export async function POST() {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    const cleared = await disconnect(ctx.session.agencyId);
    return NextResponse.json({
      connected: false,
      cleared_clients: cleared.clients,
      cleared_slots: cleared.slots,
    });
  } catch (error) {
    return serverError("Google disconnect error", error);
  }
}
