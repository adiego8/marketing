import { describe, it, expect } from "vitest";
import { clientScopeOf, scopeAllows, targetClientId } from "./tenancy";

/**
 * The whole multi-tenant story for the agent rail is these three functions plus
 * the agency check that follows them. Both failure directions are silent: too
 * strict and a key cannot reach its own clients, too loose and one key reads
 * content it was never granted, with no error anywhere.
 */

describe("clientScopeOf", () => {
  it("reads an explicit allowlist", () => {
    expect(clientScopeOf({ clientIds: ["c1", "c2"] })).toEqual(["c1", "c2"]);
  });

  it("reads an empty allowlist as reaching nothing, not everything", () => {
    // The dangerous confusion: [] must not collapse to null.
    expect(clientScopeOf({ clientIds: [] })).toEqual([]);
    expect(scopeAllows(clientScopeOf({ clientIds: [] }), "c1")).toBe(false);
  });

  /**
   * Keys minted before the allowlist carry a single clientId. Both of its
   * shapes map exactly, so nothing needs migrating — and a key someone is
   * using today must not stop working on deploy.
   */
  it("maps a legacy single-client key onto a one-entry list", () => {
    expect(clientScopeOf({ clientId: "c1" })).toEqual(["c1"]);
  });

  it("maps a legacy agency-wide key onto all clients", () => {
    expect(clientScopeOf({ clientId: null })).toBeNull();
    expect(clientScopeOf({})).toBeNull();
  });

  it("prefers the allowlist when a document carries both", () => {
    expect(clientScopeOf({ clientIds: ["c9"], clientId: "c1" })).toEqual(["c9"]);
  });

  it("drops junk entries rather than trusting them", () => {
    expect(clientScopeOf({ clientIds: ["c1", 42, null, ""] })).toEqual(["c1"]);
  });
});

describe("scopeAllows", () => {
  it("lets an all-clients key reach anything", () => {
    expect(scopeAllows(null, "anything")).toBe(true);
  });

  it("honours an allowlist exactly", () => {
    expect(scopeAllows(["c1", "c2"], "c2")).toBe(true);
    expect(scopeAllows(["c1", "c2"], "c3")).toBe(false);
  });
});

describe("targetClientId — naming a client", () => {
  it("accepts one inside the allowlist", () => {
    expect(targetClientId(["c1", "c2"], "c2")).toEqual({ id: "c2" });
    expect(targetClientId(["c1"], "  c1  ")).toEqual({ id: "c1" });
  });

  it("accepts anything when the key reaches all clients", () => {
    expect(targetClientId(null, "c9")).toEqual({ id: "c9" });
  });

  /** The attack: a key for two clients reaching for a third. */
  it("refuses one outside the allowlist", () => {
    expect(targetClientId(["c1", "c2"], "c3")).toEqual({ error: "not_found" });
  });

  // not_found, never "forbidden" — a 403 confirms the id exists and turns this
  // parameter into an oracle for enumerating clients.
  it("reads a refusal as missing rather than forbidden", () => {
    expect(targetClientId(["c1"], "c2")).toHaveProperty("error", "not_found");
  });

  it("refuses everything when the allowlist is empty", () => {
    expect(targetClientId([], "c1")).toEqual({ error: "not_found" });
  });
});

describe("targetClientId — naming nothing", () => {
  it("defaults to the only client a key reaches", () => {
    expect(targetClientId(["c1"], null)).toEqual({ id: "c1" });
    expect(targetClientId(["c1"], undefined)).toEqual({ id: "c1" });
    expect(targetClientId(["c1"], "   ")).toEqual({ id: "c1" });
  });

  /**
   * It must ASK rather than pick. Defaulting to "the first client" would act on
   * the wrong one and report success — the worst shape a bug can take in a tool
   * a model calls without a human watching each call.
   */
  it("refuses to guess between several", () => {
    expect(targetClientId(["c1", "c2"], null)).toEqual({ error: "needs_client" });
  });

  it("refuses to guess for an all-clients key", () => {
    expect(targetClientId(null, null)).toEqual({ error: "needs_client" });
  });

  it("refuses when the key reaches nothing at all", () => {
    expect(targetClientId([], null)).toEqual({ error: "needs_client" });
  });
});

describe("resolving an id is not authorisation", () => {
  /**
   * An all-clients key resolves any id at all — including one from another
   * agency. What stops it is the agencyId comparison on the loaded client
   * document, which runs after. This test exists so nobody reads a bare
   * `{ id }` here as permission granted.
   */
  it("still resolves a client belonging to someone else", () => {
    expect(targetClientId(null, "another-agencys-client")).toEqual({
      id: "another-agencys-client",
    });
  });
});
