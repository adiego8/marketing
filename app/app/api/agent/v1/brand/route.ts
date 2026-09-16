import { NextResponse } from "next/server";
import { serializeClient } from "@/lib/firestore";
import { getStrategy } from "@/lib/marketing/strategy";
import { listLessons } from "@/lib/marketing/lessons-store";
import { lessonsFor } from "@/lib/marketing/lessons";
import { projectBranding, safeLogoUrl } from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

// GET /api/agent/v1/brand
//
// Everything an agent needs to sound and look like this client. Assembled from
// the strategy document, the branding record and the lessons — all of which
// already exist; none of this is a new store.
export async function GET() {
  try {
    const ctx = await requireApiKey("brand:read");
    if ("response" in ctx) return ctx.response;

    const client = serializeClient(ctx.client.id, ctx.client.data);
    const strategy = await getStrategy(ctx.key.clientId);

    /**
     * listLessons, NOT lessonsForPrompt.
     *
     * lessonsForPrompt swallows a Firestore error and returns [] — right for a
     * generation that must degrade rather than fail, and wrong here: it would
     * make "this client has no voice rules" and "we could not read the voice
     * rules" the same response, and an agent would write against neither.
     * Letting it throw gets a 500, which is the truth.
     */
    const lessons = await listLessons(ctx.key.clientId);

    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        timezone: client.timezone,
        website_url: client.website_url,
      },
      business_name: strategy?.business_name ?? client.name,
      icp: strategy?.icp ?? {},
      voice: strategy?.voice ?? {},
      positioning: strategy?.positioning ?? {},
      messaging: strategy?.messaging ?? {},
      // Whitelisted rather than passed through: branding is stored unvalidated,
      // so handing it over raw would promise a shape nothing enforces.
      visual: projectBranding(client.branding),
      logo: { url: safeLogoUrl(client.logo_url) },
      // The rules this client's own content is written against. An agent that
      // ignores them drifts from everything the app generates, and the
      // operator would have no idea why.
      lessons: lessonsFor(lessons, "copy"),
      updated_at: strategy?.updated_at ?? client.updated_at,
    });
  } catch (error) {
    return keyServerError("Agent brand error", error);
  }
}
