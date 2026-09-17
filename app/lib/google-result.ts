/**
 * What the Google OAuth callback is telling us.
 *
 * The callback is a browser redirect, so the only channel it has back into the
 * app is a `?google=` code in the query string — which means the copy for every
 * outcome lives on this side, not with the route that emits it.
 *
 * Shared rather than per-page for a reason: this map used to live on the
 * schedule page alone, while the campaign workspace passed its own path as
 * returnTo and then never read the result. Codes redirected there were dropped
 * on the floor — the user pressed Connect, something went wrong, and the page
 * said nothing at all. Connect is reachable from three places now, so the map
 * and the reader are shared and each page renders whatever it is handed.
 */

export const GOOGLE_RESULTS: Record<string, string> = {
  access_denied: "You declined the Google permissions, so nothing was connected.",
  "invalid-state": "That sign-in link expired. Press Connect Google again.",
  "no-code": "Google did not return an authorisation code. Try again.",
  "no-refresh-token":
    "Google withheld a refresh token. Remove this app under your Google account permissions, then connect again.",
  "exchange-failed":
    "Google rejected the authorisation. Check the OAuth client's redirect URI.",
  "not-configured": "Google OAuth is not configured on this server.",
  // The refusal only happens after the user has cleared Google's consent
  // screen — the account is not knowable before then — so the copy has to
  // explain why the thing they just approved did not take effect, and say
  // exactly where the way out is.
  "account-mismatch":
    "That is a different Google account from the one connected. This agency uses one " +
    "account for every client's calendar, so disconnect the current one in Settings " +
    "first — nothing in Google is deleted when you do.",
};

export interface GoogleResult {
  /** True when the connection succeeded; callers usually show this as a note. */
  connected: boolean;
  /** The message to show, or null when the code was a success. */
  message: string | null;
}

/**
 * Read `?google=` out of the current URL and strip it.
 *
 * Stripping matters: the code describes one round trip, and leaving it in the
 * URL means a refresh or a shared link replays a stale error. Returns null when
 * there is nothing to report, so a page can bail without touching history.
 *
 * Browser only — it reads window.location and rewrites history.
 */
export function readGoogleResult(): GoogleResult | null {
  if (typeof window === "undefined") return null;

  const code = new URLSearchParams(window.location.search).get("google");
  if (!code) return null;

  window.history.replaceState({}, "", window.location.pathname);

  if (code === "connected") return { connected: true, message: null };
  return {
    connected: false,
    // An unknown code still says something rather than failing silently: a new
    // code added to the callback and forgotten here is a bug, not a blank page.
    message: GOOGLE_RESULTS[code] ?? `Google returned "${code}".`,
  };
}
