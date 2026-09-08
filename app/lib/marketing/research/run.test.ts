import { describe, it, expect } from "vitest";
import { researchClient, ResearchFailedError, type SearchFn, type DraftFn } from "./run";

// The seams are parameters with defaults, as planner/run.ts does with decideFn,
// so the orchestration is testable without mocking and without a network call.
const okSearch: SearchFn = async (call) => ({
  data: {
    company: { description: "Online tax filing.", stage: "growth" },
    evidence: [{ claim: "Free audit support", source: "https://mywelltax.com/pricing" }],
    competitors: call.allowedDomains ? [] : [{ name: "TurboTax", url: "turbotax.com" }],
  },
  sources: ["https://mywelltax.com/pricing", "https://mywelltax.com/pricing"],
});

const okDraft: DraftFn = async () => ({
  business_name: "MyWellTax",
  messaging: {
    tagline: "File online. Not alone.",
    proof_points: [{ claim: "Free audit support", source: "https://mywelltax.com/pricing" }],
  },
});

const boom = (what: string) => async () => {
  throw new Error(what);
};

const CLIENT = { name: "MyWellTax", website_url: "https://www.mywelltax.com", description: null };

describe("researchClient", () => {
  it("refuses to research a client with no website", async () => {
    const result = await researchClient(
      { name: "Integral", website_url: null },
      { searchFn: boom("should not be called") as SearchFn, draftFn: boom("nor this") as DraftFn }
    );
    expect(result.status).toBe("insufficient");
    expect(result.llm.searches).toBe(0);
    expect(result.sources).toEqual([]);
    expect(result.warnings.join(" ")).toContain("has no website");
    // Still returns a full strategy shape so the caller never handles a hole.
    expect(result.draft_strategy.business_name).toBe("Integral");
  });

  it("refuses a website that is not an address it can read", async () => {
    const result = await researchClient(
      { name: "Integral", website_url: "not a url" },
      { searchFn: boom("no") as SearchFn, draftFn: boom("no") as DraftFn }
    );
    expect(result.status).toBe("insufficient");
    expect(result.warnings.join(" ")).toContain("is not a website address");
  });

  it("scopes the first pass to the client's own domain", async () => {
    const seen: (string[] | undefined)[] = [];
    const spy: SearchFn = async (call) => {
      seen.push(call.allowedDomains);
      return okSearch(call);
    };
    await researchClient(CLIENT, { searchFn: spy, draftFn: okDraft });
    expect(seen).toEqual([["mywelltax.com"], undefined]);
  });

  it("returns complete, with sources deduped", async () => {
    const result = await researchClient(CLIENT, { searchFn: okSearch, draftFn: okDraft });
    expect(result.status).toBe("complete");
    expect(result.llm.searches).toBe(2);
    expect(result.sources).toEqual(["https://mywelltax.com/pricing"]);
    expect(result.draft_strategy.messaging).toMatchObject({
      tagline: "File online. Not alone.",
      proof_points: ["Free audit support"],
    });
    expect(result.open_questions.length).toBeGreaterThan(0);
  });

  it("degrades to one pass rather than failing the run", async () => {
    let call = 0;
    const flaky: SearchFn = async (c) => {
      if (++call === 1) throw new Error("timeout");
      return okSearch(c);
    };
    const result = await researchClient(CLIENT, { searchFn: flaky, draftFn: okDraft });
    expect(result.status).toBe("degraded");
    expect(result.llm.searches).toBe(1);
    expect(result.warnings.join(" ")).toContain("Could not read mywelltax.com");
  });

  it("warns once, after merging, when neither pass described the company", async () => {
    // The check has to live after the merge: the open-web pass is not supposed
    // to describe the company, so running it per pass reported "found nothing"
    // on runs that had in fact found plenty.
    const empty: SearchFn = async () => ({ data: {}, sources: ["https://mywelltax.com/"] });
    const blank = await researchClient(CLIENT, { searchFn: empty, draftFn: okDraft });
    expect(blank.warnings.filter((w) => w.includes("describing what this company does"))).toHaveLength(1);

    const found = await researchClient(CLIENT, { searchFn: okSearch, draftFn: okDraft });
    expect(found.warnings.join(" ")).not.toContain("describing what this company does");
  });

  it("fails when both passes fail, so nothing half-made is stored", async () => {
    await expect(
      researchClient(CLIENT, { searchFn: boom("down") as SearchFn, draftFn: okDraft })
    ).rejects.toThrow(ResearchFailedError);
  });

  it("fails when the draft fails, rather than storing a dossier with no strategy", async () => {
    await expect(
      researchClient(CLIENT, { searchFn: okSearch, draftFn: boom("bad json") as DraftFn })
    ).rejects.toThrow(/strategy draft failed/i);
  });
});
