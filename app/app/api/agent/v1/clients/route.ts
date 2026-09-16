import { NextResponse } from "next/server";
import { serializeClient } from "@/lib/firestore";
import {
  requireKey,
  clientsForKey,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

// GET /api/agent/v1/clients
//
// What this key can see. An agent's first call — it should never hardcode a
// client id, and for an agency-wide key it has no way to know one otherwise.
//
// One entry for a client-scoped key, every active client for an agency-wide
// one. The same shape either way, so a caller does not branch on how its key
// happened to be minted.
//
// Scoped to brand:read rather than a scope of its own. Knowing the name and
// timezone of a client you already hold a key for is not a separate privilege,
// and a fourth scope nobody would ever withhold is just a thing to get wrong.
export async function GET() {
  try {
    const auth = await requireKey("brand:read");
    if ("response" in auth) return auth.response;

    const clients = await clientsForKey(auth.key);

    return NextResponse.json({
      clients: clients.map((c) => {
        const client = serializeClient(c.id, c.data);
        return {
          id: client.id,
          name: client.name,
          // Every date in this API is a calendar date in this zone, never UTC.
          // An agent that ignores it will be a day out for half the world.
          timezone: client.timezone,
          website_url: client.website_url,
          status: client.status,
        };
      }),
      key: {
        name: auth.key.name,
        prefix: auth.key.prefix,
        scopes: auth.key.scopes,
        // So a caller knows whether client_id is required on everything else,
        // and an operator debugging a 400 can see what they pasted. "all" also
        // covers clients added after the key was minted.
        reaches: auth.key.clientIds === null ? "all" : "selected",
        client_count: clients.length,
      },
    });
  } catch (error) {
    return keyServerError("Agent clients error", error);
  }
}
