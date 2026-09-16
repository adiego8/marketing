import { describe, it, expect } from "vitest";
import { targetClientId } from "./tenancy";

/**
 * The whole multi-tenant story for the agent rail is this function plus the
 * agency check that follows it. Both failure directions are silent: too strict
 * and an agency key cannot reach its own clients, too loose and one agency's
 * key reads another's content with no error anywhere.
 */

const CLIENT_KEY = { clientId: "c1" };
const AGENCY_KEY = { clientId: null };

describe("targetClientId — a client-scoped key", () => {
  it("defaults to the client it was minted for", () => {
    expect(targetClientId(CLIENT_KEY, null)).toEqual({ id: "c1" });
    expect(targetClientId(CLIENT_KEY, undefined)).toEqual({ id: "c1" });
    expect(targetClientId(CLIENT_KEY, "")).toEqual({ id: "c1" });
    expect(targetClientId(CLIENT_KEY, "   ")).toEqual({ id: "c1" });
  });

  it("accepts its own client stated explicitly", () => {
    expect(targetClientId(CLIENT_KEY, "c1")).toEqual({ id: "c1" });
    expect(targetClientId(CLIENT_KEY, "  c1  ")).toEqual({ id: "c1" });
  });

  /**
   * The attack this exists to stop: a key for one client passing somebody
   * else's id and being served their plan.
   */
  it("refuses another client", () => {
    expect(targetClientId(CLIENT_KEY, "c2")).toEqual({ error: "not_found" });
  });

  // not_found, never a 403 — a 403 would confirm the id exists and turn this
  // parameter into an oracle for enumerating other agencies' clients.
  it("reads a refusal as missing rather than forbidden", () => {
    const result = targetClientId(CLIENT_KEY, "c2");
    expect(result).not.toHaveProperty("error", "needs_client");
    expect(result).toHaveProperty("error", "not_found");
  });
});

describe("targetClientId — an agency-wide key", () => {
  it("resolves whatever client it names", () => {
    expect(targetClientId(AGENCY_KEY, "c9")).toEqual({ id: "c9" });
    expect(targetClientId(AGENCY_KEY, " c9 ")).toEqual({ id: "c9" });
  });

  /**
   * It must ASK rather than pick. Defaulting to "the agency's first client"
   * would act on the wrong one and report success — the worst possible shape
   * for a bug in a tool an LLM calls.
   */
  it("refuses to guess when no client is named", () => {
    expect(targetClientId(AGENCY_KEY, null)).toEqual({ error: "needs_client" });
    expect(targetClientId(AGENCY_KEY, "")).toEqual({ error: "needs_client" });
    expect(targetClientId(AGENCY_KEY, "  ")).toEqual({ error: "needs_client" });
  });

  // Resolving an id here is not authorisation. The agency comparison against
  // the loaded client document is what actually decides, and it runs after.
  it("does not itself authorise the client it resolves", () => {
    expect(targetClientId(AGENCY_KEY, "belongs-to-someone-else")).toEqual({
      id: "belongs-to-someone-else",
    });
  });
});
