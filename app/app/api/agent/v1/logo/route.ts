import { NextResponse } from "next/server";
import { safeLogoUrl } from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyError,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

// GET /api/agent/v1/logo
//
// A 302 to the client's logo, so `curl -L` and every HTTP client get the bytes
// without a second contract to implement.
//
// There is no file storage in this app yet — logo_url is a URL somebody typed
// on the Branding page. When storage lands, this endpoint does not change;
// only what the URL points at does.
export async function GET() {
  try {
    const ctx = await requireApiKey("brand:read");
    if ("response" in ctx) return ctx.response;

    /**
     * Validated, not trusted.
     *
     * logo_url is hand-typed and nothing checks it beyond a trim. Redirecting
     * to it unchecked would make this domain an open redirect for anyone who
     * can edit a client — to another host, or to a javascript: URL. Same class
     * of bug safeReturnTo in google.ts exists for.
     */
    const url = safeLogoUrl(ctx.client.data.logoUrl);
    if (!url) {
      return keyError("not_found", "This client has no logo set.", 404);
    }

    return NextResponse.redirect(url, 302);
  } catch (error) {
    return keyServerError("Agent logo error", error);
  }
}
