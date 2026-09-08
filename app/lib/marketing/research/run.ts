// Orchestration for a research run: two searches, a synthesis, and the rules
// about what to do when one of them fails.
//
// It decides nothing about the CONTENT — every judgement about what came back
// lives in parse.ts, which is pure and therefore tested. This file is the model
// calls and the guards around them, following lib/marketing/write-copy.ts.

import { llmJson, llmSearchJson, RESEARCH_MODEL } from "../llm";
import {
  SITE_RESEARCH_PROMPT,
  WEB_RESEARCH_PROMPT,
  DRAFT_STRATEGY_PROMPT,
} from "./prompts";
import {
  domainOf,
  parseDossier,
  type Steer,
  mergeDossiers,
  parseDraftStrategy,
  openQuestionsFor,
  EMPTY_DOSSIER,
  type Dossier,
  type DraftStrategy,
} from "./parse";

export type ResearchStatus = "complete" | "degraded" | "insufficient";

export interface ResearchInputs {
  business_name: string;
  website: string | null;
  domain: string | null;
  notes: string | null;
  /** The operator's direction, kept so a re-run can start from it. */
  steer: string;
  competitors: string[];
}

export interface ResearchResult {
  status: ResearchStatus;
  inputs: ResearchInputs;
  dossier: Dossier;
  draft_strategy: DraftStrategy;
  open_questions: string[];
  sources: string[];
  warnings: string[];
  llm: { model: string; searches: number; duration_ms: number };
}

/** Both passes failed, so there is nothing to review and nothing to store. */
export class ResearchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchFailedError";
  }
}

/* ------------------------------------------------------------------ seams -- */

export interface SearchCall {
  systemPrompt: string;
  payload: unknown;
  allowedDomains?: string[];
}
export type SearchFn = (call: SearchCall) => Promise<{ data: unknown; sources: string[] }>;
export type DraftFn = (payload: unknown) => Promise<unknown>;

/**
 * Called as each slow step begins, so a caller can write it somewhere a waiting
 * human can see. The work takes minutes; a disabled button for that long reads
 * as broken however honest it is.
 */
export type ProgressFn = (step: string) => void | Promise<void>;

const defaultSearch: SearchFn = (call) => llmSearchJson(call);
const defaultDraft: DraftFn = (payload) =>
  llmJson({ systemPrompt: DRAFT_STRATEGY_PROMPT, payload, temperature: 0.4 });

/**
 * The user message for a search pass.
 *
 * Exported and pure for the same reason buildCopyPayload is in write-copy.ts:
 * what the model is told is worth asserting without spending a search on it.
 *
 * steer and competitors are ALWAYS present, normalised to empty — matching
 * write-copy.ts:72 — which is what lets the prompts say "may be empty" rather
 * than having to handle a missing key.
 */
export function buildSearchPayload(
  base: { business_name: string; website: string | null; notes: string | null },
  steer: Steer,
  known?: unknown
): Record<string, unknown> {
  return {
    ...base,
    steer: steer.steer.trim(),
    competitors: steer.competitors,
    ...(known === undefined ? {} : { known }),
  };
}

/* -------------------------------------------------------------------- run -- */

export interface ResearchClientInput {
  name: string;
  website_url?: string | null;
  description?: string | null;
}

/**
 * Research a company and draft a strategy from what was found.
 *
 * Writes nothing. The caller stores the result as a run document, and a human
 * accepts it into the strategy — research proposes, it never commits.
 */
export async function researchClient(
  client: ResearchClientInput,
  opts: {
    searchFn?: SearchFn;
    draftFn?: DraftFn;
    onProgress?: ProgressFn;
    steer?: Steer;
  } = {}
): Promise<ResearchResult> {
  const searchFn = opts.searchFn ?? defaultSearch;
  const draftFn = opts.draftFn ?? defaultDraft;
  const steer: Steer = opts.steer ?? { steer: "", competitors: [] };
  const report = async (step: string) => {
    // Progress is a courtesy. A store that will not take it must never be the
    // reason the research itself fails.
    try {
      await opts.onProgress?.(step);
    } catch {
      // ignored on purpose
    }
  };
  const started = Date.now();

  const website = client.website_url?.trim() || null;
  const domain = domainOf(website);
  const inputs: ResearchInputs = {
    business_name: client.name,
    website,
    domain,
    notes: client.description?.trim() || null,
    steer: steer.steer.trim(),
    competitors: steer.competitors,
  };

  // The precondition guard, as in write-copy.ts:96-100. Without a site to read,
  // "research" is the model recalling what it may have seen about a small
  // business — which is how a strategy full of invented facts gets written.
  if (!domain) {
    const { strategy } = parseDraftStrategy(null, [], client.name);
    return {
      status: "insufficient",
      inputs,
      dossier: EMPTY_DOSSIER,
      draft_strategy: strategy,
      open_questions: openQuestionsFor(strategy, EMPTY_DOSSIER),
      sources: [],
      warnings: [
        website
          ? `"${website}" is not a website address this can read. Fix it on the client and run again.`
          : "This client has no website, and there is nothing else to research from. Add one and run again.",
      ],
      llm: { model: RESEARCH_MODEL, searches: 0, duration_ms: Date.now() - started },
    };
  }

  const warnings: string[] = [];
  const sources: string[] = [];
  let searches = 0;

  const base = { business_name: client.name, website, notes: inputs.notes };

  // Pass one: their own site. Scoped with allowed_domains so OpenAI fetches the
  // pages — this app never requests a URL a user supplied, which is what keeps
  // an unvalidated website_url from being an SSRF.
  let site = EMPTY_DOSSIER;
  let siteFailed = false;
  await report(`Reading ${domain}`);
  try {
    const result = await searchFn({
      systemPrompt: SITE_RESEARCH_PROMPT,
      payload: buildSearchPayload(base, steer),
      allowedDomains: [domain],
    });
    searches++;
    sources.push(...result.sources);
    const parsed = parseDossier(result.data, result.sources);
    site = parsed.dossier;
    warnings.push(...parsed.warnings);
  } catch (error) {
    siteFailed = true;
    warnings.push(`Could not read ${domain}: ${message(error)}`);
  }

  // Pass two: everyone else. Told what the site pass already established so it
  // spends its search on competitors and customer language instead of repeating.
  let web = EMPTY_DOSSIER;
  let webFailed = false;
  await report("Looking at competitors and what customers say");
  try {
    const result = await searchFn({
      systemPrompt: WEB_RESEARCH_PROMPT,
      payload: buildSearchPayload(base, steer, site.company),
    });
    searches++;
    sources.push(...result.sources);
    const parsed = parseDossier(result.data, result.sources);
    web = parsed.dossier;
    warnings.push(...parsed.warnings);
  } catch (error) {
    webFailed = true;
    warnings.push(`The open-web pass failed: ${message(error)}`);
  }

  if (siteFailed && webFailed) {
    throw new ResearchFailedError(
      "Both research passes failed, so there is nothing to review. Nothing was changed."
    );
  }

  const dossier = mergeDossiers(site, web);
  const cited = [...new Set(sources)];

  if (!dossier.company.description && !dossier.company.value_proposition) {
    warnings.push(
      "Neither pass found anything describing what this company does. Treat the draft as a blank page."
    );
  }

  await report("Drafting the strategy");
  let raw: unknown;
  try {
    raw = await draftFn({
      business_name: client.name,
      dossier,
      steer: steer.steer.trim(),
    });
  } catch (error) {
    throw new ResearchFailedError(`The strategy draft failed: ${message(error)}`);
  }

  const { strategy, warnings: draftWarnings } = parseDraftStrategy(raw, cited, client.name);
  warnings.push(...draftWarnings);

  return {
    status: siteFailed || webFailed ? "degraded" : "complete",
    inputs,
    dossier,
    draft_strategy: strategy,
    open_questions: openQuestionsFor(strategy, dossier),
    sources: cited,
    warnings,
    llm: { model: RESEARCH_MODEL, searches, duration_ms: Date.now() - started },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
