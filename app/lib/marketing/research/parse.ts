// Everything the research service decides is decided here, in pure functions,
// so it can be tested without a network call — the same split write-copy.ts
// makes between the model call and the judgement about its result.
//
// The prompts ask the model for these shapes. This file assumes it did not
// comply. Research output ends up in a strategy that feeds every campaign and
// every published post, so "the prompt said so" is not a guarantee: what the
// prompt requests, the parser enforces (see planner/regenerate.ts:133-135 for
// the same rule applied to slot themes).

import { CHANNELS, MAX_SLOTS_PER_DAY, type Channel } from "../posting-windows";
import { contentType } from "../content-types";
import { slugify } from "../demographics";

/* ------------------------------------------------------------------ caps -- */

const MAX_LIST = 8;
const MAX_SHORT = 200;
const MAX_LONG = 1200;
const MAX_COMPETITORS = 6;
const MAX_QUOTA_TOTAL = MAX_SLOTS_PER_DAY * 7;

function str(value: unknown, cap = MAX_SHORT): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function list(value: unknown, cap = MAX_LIST, itemCap = MAX_SHORT): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = str(item, itemCap);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === cap) break;
  }
  return out;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/* ---------------------------------------------------------------- domain -- */

/**
 * The host to scope a site search to.
 *
 * website_url is stored with no validation at all (clients.ts:29-33 only
 * trims), so this takes whatever is there — a bare domain, a full URL, a typo —
 * and returns a host or null. Null means "do not run the site pass", never
 * "search the whole web instead": silently widening the search would turn a
 * malformed field into unsourced guessing.
 */
export function domainOf(url: unknown): string | null {
  const raw = str(url, 300);
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host: string;
  try {
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  // A hostname with no dot is a local name, not a site we can research.
  if (!host.includes(".") || host.endsWith(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/** The hosts behind a set of cited URLs, for checking a claimed source. */
export function hostsOf(urls: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = domainOf(url);
    if (host) hosts.add(host);
  }
  return hosts;
}

/* --------------------------------------------------------------- dossier -- */

export interface Evidence {
  claim: string;
  source: string;
}

export interface Competitor {
  name: string;
  url: string | null;
  positioning: string;
  strengths: string[];
  weaknesses: string[];
}

export interface Gap {
  gap: string;
  opportunity: string;
}

export interface Dossier {
  company: {
    description: string;
    products_services: string[];
    value_proposition: string;
    current_positioning: string;
    stage: string;
  };
  audience: {
    primary: string;
    pain_points: string[];
    desired_outcomes: string[];
    trigger_events: string[];
    objections: string[];
    where_they_are: string[];
  };
  /** Verifiable statements, each tied to a page that actually said it. */
  evidence: Evidence[];
  voice_samples: string[];
  competitors: Competitor[];
  gaps: Gap[];
}

export const EMPTY_DOSSIER: Dossier = {
  company: {
    description: "",
    products_services: [],
    value_proposition: "",
    current_positioning: "",
    stage: "",
  },
  audience: {
    primary: "",
    pain_points: [],
    desired_outcomes: [],
    trigger_events: [],
    objections: [],
    where_they_are: [],
  },
  evidence: [],
  voice_samples: [],
  competitors: [],
  gaps: [],
};

/**
 * Read a dossier out of whatever the model returned.
 *
 * `cited` is the list of URLs the web_search tool actually annotated. A piece
 * of evidence whose source is not among those hosts is dropped: the model
 * naming a URL is not proof it read one, and evidence is what later becomes a
 * public claim about the client's business.
 */
export function parseDossier(
  raw: unknown,
  cited: string[]
): { dossier: Dossier; warnings: string[] } {
  const warnings: string[] = [];
  const r = obj(raw);
  const company = obj(r.company);
  const audience = obj(r.audience);
  const hosts = hostsOf(cited);

  const evidence: Evidence[] = [];
  let unsourced = 0;
  for (const item of Array.isArray(r.evidence) ? r.evidence : []) {
    const e = obj(item);
    const claim = str(e.claim, MAX_SHORT);
    const source = str(e.source, 500);
    if (!claim) continue;
    const host = domainOf(source);
    if (!host || !hosts.has(host)) {
      unsourced++;
      continue;
    }
    evidence.push({ claim, source });
    if (evidence.length === MAX_LIST) break;
  }
  if (unsourced > 0) {
    warnings.push(
      `Dropped ${unsourced} finding${unsourced === 1 ? "" : "s"} that cited no page the search actually read.`
    );
  }

  const competitors: Competitor[] = [];
  for (const item of Array.isArray(r.competitors) ? r.competitors : []) {
    // A bare string is a name with nothing behind it — keep the name.
    if (typeof item === "string") {
      const name = str(item);
      if (name) competitors.push({ name, url: null, positioning: "", strengths: [], weaknesses: [] });
    } else {
      const c = obj(item);
      const name = str(c.name);
      if (!name) continue;
      const host = domainOf(c.url);
      competitors.push({
        name,
        url: host ? `https://${host}` : null,
        positioning: str(c.positioning),
        strengths: list(c.strengths, 4),
        weaknesses: list(c.weaknesses, 4),
      });
    }
    if (competitors.length === MAX_COMPETITORS) break;
  }

  const gaps: Gap[] = [];
  for (const item of Array.isArray(r.gaps) ? r.gaps : []) {
    const g = obj(item);
    const gap = str(g.gap);
    if (!gap) continue;
    gaps.push({ gap, opportunity: str(g.opportunity) });
    if (gaps.length === MAX_LIST) break;
  }

  const dossier: Dossier = {
    company: {
      description: str(company.description, MAX_LONG),
      products_services: list(company.products_services),
      value_proposition: str(company.value_proposition, MAX_LONG),
      current_positioning: str(company.current_positioning, MAX_LONG),
      stage: str(company.stage, 40),
    },
    audience: {
      primary: str(audience.primary, MAX_LONG),
      pain_points: list(audience.pain_points),
      desired_outcomes: list(audience.desired_outcomes),
      trigger_events: list(audience.trigger_events),
      objections: list(audience.objections),
      where_they_are: list(audience.where_they_are),
    },
    evidence,
    voice_samples: list(r.voice_samples, 5, MAX_LONG),
    competitors,
    gaps,
  };

  return { dossier, warnings };
}

/** Merge the site pass and the open-web pass, preferring the site for facts. */
export function mergeDossiers(site: Dossier, web: Dossier): Dossier {
  const pick = (a: string, b: string) => a || b;
  const join = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, MAX_LIST);
  return {
    company: {
      description: pick(site.company.description, web.company.description),
      products_services: join(site.company.products_services, web.company.products_services),
      value_proposition: pick(site.company.value_proposition, web.company.value_proposition),
      current_positioning: pick(site.company.current_positioning, web.company.current_positioning),
      stage: pick(site.company.stage, web.company.stage),
    },
    audience: {
      primary: pick(site.audience.primary, web.audience.primary),
      pain_points: join(site.audience.pain_points, web.audience.pain_points),
      desired_outcomes: join(site.audience.desired_outcomes, web.audience.desired_outcomes),
      trigger_events: join(site.audience.trigger_events, web.audience.trigger_events),
      objections: join(site.audience.objections, web.audience.objections),
      where_they_are: join(site.audience.where_they_are, web.audience.where_they_are),
    },
    evidence: [...site.evidence, ...web.evidence].slice(0, MAX_LIST),
    voice_samples: join(site.voice_samples, web.voice_samples).slice(0, 5),
    // Competitors and gaps come from the open web; the company's own site is
    // not a source on who it competes with.
    competitors: [...web.competitors, ...site.competitors].slice(0, MAX_COMPETITORS),
    gaps: [...web.gaps, ...site.gaps].slice(0, MAX_LIST),
  };
}

/* ---------------------------------------------------------- draft strategy -- */

export interface DraftStrategy {
  business_name: string;
  icp: Record<string, unknown>;
  voice: Record<string, unknown>;
  positioning: Record<string, unknown>;
  messaging: Record<string, unknown>;
  goals: Record<string, unknown>;
  content_strategy: Record<string, unknown>;
  content_quota: { weekly: Record<string, { count: number; channels: Channel[] }>; rationale: string };
}

function angle(value: unknown): { type: string; statement: string; why: string } {
  const a = obj(value);
  return {
    type: slugify(str(a.type, 40)),
    statement: str(a.statement, MAX_LONG),
    why: str(a.why, MAX_LONG),
  };
}

function demographics(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(obj(value))) {
    const slug = slugify(key);
    const text = str(raw);
    if (slug && text) out[slug] = text;
  }
  return out;
}

function channels(value: unknown, allowed: readonly string[]): Channel[] {
  const out: Channel[] = [];
  for (const c of Array.isArray(value) ? value : []) {
    const name = str(c, 40).toLowerCase();
    if (allowed.includes(name) && !out.includes(name as Channel)) out.push(name as Channel);
  }
  return out;
}

/**
 * Turn the model's strategy into one the editor and the planner can both read.
 *
 * The important rule is proof_points. Every other field is an opinion a human
 * reviews; a proof point is a factual claim that ends up in published copy, so
 * it survives only if it names a page the search actually read. The model does
 * not get the benefit of the doubt on this one field.
 */
export function parseDraftStrategy(
  raw: unknown,
  cited: string[],
  fallbackName: string
): { strategy: DraftStrategy; warnings: string[] } {
  const warnings: string[] = [];
  const r = obj(raw);
  const hosts = hostsOf(cited);

  const icp = obj(r.icp);
  const voice = obj(r.voice);
  const positioning = obj(r.positioning);
  const messaging = obj(r.messaging);
  const goals = obj(r.goals);
  const contentStrategy = obj(r.content_strategy);
  const quota = obj(r.content_quota);

  // Proof points arrive as { claim, source } and are stored as plain strings,
  // which is what the strategy schema holds.
  const proof: string[] = [];
  let dropped = 0;
  for (const item of Array.isArray(messaging.proof_points) ? messaging.proof_points : []) {
    const p = obj(item);
    const claim = str(typeof item === "string" ? item : p.claim, MAX_SHORT);
    const host = domainOf(typeof item === "string" ? "" : p.source);
    if (!claim) continue;
    if (!host || !hosts.has(host)) {
      dropped++;
      continue;
    }
    if (!proof.includes(claim)) proof.push(claim);
    if (proof.length === MAX_LIST) break;
  }
  if (dropped > 0) {
    warnings.push(
      `Dropped ${dropped} proof point${dropped === 1 ? "" : "s"} with no page behind ${dropped === 1 ? "it" : "them"}. Ask the client for the real numbers.`
    );
  }

  const secondary = (Array.isArray(positioning.secondary_angles) ? positioning.secondary_angles : [])
    .map(angle)
    .filter((a) => a.statement)
    .slice(0, 4);

  const platforms = channels(contentStrategy.platforms, CHANNELS);

  const weekly: Record<string, { count: number; channels: Channel[] }> = {};
  let total = 0;
  let overflow = false;
  for (const [key, value] of Object.entries(obj(quota.weekly))) {
    const spec = contentType(key);
    if (!spec || spec.retired || spec.component) {
      warnings.push(`Ignored a weekly quota for "${key}", which is not a format the planner schedules.`);
      continue;
    }
    const entry = obj(value);
    const asked = typeof entry.count === "number" ? Math.max(0, Math.floor(entry.count)) : 0;
    if (asked === 0) continue;
    // The planner places at most two pieces a day, so anything past the ceiling
    // is a permanent shortfall on every Coverage row rather than more content.
    const count = Math.min(asked, MAX_QUOTA_TOTAL - total);
    if (count < asked) overflow = true;
    if (count === 0) {
      overflow = true;
      continue;
    }
    const picked = channels(entry.channels, spec.channels);
    weekly[key] = { count, channels: picked.length ? picked : [...spec.channels] };
    total += count;
  }
  if (overflow) {
    warnings.push(
      `Trimmed the weekly quota to ${MAX_QUOTA_TOTAL} pieces, the most the planner can place at ${MAX_SLOTS_PER_DAY} a day.`
    );
  }

  const strategy: DraftStrategy = {
    business_name: str(r.business_name) || fallbackName,
    icp: {
      description: str(icp.description, MAX_LONG),
      demographics: demographics(icp.demographics),
      pain_points: list(icp.pain_points),
      desired_outcomes: list(icp.desired_outcomes),
      objections: list(icp.objections),
      trigger_events: list(icp.trigger_events),
    },
    voice: {
      personality: str(voice.personality, MAX_LONG),
      traits: list(voice.traits, 6, 40),
      tone: str(voice.tone, MAX_LONG),
      communication_style: str(voice.communication_style, MAX_LONG),
      words_to_use: list(voice.words_to_use, 12, 60),
      words_to_avoid: list(voice.words_to_avoid, 12, 60),
    },
    positioning: {
      primary_angle: angle(positioning.primary_angle),
      secondary_angles: secondary,
      anti_positioning: str(positioning.anti_positioning, MAX_LONG),
      differentiation: str(positioning.differentiation, MAX_LONG),
    },
    messaging: {
      tagline: str(messaging.tagline, 120),
      value_props: list(messaging.value_props),
      key_messages: list(messaging.key_messages),
      proof_points: proof,
    },
    goals: {
      primary: str(goals.primary),
      secondary: str(goals.secondary),
      focus_90_days: str(goals.focus_90_days, MAX_LONG),
      metrics: list(goals.metrics),
    },
    content_strategy: {
      platforms,
      content_pillars: list(contentStrategy.content_pillars, 6),
    },
    content_quota: { weekly, rationale: str(quota.rationale, MAX_LONG) },
  };

  return { strategy, warnings };
}

/* -------------------------------------------------------- open questions -- */

/**
 * What research could not settle, phrased as questions to put to the client.
 *
 * Derived from what came back empty rather than asked of the model, so the list
 * is a fact about the draft instead of another guess about it. This is the
 * agenda for the validation call.
 */
export function openQuestionsFor(strategy: DraftStrategy, dossier: Dossier): string[] {
  const questions: string[] = [];
  const icp = strategy.icp as Record<string, string[] | unknown>;
  const messaging = strategy.messaging as Record<string, string[] | unknown>;
  const isEmpty = (v: unknown) => !Array.isArray(v) || v.length === 0;

  if (isEmpty(messaging.proof_points)) {
    questions.push(
      "What results can we actually claim in public? Numbers, named customers, guarantees — anything we can point at."
    );
  }
  if (isEmpty(icp.objections)) {
    questions.push("What do people say right before they decide not to buy?");
  }
  if (isEmpty(icp.trigger_events)) {
    questions.push("What happens in someone's life or business that makes them start looking for you?");
  }
  if (dossier.competitors.length === 0) {
    questions.push("Who do you lose deals to, and what do they say that you don't?");
  }
  if (dossier.voice_samples.length === 0) {
    questions.push("Is there anything you've published that sounds right? Two or three examples is enough.");
  }
  // Always asked: neither is discoverable from the outside, and both decide
  // whether the plan is achievable at all.
  questions.push("Who can actually make content each week — who films, who designs, who approves?");
  questions.push("Realistically, how many pieces a week can you sustain? A quota nobody can meet is worse than a small one.");
  return questions;
}
