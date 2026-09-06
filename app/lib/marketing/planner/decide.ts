import { isChannel, type Channel } from "../posting-windows";
import { llmJson } from "../llm";
import { PLANNER_DECIDE_PROMPT } from "./prompt";
import {
  MAX_BODY_ITEMS,
  MAX_BODY_ITEM_CHARS,
  MAX_BRIEF_CHARS,
  MAX_CTA_CHARS,
  MAX_HOOK_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_THEME_CHARS,
  type CampaignStatus,
  type CampaignWindow,
  type Fill,
  type Gap,
  type Observation,
} from "./types";

// DECIDE — the only part of the planner that talks to a model, and the only
// part allowed to fail. It cannot throw: a run whose LLM call dies still has
// correct dates and channels, which is a degraded product rather than a dead
// one, so the failure path returns a skeleton instead of an error.

/** How many gaps to send in one call before splitting by week. */
const MAX_GAPS_PER_CALL = 40;

/** Constrained selection, not ideation — much lower than campaign generation's 0.8. */
const TEMPERATURE = 0.4;

export interface GapRequest {
  gap_id: string;
  week: string;
  type: string;
  index_in_week: number;
  of_in_week: number;
  allowed_channels: Channel[];
  default_channel: Channel;
  eligible_campaign_ids: string[];
}

export interface DecideRequest {
  today: string;
  timezone: string;
  business: Record<string, unknown>;
  content_pillars: string[];
  campaigns: Record<string, unknown>[];
  recent_themes: { date: string; type: string; theme: string }[];
  gaps: GapRequest[];
}

export interface DecideResult {
  fills: Fill[];
  warnings: string[];
  degraded: boolean;
}

export type DecideFn = (request: DecideRequest) => Promise<DecideResult>;

/**
 * Expand each (week, type) gap into one request entry per missing piece.
 *
 * A gap of "post × 3" must become three ids, not one: the model needs
 * index_in_week / of_in_week to make the three genuinely different. One gap
 * yielding one theme produces three identical posts.
 */
export function expandGapIds(gaps: Gap[]): GapRequest[] {
  const out: GapRequest[] = [];
  for (const gap of gaps) {
    for (let i = 0; i < gap.deficit; i++) {
      out.push({
        gap_id: `${gap.weekKey}__${gap.type}__${i}`,
        week: gap.weekKey,
        type: gap.type,
        index_in_week: i,
        of_in_week: gap.deficit,
        allowed_channels: gap.allowedChannels,
        default_channel: gap.defaultChannel,
        eligible_campaign_ids: gap.eligibleCampaignIds,
      });
    }
  }
  return out;
}

export function buildDecideRequest(
  observation: Observation,
  campaigns: CampaignWindow[],
  statuses: CampaignStatus[],
  context: {
    business: Record<string, unknown>;
    pillars: string[];
    recentThemes: { date: string; type: string; theme: string }[];
  }
): DecideRequest {
  const byId = new Map(campaigns.map((c) => [c.id, c]));

  return {
    today: observation.today,
    timezone: observation.timezone,
    business: context.business,
    content_pillars: context.pillars,
    campaigns: statuses.map((s) => {
      const c = byId.get(s.campaignId);
      return {
        campaign_id: s.campaignId,
        title: s.title,
        description: c?.description ?? "",
        goal: c?.goal ?? "",
        key_message: c?.keyMessage ?? "",
        active_weeks: s.activeWeeks,
        window: { start: c?.startDate ?? null, end: c?.endDate ?? null },
        types_needed: c?.plannedByType ?? {},
        deficit: s.deficit,
        urgency: Number(s.urgency.toFixed(2)),
        timeline: c?.timeline ?? [],
      };
    }),
    recent_themes: context.recentThemes,
    gaps: expandGapIds(observation.gaps),
  };
}

/** Split a large request by week so one failed chunk degrades only its own gaps. */
export function chunkRequest(request: DecideRequest, maxGaps = MAX_GAPS_PER_CALL): DecideRequest[] {
  if (request.gaps.length <= maxGaps) return [request];

  const byWeek = new Map<string, GapRequest[]>();
  for (const gap of request.gaps) {
    const list = byWeek.get(gap.week) ?? [];
    list.push(gap);
    byWeek.set(gap.week, list);
  }
  return Array.from(byWeek.values()).map((gaps) => ({ ...request, gaps }));
}

/** A fully-formed fill with no theme, used whenever the model gives us nothing usable. */
export function skeletonFills(gaps: GapRequest[]): Fill[] {
  return gaps.map((gap) => ({
    gapId: gap.gap_id,
    campaignId: null,
    channel: gap.default_channel,
    theme: "",
    brief: "",
    rationale: "",
    hook: "",
    body: [],
    cta: "",
    needsTheme: true,
  }));
}

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The array sibling of clamp, capped on both axes.
 *
 * A model that returns a single string instead of an array is a common enough
 * slip to be worth absorbing rather than discarding — one beat is better than
 * none. Anything else becomes an empty list.
 */
function clampList(value: unknown, maxItems: number, maxChars: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw
    .map((entry) => clamp(entry, maxChars))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
}

/**
 * Validate the model's response against the exact request that produced it.
 *
 * The output set is seeded with skeletons and then overwritten, so it is always
 * exactly the requested gap ids by construction. "Degrade, never fail" is a
 * property of the data structure here, not a special case in an error branch.
 */
export function parseFills(
  raw: unknown,
  gaps: GapRequest[]
): { fills: Fill[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(gaps.map((g) => [g.gap_id, g]));
  const result = new Map(skeletonFills(gaps).map((f) => [f.gapId, f]));

  const rows = (raw as { fills?: unknown })?.fills;
  if (!Array.isArray(rows)) {
    warnings.push("The planner model returned no usable fills; kept the dated skeleton.");
    return { fills: Array.from(result.values()), warnings };
  }

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const gapId = typeof entry.gap_id === "string" ? entry.gap_id : "";
    const gap = byId.get(gapId);

    if (!gap) {
      warnings.push(`Ignored a fill for an unknown gap "${gapId}".`);
      continue;
    }
    if (seen.has(gapId)) {
      warnings.push(`Ignored a duplicate fill for "${gapId}".`);
      continue;
    }
    seen.add(gapId);

    // Channel: an out-of-set or missing pick both fall back to the computed
    // default, so there is one path rather than an error branch.
    let channel = gap.default_channel;
    if (typeof entry.channel === "string" && entry.channel !== gap.default_channel) {
      if (isChannel(entry.channel) && gap.allowed_channels.includes(entry.channel)) {
        channel = entry.channel;
      } else {
        warnings.push(`Channel "${entry.channel}" is not allowed for ${gapId}; used ${channel}.`);
      }
    }

    let campaignId: string | null = null;
    if (typeof entry.campaign_id === "string" && entry.campaign_id) {
      if (gap.eligible_campaign_ids.includes(entry.campaign_id)) {
        campaignId = entry.campaign_id;
      } else {
        warnings.push(
          `Campaign "${entry.campaign_id}" is not eligible for ${gapId}; planned from pillars instead.`
        );
      }
    }

    const theme = clamp(entry.theme, MAX_THEME_CHARS);
    if (!theme) warnings.push(`No theme returned for ${gapId}.`);

    result.set(gapId, {
      gapId,
      campaignId,
      channel,
      theme,
      brief: clamp(entry.brief, MAX_BRIEF_CHARS),
      rationale: clamp(entry.rationale, MAX_RATIONALE_CHARS),
      hook: clamp(entry.hook, MAX_HOOK_CHARS),
      body: clampList(entry.body, MAX_BODY_ITEMS, MAX_BODY_ITEM_CHARS),
      cta: clamp(entry.cta, MAX_CTA_CHARS),
      needsTheme: theme === "",
    });
  }

  const missing = gaps.filter((g) => !seen.has(g.gap_id));
  if (missing.length > 0) {
    warnings.push(`The model returned no fill for ${missing.length} slot(s); they need a theme.`);
  }

  return { fills: Array.from(result.values()), warnings };
}

/** Never throws. A failed call yields a dated skeleton and a warning. */
export const decide: DecideFn = async (request) => {
  const chunks = chunkRequest(request);
  const fills: Fill[] = [];
  const warnings: string[] = [];
  let degraded = false;

  for (const chunk of chunks) {
    try {
      const raw = await llmJson({
        systemPrompt: PLANNER_DECIDE_PROMPT,
        payload: chunk,
        temperature: TEMPERATURE,
      });
      const parsed = parseFills(raw, chunk.gaps);
      fills.push(...parsed.fills);
      warnings.push(...parsed.warnings);
      if (parsed.fills.every((f) => f.needsTheme)) degraded = true;
    } catch (error) {
      fills.push(...skeletonFills(chunk.gaps));
      warnings.push(
        `Planner model call failed: ${
          error instanceof Error ? error.message : "unknown error"
        }. Dates and channels are still correct; themes are missing.`
      );
      degraded = true;
    }
  }

  return { fills, warnings, degraded };
};
