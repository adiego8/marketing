import { describe, it, expect } from "vitest";
import {
  domainOf,
  parseSteer,
  isStale,
  RUN_TIMEOUT_MS,
  hostsOf,
  parseDossier,
  mergeDossiers,
  parseDraftStrategy,
  openQuestionsFor,
  EMPTY_DOSSIER,
  type Dossier,
} from "./parse";

const CITED = ["https://www.mywelltax.com/pricing", "https://apps.apple.com/us/app/mywelltax"];

describe("domainOf", () => {
  it("takes a bare domain", () => {
    expect(domainOf("mywelltax.com")).toBe("mywelltax.com");
  });

  it("strips protocol, www, path, query and port", () => {
    expect(domainOf("https://www.mywelltax.com/pricing?a=1")).toBe("mywelltax.com");
    expect(domainOf("http://mywelltax.com:8080/")).toBe("mywelltax.com");
  });

  it("keeps a meaningful subdomain", () => {
    expect(domainOf("https://app.mywelltax.com")).toBe("app.mywelltax.com");
  });

  it("lowercases", () => {
    expect(domainOf("HTTPS://MyWellTax.COM")).toBe("mywelltax.com");
  });

  it("returns null for anything that is not a public host", () => {
    // Null must mean "skip the site pass", never "search the whole web" —
    // widening the search on a typo is how unsourced guessing gets in.
    for (const bad of ["", "   ", "localhost", "not a url", "http://", "ftp://", 42, null, undefined]) {
      expect(domainOf(bad)).toBeNull();
    }
  });
});

describe("hostsOf", () => {
  it("reduces cited urls to their hosts", () => {
    expect(hostsOf(CITED)).toEqual(new Set(["mywelltax.com", "apps.apple.com"]));
  });

  it("ignores junk rather than throwing", () => {
    expect(hostsOf(["", "nope", "https://a.com/x"])).toEqual(new Set(["a.com"]));
  });
});

describe("parseDossier", () => {
  it("returns the empty shape for a truncated or wrong-typed body", () => {
    for (const bad of [null, undefined, "a string", [], 7]) {
      const { dossier } = parseDossier(bad, CITED);
      expect(dossier).toEqual(EMPTY_DOSSIER);
    }
  });

  it("keeps evidence whose source was actually read, and drops the rest", () => {
    const { dossier, warnings } = parseDossier(
      {
        company: { description: "Online tax filing." },
        evidence: [
          { claim: "100% accuracy guarantee", source: "https://www.mywelltax.com/pricing" },
          { claim: "Trusted by 2 million filers", source: "https://invented-source.example/proof" },
          { claim: "Rated 4.8", source: "" },
          { claim: "", source: "https://www.mywelltax.com/pricing" },
        ],
      },
      CITED
    );
    expect(dossier.evidence).toEqual([
      { claim: "100% accuracy guarantee", source: "https://www.mywelltax.com/pricing" },
    ]);
    expect(warnings.join(" ")).toContain("Dropped 2 findings");
  });

  it("absorbs a competitor given as a bare string", () => {
    const { dossier } = parseDossier({ competitors: ["TurboTax", { name: "" }] }, CITED);
    expect(dossier.competitors).toEqual([
      { name: "TurboTax", url: null, positioning: "", strengths: [], weaknesses: [] },
    ]);
  });

  it("normalises a competitor url and drops a nameless one", () => {
    const { dossier } = parseDossier(
      { competitors: [{ name: "TurboTax", url: "www.turbotax.com/x", strengths: "not a list" }] },
      CITED
    );
    expect(dossier.competitors[0].url).toBe("https://turbotax.com");
    expect(dossier.competitors[0].strengths).toEqual([]);
  });

  it("dedupes list entries and caps their length", () => {
    const { dossier } = parseDossier(
      { audience: { pain_points: ["same", "same", ...Array.from({ length: 20 }, (_, i) => `p${i}`)] } },
      CITED
    );
    expect(dossier.audience.pain_points.length).toBe(8);
    expect(dossier.audience.pain_points[0]).toBe("same");
  });
});

describe("mergeDossiers", () => {
  const site: Dossier = {
    ...EMPTY_DOSSIER,
    company: { ...EMPTY_DOSSIER.company, description: "From their own site." },
    audience: { ...EMPTY_DOSSIER.audience, pain_points: ["a"] },
    evidence: [{ claim: "guarantee", source: "https://mywelltax.com" }],
  };
  const web: Dossier = {
    ...EMPTY_DOSSIER,
    company: { ...EMPTY_DOSSIER.company, description: "From a directory.", stage: "growth" },
    audience: { ...EMPTY_DOSSIER.audience, pain_points: ["a", "b"] },
    competitors: [{ name: "TurboTax", url: null, positioning: "", strengths: [], weaknesses: [] }],
  };

  it("prefers the company's own site for facts about itself", () => {
    expect(mergeDossiers(site, web).company.description).toBe("From their own site.");
  });

  it("falls back to the open web where the site said nothing", () => {
    expect(mergeDossiers(site, web).company.stage).toBe("growth");
  });

  it("unions lists without duplicating", () => {
    expect(mergeDossiers(site, web).audience.pain_points).toEqual(["a", "b"]);
  });

  it("takes competitors from the open web, not from the company itself", () => {
    expect(mergeDossiers(site, web).competitors[0].name).toBe("TurboTax");
  });
});

describe("parseDraftStrategy", () => {
  it("seeds every section so the editor renders a nothing-response", () => {
    const { strategy } = parseDraftStrategy(null, CITED, "MyWellTax");
    expect(strategy.business_name).toBe("MyWellTax");
    expect(Object.keys(strategy)).toEqual([
      "business_name", "icp", "voice", "positioning", "messaging",
      "goals", "content_strategy", "content_quota",
    ]);
    expect(strategy.icp).toHaveProperty("desired_outcomes", []);
    expect(strategy.goals).toHaveProperty("focus_90_days", "");
    expect(strategy.content_quota).toEqual({ weekly: {}, rationale: "" });
  });

  it("keeps only proof points that name a page the search read", () => {
    const { strategy, warnings } = parseDraftStrategy(
      {
        messaging: {
          proof_points: [
            { claim: "Free audit support", source: "https://www.mywelltax.com/pricing" },
            { claim: "Used by 2 million filers", source: "https://made-up.example" },
            { claim: "Fastest in the industry" },
            "a bare string with no source at all",
          ],
        },
      },
      CITED,
      "MyWellTax"
    );
    expect(strategy.messaging.proof_points).toEqual(["Free audit support"]);
    expect(warnings.join(" ")).toContain("Dropped 3 proof points");
    expect(warnings.join(" ")).toContain("Ask the client for the real numbers");
  });

  it("rejects a platform that is not a channel the planner knows", () => {
    const { strategy } = parseDraftStrategy(
      { content_strategy: { platforms: ["instagram", "tiktok", "INSTAGRAM"] } },
      CITED,
      "x"
    );
    expect(strategy.content_strategy.platforms).toEqual(["instagram"]);
  });

  it("ignores a quota row for a retired or unknown format", () => {
    const { strategy, warnings } = parseDraftStrategy(
      {
        content_quota: {
          weekly: {
            hook: { count: 3, channels: ["linkedin"] },
            tiktok_video: { count: 2, channels: [] },
            post: { count: 2, channels: ["linkedin"] },
          },
        },
      },
      CITED,
      "x"
    );
    expect(Object.keys(strategy.content_quota.weekly)).toEqual(["post"]);
    expect(warnings.join(" ")).toContain('"hook"');
    expect(warnings.join(" ")).toContain('"tiktok_video"');
  });

  it("drops a channel a format cannot go out on, and defaults an empty list", () => {
    const { strategy } = parseDraftStrategy(
      { content_quota: { weekly: { reel: { count: 1, channels: ["linkedin", "instagram"] } } } },
      CITED,
      "x"
    );
    expect(strategy.content_quota.weekly.reel.channels).toEqual(["instagram"]);

    const { strategy: defaulted } = parseDraftStrategy(
      { content_quota: { weekly: { newsletter: { count: 1, channels: [] } } } },
      CITED,
      "x"
    );
    expect(defaulted.content_quota.weekly.newsletter.channels).toEqual(["email"]);
  });

  it("trims a quota that exceeds what the planner can ever place", () => {
    const { strategy, warnings } = parseDraftStrategy(
      { content_quota: { weekly: { post: { count: 20, channels: ["linkedin"] } } } },
      CITED,
      "x"
    );
    const total = Object.values(strategy.content_quota.weekly).reduce((n, e) => n + e.count, 0);
    expect(total).toBe(14);
    expect(warnings.join(" ")).toContain("Trimmed the weekly quota to 14");
  });

  it("normalises an angle type and drops a secondary angle with no statement", () => {
    const { strategy } = parseDraftStrategy(
      {
        positioning: {
          primary_angle: { type: "Unique Mechanism", statement: "s", why: "w" },
          secondary_angles: [{ type: "enemy", statement: "real" }, { type: "speed_ease" }],
        },
      },
      CITED,
      "x"
    );
    expect((strategy.positioning.primary_angle as { type: string }).type).toBe("unique_mechanism");
    expect(strategy.positioning.secondary_angles).toHaveLength(1);
  });

  it("slugifies demographic keys and drops non-string values", () => {
    const { strategy } = parseDraftStrategy(
      { icp: { demographics: { "Customer type": "Individual", age_range: 35, "": "x" } } },
      CITED,
      "x"
    );
    expect(strategy.icp.demographics).toEqual({ customer_type: "Individual" });
  });
});

describe("openQuestionsFor", () => {
  const blank = parseDraftStrategy(null, [], "x").strategy;

  it("asks for proof when nothing survived verification", () => {
    const qs = openQuestionsFor(blank, EMPTY_DOSSIER);
    expect(qs.join(" ")).toContain("What results can we actually claim");
  });

  it("asks who they lose deals to when research found no competitors", () => {
    expect(openQuestionsFor(blank, EMPTY_DOSSIER).join(" ")).toContain("Who do you lose deals to");
  });

  it("always asks about capacity, which is not discoverable from outside", () => {
    const full = parseDraftStrategy(
      {
        icp: { objections: ["too expensive"], trigger_events: ["got a 1099"] },
        messaging: { proof_points: [{ claim: "c", source: "https://www.mywelltax.com/pricing" }] },
      },
      CITED,
      "x"
    ).strategy;
    const dossier: Dossier = {
      ...EMPTY_DOSSIER,
      competitors: [{ name: "TurboTax", url: null, positioning: "", strengths: [], weaknesses: [] }],
      voice_samples: ["a sample"],
    };
    const qs = openQuestionsFor(full, dossier);
    expect(qs).toHaveLength(2);
    expect(qs.join(" ")).toContain("how many pieces a week");
  });
});

describe("parseSteer", () => {
  it("returns empty for a missing or junk body", () => {
    for (const bad of [undefined, null, "a string", [], 7]) {
      expect(parseSteer(bad)).toEqual({ steer: "", competitors: [] });
    }
  });

  it("trims and caps the note rather than rejecting it", () => {
    // A too-long steer is a person typing, not an attack — the slot routes
    // slice for the same reason.
    const long = "x".repeat(900);
    const { steer } = parseSteer({ steer: `  ${long}  ` });
    expect(steer).toHaveLength(500);
  });

  it("splits competitors on newlines, dropping blanks", () => {
    expect(parseSteer({ competitors: "TurboTax\n\n  H&R Block  \n" }).competitors).toEqual([
      "TurboTax",
      "H&R Block",
    ]);
  });

  it("also splits on commas, because people type both", () => {
    expect(parseSteer({ competitors: "TurboTax, TaxAct" }).competitors).toEqual([
      "TurboTax",
      "TaxAct",
    ]);
  });

  it("accepts an array as well as raw text", () => {
    expect(parseSteer({ competitors: ["TurboTax", 7, ""] }).competitors).toEqual(["TurboTax"]);
  });

  it("dedupes case-insensitively and caps the list", () => {
    expect(parseSteer({ competitors: "TurboTax\nturbotax" }).competitors).toEqual(["TurboTax"]);
    const many = Array.from({ length: 20 }, (_, i) => `Rival ${i}`).join("\n");
    expect(parseSteer({ competitors: many }).competitors).toHaveLength(6);
  });

  it("caps each name", () => {
    expect(parseSteer({ competitors: "y".repeat(200) }).competitors[0]).toHaveLength(80);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("leaves a fresh running run alone", () => {
    expect(isStale({ status: "running", created_at: ago(60_000) }, now)).toBe(false);
  });

  it("calls a running run stale once it outlives its invocation", () => {
    // after() dies with the request that started it, so past the ceiling
    // nothing is coming back to finish this row.
    expect(isStale({ status: "running", created_at: ago(RUN_TIMEOUT_MS + 1000) }, now)).toBe(true);
  });

  it("never calls a finished run stale, however old", () => {
    for (const status of ["complete", "degraded", "insufficient", "failed"]) {
      expect(isStale({ status, created_at: ago(10 * RUN_TIMEOUT_MS) }, now)).toBe(false);
    }
  });

  it("treats an unreadable timestamp as stale", () => {
    // Defending it as fresh would block every future run for this client.
    expect(isStale({ status: "running", created_at: null }, now)).toBe(true);
    expect(isStale({ status: "running", created_at: "not a date" }, now)).toBe(true);
  });
});
