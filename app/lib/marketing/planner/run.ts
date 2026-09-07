import { DateTime } from "luxon";
import { isChannel, type Channel } from "../posting-windows";
import { listCampaigns } from "../campaigns";
import { getStrategy } from "../strategy";
import type { QuotaEntry } from "../strategy";
import { assign } from "./assign";
import { buildDecideRequest, decide, type DecideFn } from "./decide";
import { observe } from "./observe";
import {
  createPlanRun,
  fingerprintInputs,
  loadPlannerSlots,
  loadRecentThemes,
  toCampaignWindow,
} from "./plan-runs";
import {
  MAX_HORIZON_WEEKS,
  MIN_HORIZON_WEEKS,
  type CampaignWindow,
  type Deferred,
  type ExistingSlot,
  type Observation,
  type PlanStatus,
  type ProposedSlot,
} from "./types";
import { horizonWeeks, todayIn, zoneOrUTC } from "./weeks";

// Orchestration. Split in two on purpose:
//
//   planFromInputs  — everything pre-loaded, decideFn injectable. Testable end
//                     to end with no Firestore and no OpenAI.
//   previewPlan     — loads from Firestore, calls the above, persists the run.

export class NoActiveCampaignsError extends Error {
  constructor() {
    super(
      "No active campaigns. The planner schedules what a campaign's content plan asks for, so accept a campaign before planning."
    );
    this.name = "NoActiveCampaignsError";
  }
}

export class EmptyQuotaError extends Error {
  constructor() {
    super(
      "This client has no weekly content quota. Set one in Strategy > Content Quota before planning."
    );
    this.name = "EmptyQuotaError";
  }
}

export class NoStrategyError extends Error {
  constructor() {
    super("No strategy configured for this client.");
    this.name = "NoStrategyError";
  }
}

export interface PlannerInputs {
  clientId: string;
  timezone: string;
  now: Date;
  horizonWeeks: number;
  quota: Record<string, QuotaEntry>;
  slots: ExistingSlot[];
  campaigns: CampaignWindow[];
  pillars: string[];
  business: Record<string, unknown>;
  strategyChannels: Channel[];
  recentThemes: { date: string; type: string; theme: string }[];
}

export interface PlanResult {
  status: PlanStatus;
  observation: Observation;
  proposedSlots: ProposedSlot[];
  deferred: Deferred[];
  warnings: string[];
  inputsFingerprint: string;
  llm: { called: boolean; degraded: boolean; durationMs: number };
}

export async function planFromInputs(
  inputs: PlannerInputs,
  decideFn: DecideFn = decide
): Promise<PlanResult> {
  const { zone, warning: zoneWarning } = zoneOrUTC(inputs.timezone);
  const warnings: string[] = zoneWarning ? [zoneWarning] : [];

  const weeks = Math.min(
    MAX_HORIZON_WEEKS,
    Math.max(MIN_HORIZON_WEEKS, Math.floor(inputs.horizonWeeks))
  );
  if (weeks !== inputs.horizonWeeks) {
    warnings.push(`Horizon clamped to ${weeks} week(s).`);
  }

  const observation = observe({
    timezone: zone,
    now: inputs.now,
    horizonWeeks: weeks,
    quota: inputs.quota,
    slots: inputs.slots,
    campaigns: inputs.campaigns,
    strategyChannels: inputs.strategyChannels,
  });
  warnings.push(...observation.warnings);

  const spans = horizonWeeks(todayIn(zone, DateTime.fromJSDate(inputs.now).setZone(zone)), weeks, zone);
  const fingerprint = fingerprintInputs({
    quota: inputs.quota,
    campaigns: inputs.campaigns,
    slots: inputs.slots,
    startDate: observation.startDate,
    endDate: observation.endDate,
    timezone: zone,
  });

  // Nothing to do is a legitimate outcome, distinct from a failure: skip the
  // LLM entirely and still record the run so the observation is auditable.
  if (observation.totalDeficit === 0) {
    return {
      status: "noop",
      observation,
      proposedSlots: [],
      deferred: [],
      // observe already explains WHY there is nothing: no active campaign, or
      // every campaign plan delivered. Repeating "meets its quota" here would
      // contradict it, since the quota is no longer the demand.
      warnings: [...warnings, ...observation.warnings],
      inputsFingerprint: fingerprint,
      llm: { called: false, degraded: false, durationMs: 0 },
    };
  }

  if (inputs.campaigns.length === 0) {
    warnings.push("No active campaigns — planning from content pillars.");
  }
  if (inputs.campaigns.length === 0 && inputs.pillars.length === 0) {
    warnings.push(
      "No campaigns and no content pillars, so themes will be generic. Add pillars in Strategy."
    );
  }

  const request = buildDecideRequest(observation, inputs.campaigns, observation.campaigns, {
    business: inputs.business,
    pillars: inputs.pillars,
    recentThemes: inputs.recentThemes,
  });

  const started = Date.now();
  const decision = await decideFn(request);
  const durationMs = Date.now() - started;
  warnings.push(...decision.warnings);

  const gapsByGapId = new Map(
    request.gaps.map((g) => [
      g.gap_id,
      observation.gaps.find((gap) => gap.weekKey === g.week && gap.type === g.type)!,
    ])
  );

  const { proposed, deferred } = assign({
    clientId: inputs.clientId,
    timezone: zone,
    now: inputs.now,
    spans,
    gapsByGapId,
    fills: decision.fills,
    existing: inputs.slots,
    campaigns: new Map(inputs.campaigns.map((c) => [c.id, c])),
  });

  if (deferred.length > 0) {
    warnings.push(
      `${deferred.length} slot(s) could not be placed — see the deferred list for why.`
    );
  }

  return {
    // Nothing placed is "noop" even when there WAS a deficit. Reaching assign
    // and coming back empty — every eligible day full, no channel able to
    // carry the type — is still nothing to accept, and calling it "proposed"
    // put a blue "ready" pill on a plan with no slots in it.
    status:
      proposed.length === 0
        ? "noop"
        : decision.degraded
          ? "degraded"
          : "proposed",
    observation,
    proposedSlots: proposed,
    deferred,
    warnings,
    inputsFingerprint: fingerprint,
    llm: { called: true, degraded: decision.degraded, durationMs },
  };
}

/** Load everything, plan, and persist the run. Writes NO slots — that is Phase 3. */
export async function previewPlan(
  clientId: string,
  opts: { timezone: string; horizonWeeks?: number; now?: Date } = { timezone: "UTC" }
) {
  const strategy = await getStrategy(clientId);
  if (!strategy) throw new NoStrategyError();

  // The quota is no longer the demand, only the weekly pace limit and the
  // channel preference, so an empty one is workable — the campaign then sets
  // its own pace. What cannot be worked around is having no campaign at all.
  const quota = (strategy.content_quota?.weekly ?? {}) as Record<string, QuotaEntry>;

  const now = opts.now ?? new Date();
  const weeks = opts.horizonWeeks ?? 2;
  const { zone } = zoneOrUTC(opts.timezone);
  const spans = horizonWeeks(todayIn(zone, DateTime.fromJSDate(now).setZone(zone)), weeks, zone);

  const [allCampaigns, slots, recentThemes] = await Promise.all([
    listCampaigns(clientId, "active"),
    loadPlannerSlots(clientId, spans[0].start, spans[spans.length - 1].end),
    loadRecentThemes(clientId),
  ]);

  if (allCampaigns.length === 0) throw new NoActiveCampaignsError();

  const contentStrategy = (strategy.content_strategy ?? {}) as {
    platforms?: unknown;
    content_pillars?: unknown;
  };

  const result = await planFromInputs({
    clientId,
    timezone: opts.timezone,
    now,
    horizonWeeks: weeks,
    quota,
    slots,
    campaigns: allCampaigns.map(toCampaignWindow),
    pillars: Array.isArray(contentStrategy.content_pillars)
      ? contentStrategy.content_pillars.filter((p): p is string => typeof p === "string")
      : [],
    business: {
      name: strategy.business_name,
      icp: strategy.icp,
      voice: strategy.voice,
      positioning: strategy.positioning,
      goals: strategy.goals,
    },
    strategyChannels: Array.isArray(contentStrategy.platforms)
      ? (contentStrategy.platforms.filter(isChannel) as Channel[])
      : [],
    recentThemes,
  });

  return createPlanRun(clientId, {
    status: result.status,
    horizon: {
      weeks: result.observation.weeks,
      startDate: result.observation.startDate,
      endDate: result.observation.endDate,
      timezone: result.observation.timezone,
      horizonWeeks: weeks,
    },
    observation: result.observation,
    proposedSlots: result.proposedSlots,
    deferred: result.deferred,
    warnings: result.warnings,
    inputsFingerprint: result.inputsFingerprint,
    llm: result.llm,
    createdSlotIds: [],
    committedAt: null,
  });
}
