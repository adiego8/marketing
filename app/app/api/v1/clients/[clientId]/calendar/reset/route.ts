import { NextResponse } from "next/server";
import { clearClientGoogleState } from "@/lib/marketing/google-reset";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// POST /api/v1/clients/[clientId]/calendar/reset
//
// Forget this client's Google calendar so the next sync creates a new one.
//
// The cure for a calendar deleted by hand in Google, which is otherwise
// permanent: ensureClientCalendar returns the stored id without checking it and
// only mints a calendar when the field is empty, so every sync 404s forever
// until something clears it.
//
// Deliberately explicit rather than a self-heal inside sync. A 404 can also
// mean a scope problem or a transient Google failure, and silently abandoning a
// calendar full of events on that evidence is not a decision to make on the
// user's behalf.
//
// Nothing is deleted from Google — the old calendar and its events stay where
// they are. This drops our pointers at them.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const cleared = await clearClientGoogleState(clientId);
    return NextResponse.json({
      cleared_calendar: cleared.clients > 0,
      cleared_slots: cleared.slots,
    });
  } catch (error) {
    return serverError("Calendar reset error", error);
  }
}
