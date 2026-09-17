import { NextResponse } from "next/server";
import { googleConfigured, googleMissingEnv, getConnectionStatus } from "@/lib/marketing/google";
import { countLinkedClients } from "@/lib/marketing/google-reset";
import { requireSession, serverError } from "@/lib/marketing/route-helpers";

// GET /api/v1/google/status
// Whether this agency has linked Google, which account, and how much is riding
// on it — linked_clients is what lets the disconnect confirmation name a true
// number instead of threatening "every client" when the answer might be none.
export async function GET() {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    if (!googleConfigured()) {
      return NextResponse.json({
        configured: false,
        missing: googleMissingEnv(),
        connected: false,
        email: null,
        scopes: [],
        needs_reconnect: false,
        linked_clients: 0,
      });
    }

    const status = await getConnectionStatus(ctx.session.agencyId);
    // Only meaningful while connected: with no grant there is nothing to warn
    // about losing, and it saves a client query on every status poll.
    const linkedClients = status.connected
      ? await countLinkedClients(ctx.session.agencyId)
      : 0;
    return NextResponse.json({
      configured: true,
      missing: [],
      connected: status.connected,
      email: status.email,
      scopes: status.scopes,
      needs_reconnect: status.needsReconnect,
      linked_clients: linkedClients,
    });
  } catch (error) {
    return serverError("Google status error", error);
  }
}
