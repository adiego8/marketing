import { NextResponse } from "next/server";
import {
  authUrl,
  googleConfigured,
  googleMissingEnv,
  safeReturnTo,
  signState,
} from "@/lib/marketing/google";
import { requireSession, jsonError, serverError } from "@/lib/marketing/route-helpers";

// POST /api/v1/google/start
//
// Returns the Google consent URL for the browser to follow. A POST, and it
// returns the URL rather than redirecting, because the caller is authenticated
// by a Bearer token that a top-level navigation could not carry.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if ("response" in ctx) return ctx.response;

    if (!googleConfigured()) {
      return jsonError(
        `Google OAuth is not configured. Set ${googleMissingEnv().join(", ")} in .env.local.`,
        503
      );
    }

    // The agency travels in the signed state: the callback is a browser
    // redirect with no Authorization header, so it cannot resolve membership.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const state = signState({
      uid: ctx.session.uid,
      agencyId: ctx.session.agencyId,
      // Sanitised at both ends: an app-relative path only, never an absolute
      // URL that would turn the callback into an open redirect.
      returnTo: safeReturnTo(body.returnTo),
    });
    return NextResponse.json({ url: authUrl(state) });
  } catch (error) {
    return serverError("Google start error", error);
  }
}
