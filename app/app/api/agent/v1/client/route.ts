import { NextResponse } from "next/server";
import { serializeClient } from "@/lib/firestore";
import {
  requireApiKey,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

// GET /api/agent/v1/client
//
// Who this key speaks for. An agent's first call: it should never hardcode a
// client id, and there is none in any path here — the key names the client, so
// there is no identifier for a caller to tamper with.
//
// Scoped to brand:read rather than a scope of its own. Knowing the name and
// timezone of the client you were issued a key for is not a separate privilege,
// and a fourth scope nobody would ever withhold is just a thing to get wrong.
export async function GET() {
  try {
    const ctx = await requireApiKey("brand:read");
    if ("response" in ctx) return ctx.response;

    const client = serializeClient(ctx.client.id, ctx.client.data);
    return NextResponse.json({
      id: client.id,
      name: client.name,
      // Every date in this API is a calendar date in this zone, never UTC.
      // An agent that ignores it will be a day out for half the world.
      timezone: client.timezone,
      website_url: client.website_url,
      status: client.status,
      key: {
        name: ctx.key.name,
        prefix: ctx.key.prefix,
        scopes: ctx.key.scopes,
      },
    });
  } catch (error) {
    return keyServerError("Agent client error", error);
  }
}
