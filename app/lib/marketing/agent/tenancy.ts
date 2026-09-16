// Which client is this request about? Pure.
//
// A key is either scoped to one client or to a whole agency, and every route on
// the agent rail now has to answer this before it touches anything. That makes
// it the single most security-relevant decision in the namespace — so it lives
// here, as a function of two strings, where it can actually be tested, rather
// than as a branch repeated in seven route handlers.
//
// The Firestore load and the agency check stay in route-helpers.ts. This
// decides only WHICH id to load.

export type ClientTarget =
  | { id: string }
  /** An agency-wide key that did not say which client it means. */
  | { error: "needs_client" }
  /** A client-scoped key reaching for somebody else. */
  | { error: "not_found" };

export function targetClientId(
  key: { clientId: string | null },
  requested: string | null | undefined
): ClientTarget {
  const asked = typeof requested === "string" ? requested.trim() : "";

  // Agency-wide: there is no default, and guessing one would be worse than
  // asking. Picking "the first client" would silently act on the wrong one.
  if (!key.clientId) {
    return asked ? { id: asked } : { error: "needs_client" };
  }

  // Client-scoped: the id is optional, because the key already names it.
  if (!asked || asked === key.clientId) return { id: key.clientId };

  /**
   * Asking for a different client reads as missing, never as forbidden.
   *
   * A 403 here would confirm that the id exists — turning this parameter into
   * an oracle for enumerating other agencies' clients. Same reasoning as
   * getClientForSession, where a client belonging to someone else and a client
   * that was never created are deliberately indistinguishable.
   */
  return { error: "not_found" };
}
