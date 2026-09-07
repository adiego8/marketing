import { NextResponse } from "next/server";
import {
  exchangeCode,
  googleConfigured,
  saveGoogleCredentials,
  verifyState,
} from "@/lib/marketing/google";

// GET /api/v1/google/callback?code=&state=
//
// Google redirects the browser here. There is no Authorization header on a
// top-level navigation, so identity comes from the HMAC-signed state minted by
// /google/start — which is also the CSRF defence: without it this endpoint
// would attach any code anyone presented to whichever agency it guessed.
//
// It always redirects back to the app with a result in the query string;
// returning JSON here would leave the user staring at a raw object.
function back(request: Request, params: Record<string, string>, to = "/") {
  const url = new URL(to, request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // The user pressed Cancel on the consent screen.
  const denied = url.searchParams.get("error");
  if (denied) return back(request, { google: denied });

  if (!googleConfigured()) return back(request, { google: "not-configured" });

  const state = verifyState(url.searchParams.get("state"));
  if (!state) return back(request, { google: "invalid-state" });
  const home = state.returnTo ?? "/";

  const code = url.searchParams.get("code");
  if (!code) return back(request, { google: "no-code" }, home);

  try {
    const { refreshToken, email, scopes } = await exchangeCode(code);
    if (!refreshToken) {
      // Google only issues one on first consent. authUrl sends
      // prompt=consent to prevent this, so it means the grant is in an odd
      // state — revoking access in the Google account and retrying fixes it.
      return back(request, { google: "no-refresh-token" }, home);
    }
    await saveGoogleCredentials(state.agencyId, { refreshToken, email, scopes });
    return back(request, { google: "connected" }, state.returnTo);
  } catch (error) {
    console.error("Google callback error:", error);
    return back(request, { google: "exchange-failed" }, home);
  }
}
