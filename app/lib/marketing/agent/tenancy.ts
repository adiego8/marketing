// Which clients may this key reach, and which one is this request about? Pure.
//
// Every route on the agent rail answers this before it touches anything, which
// makes it the most security-relevant decision in the namespace — so it lives
// here, as a function of plain data, where it can actually be tested, rather
// than as a branch repeated in seven route handlers.
//
// The Firestore load and the agency check stay in route-helpers.ts. This
// decides only WHICH id to load.

/**
 * The clients a key may reach.
 *
 * `null` means every client in the agency, **including ones created later** —
 * an agency's own assistant should pick up a new client with nothing to
 * reconfigure. An explicit list never widens on its own, which is what makes it
 * safe to hand to somebody working on two of your five clients.
 */
export type ClientScope = string[] | null;

export type ClientTarget =
  | { id: string }
  /** The key reaches several clients and the caller did not say which. */
  | { error: "needs_client" }
  /** The key does not reach that client — or it does not exist. */
  | { error: "not_found" };

/**
 * Read a key's scope, tolerating the two shapes on disk.
 *
 * Keys minted before the allowlist carry a single `clientId`: a string for one
 * client, null for the whole agency. Both map onto the new shape exactly, so
 * there is no migration — the same read-time tolerance serializePlanRun shows
 * for runs made before planning was scoped.
 */
export function clientScopeOf(key: {
  clientIds?: unknown;
  clientId?: string | null;
}): ClientScope {
  if (Array.isArray(key.clientIds)) {
    return key.clientIds.filter((id): id is string => typeof id === "string" && !!id);
  }
  // Legacy: one client, or the whole agency.
  return key.clientId ? [key.clientId] : null;
}

/** Does this key reach that client? `null` scope reaches everything. */
export function scopeAllows(scope: ClientScope, clientId: string): boolean {
  return scope === null || scope.includes(clientId);
}

export function targetClientId(
  scope: ClientScope,
  requested: string | null | undefined
): ClientTarget {
  const asked = typeof requested === "string" ? requested.trim() : "";

  if (asked) {
    /**
     * Asking for a client outside the allowlist reads as missing, never as
     * forbidden.
     *
     * A 403 would confirm the id exists — turning this parameter into an oracle
     * for enumerating clients the holder was never granted. Same reasoning as
     * getClientForSession, where somebody else's client and a client that was
     * never created are deliberately indistinguishable.
     */
    return scopeAllows(scope, asked) ? { id: asked } : { error: "not_found" };
  }

  // Exactly one client: the key already names it, so saying so is redundant.
  if (scope !== null && scope.length === 1) return { id: scope[0] };

  /**
   * Several clients, or all of them, and none named. Ask rather than guess:
   * defaulting to "the first one" would act on the wrong client and report
   * success, which is the worst possible shape for a bug in a tool a model
   * calls on its own.
   */
  return { error: "needs_client" };
}
