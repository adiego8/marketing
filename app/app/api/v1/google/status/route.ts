import { NextResponse } from "next/server";
import { googleConfigured, googleMissingEnv, getConnectionStatus } from "@/lib/marketing/google";
import { requireSession, serverError } from "@/lib/marketing/route-helpers";

// GET /api/v1/google/status
// Whether this agency has linked Google, and which account.
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
      });
    }

    const status = await getConnectionStatus(ctx.session.agencyId);
    return NextResponse.json({
      configured: true,
      missing: [],
      connected: status.connected,
      email: status.email,
      scopes: status.scopes,
      needs_reconnect: status.needsReconnect,
    });
  } catch (error) {
    return serverError("Google status error", error);
  }
}
