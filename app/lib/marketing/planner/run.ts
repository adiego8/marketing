import { isChannel, type Channel } from "../posting-windows";
import { listCampaigns } from "../campaigns";
import { getStrategy } from "../strategy";
import type { QuotaEntry } from "../strategy";
import { buildDecideRequest, decide, type DecideFn } from "./decide";
import { observe } from "./observe";
import {
  createPlanRun,
  fingerprintInputs,
  loadPlannerSlots,
  loadRecentThemes,
  toCampaignWindow,
} from "./plan-runs";
import { mintSlotId } from "./slot-id";
import {
  type CampaignWindow,
  type Deferred,
  type ExistingSlot,
  type Observation,
  type PlanStatus,
  type ProposedSlot,
} from "./types";

// Orchestration. Split in two on purpose:
//
//   planFromInputs  — everything pre-loaded, decideFn injectable. Testable end
//                     to end with no Firestore and no OpenAI.
//   previewPlan     — loads from Firestore, calls the above, persists the run.
//
// There is no assign stage. A piece is written for a campaign and carries no
// date; a person gives it one on the Schedule page. That is what removed the
// class of bug where a piece was generated in a week its campaign was not
// running in, and so arrived attributed to nothing.

export class NoActiveCampaignsError extends Error {
  constructor() {
    super(
      "No active campaigns. The planner writes what a campaign's content plan asks for, so accept a campaign before planning."
    );
    this.name = "NoActiveCampaignsError";
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
  quota: Record<string, QuotaEntry>;
  slots: ExistingSlot[];
  campaigns: CampaignWindow[];
  pillars: string[];
  business: Record<string, unknown>;
  strategyChannels: Channel[];
  recentThemes: { date: string | null; type: string; theme: string }[];
  /** Only for stamping proposed slots; nothing here computes a date. */
  timezone: string;
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
  const warnings: string[] = [];

  const observation = observe({
    quota: inputs.quota,
    slots: inputs.slots,
    campaigns: inputs.campaigns,
    strategyChannels: inputs.strategyChannels,
  });
  warnings.push(...observation.warnings);

  const fingerprint = fingerprintInputs({
    quota: inputs.quota,
    campaigns: inputs.campaigns,
    slots: inputs.slots,
  });

  // Nothing owed is a legitimate outcome, distinct from a failure: skip the
  // LLM entirely and still record the run so the observation is auditable.
  if (observation.totalOutstanding === 0) {
    return {
      status: "noop",
      observation,
      proposedSlots: [],
      deferred: [],
      warnings,
      inputsFingerprint: fingerprint,
      llm: { called: false, degraded: false, durationMs: 0 },
    };
  }

  const request = buildDecideRequest(observation, inputs.campaigns, {
    business: inputs.business,
    pillars: inputs.pillars,
    recentThemes: inputs.recentThemes
      .filter((t): t is { date: string; type: string; theme: string } => t.date !== null)
      .map((t) => ({ date: t.date, type: t.type, theme: t.theme })),
  });

  const started = Date.now();
  const decision = await decideFn(request);
  const durationMs = Date.now() - started;
  warnings.push(...decision.warnings);

  const byGapId = new Map(request.gaps.map((g) => [g.gap_id, g]));
  const titles = new Map(inputs.campaigns.map((c) => [c.id, c.title]));

  // Ids are minted against everything the client already has, so a piece
  // already delivered against this campaign never has its id reused. See
  // slot-id.ts — the id is derived from the demand, not from a date.
  const taken = new Set(inputs.slots.map((s) => s.id));

  const proposedSlots: ProposedSlot[] = [];
  const deferred: Deferred[] = [];

  for (const fill of decision.fills) {
    const gap = byGapId.get(fill.gapId);
    if (!gap) continue;

    // parseFills only accepts a campaign_id from eligible_campaign_ids, which
    // holds exactly one id. A null here means the model returned something
    // else and it was rejected, so fall back to the campaign that asked.
    const campaignId = fill.campaignId ?? gap.eligible_campaign_ids[0];
    if (!campaignId) {
      deferred.push({
        gapId: fill.gapId,
        type: gap.type,
        channel: fill.channel,
        reason: "No campaign asked for this piece, so there is nothing to attribute it to.",
      });
      continue;
    }

    proposedSlots.push({
      slotId: mintSlotId(taken, inputs.clientId, campaignId, gap.type),
      gapId: fill.gapId,
      // Undated by design. A person sets all four on the Schedule page.
      weekKey: null,
      date: null,
      timeLocal: null,
      timezone: inputs.timezone,
      scheduledAt: null,
      type: gap.type,
      channel: fill.channel,
      campaignId,
      campaignTitle: titles.get(campaignId) ?? "",
      theme: fill.theme,
      brief: fill.brief,
      rationale: fill.rationale,
      hook: fill.hook,
      body: fill.body,
      cta: fill.cta,
      needsTheme: fill.needsTheme,
    });
  }

  return {
    status:
      proposedSlots.length === 0
        ? "noop"
        : decision.degraded
          ? "degraded"
          : "proposed",
    observation,
    proposedSlots,
    deferred,
    warnings,
    inputsFingerprint: fingerprint,
    llm: { called: true, degraded: decision.degraded, durationMs },
  };
}

/** Load everything, plan, and persist the run. Writes NO slots — that is commit. */
export async function previewPlan(clientId: string, opts: { timezone: string }) {
  const strategy = await getStrategy(clientId);
  if (!strategy) throw new NoStrategyError();

  // The quota is not the demand and not a gate: it paces scheduling, which
  // happens later and by hand. An empty one is entirely workable.
  const quota = (strategy.content_quota?.weekly ?? {}) as Record<string, QuotaEntry>;

  const [allCampaigns, slots, recentThemes] = await Promise.all([
    listCampaigns(clientId, "active"),
    loadPlannerSlots(clientId),
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
    // What each campaign owed when this ran. Replaces the horizon, which meant
    // nothing once planning stopped placing dates.
    demand: result.observation.campaigns,
    observation: result.observation,
    proposedSlots: result.proposedSlots,
    droppedSlots: [],
    deferred: result.deferred,
    warnings: result.warnings,
    inputsFingerprint: result.inputsFingerprint,
    llm: result.llm,
    createdSlotIds: [],
    committedAt: null,
  });
}
