import { isChannel, type Channel } from "../posting-windows";
import { getCampaign } from "../campaigns";
import { getStrategy } from "../strategy";
import { lessonsForPrompt } from "../lessons-store";
import type { QuotaEntry } from "../strategy";
import { buildDecideRequest, decide, type DecideFn } from "./decide";
import { observe } from "./observe";
import {
  createPlanRun,
  fingerprintInputs,
  loadPlannerSlots,
  loadRecentThemes,
  scopeToCampaign,
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

/**
 * Both messages keep the word "campaign": the campaign page and the error
 * banners pattern-match on /campaign/i to decide which guidance to render.
 */
export class CampaignNotFoundError extends Error {
  constructor() {
    super("That campaign does not exist for this client.");
    this.name = "CampaignNotFoundError";
  }
}

export class CampaignNotActiveError extends Error {
  constructor(title?: string) {
    super(
      `${title ? `The campaign "${title}"` : "That campaign"} is not active. ` +
        "The planner writes what a campaign's content plan asks for, so accept it before planning."
    );
    this.name = "CampaignNotActiveError";
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
  /** What the Learned page has taught for this client. */
  lessons: string[];
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
    lessons: inputs.lessons,
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

/**
 * Load everything, plan ONE campaign, and persist the run. Writes NO slots —
 * that is commit.
 *
 * Scoped to a single campaign, and that is the point. A run used to cover every
 * active campaign while the campaign workspace showed you only your own slice
 * of it — so accepting from inside one campaign committed content for the
 * others, which you never saw. The filter was on the display; it belongs here.
 */
export async function previewPlan(
  clientId: string,
  opts: { timezone: string; campaignId: string }
) {
  const strategy = await getStrategy(clientId);
  if (!strategy) throw new NoStrategyError();

  // The quota is not the demand and not a gate: it paces scheduling, which
  // happens later and by hand. An empty one is entirely workable.
  const quota = (strategy.content_quota?.weekly ?? {}) as Record<string, QuotaEntry>;

  const [campaign, allSlots, recentThemes, lessons] = await Promise.all([
    getCampaign(clientId, opts.campaignId),
    loadPlannerSlots(clientId),
    // Every theme this client has, whatever its status. No merge with
    // uncommitted runs any more: generation commits in the same request, so a
    // piece written a second ago is already a slot loadRecentThemes can see.
    //
    // No status filter is what makes turning a piece down work — the cancelled
    // theme stays in the avoid-list, so refilling the gap it reopened does not
    // hand back the angle that was just rejected.
    loadRecentThemes(clientId),
    lessonsForPrompt(clientId, "plan_themes"),
  ]);

  // getCampaign returns null for another client's campaign too, so this is the
  // tenancy check as well as the existence one.
  if (!campaign) throw new CampaignNotFoundError();
  // Checked here rather than by listing active campaigns: getCampaign does not
  // filter on status, so without this a proposal would be plannable.
  if (campaign.status !== "active") throw new CampaignNotActiveError(campaign.title);

  /**
   * Narrowed to this campaign, which is what scopes the fingerprint.
   *
   * planFromInputs hashes inputs.slots, so passing the client's whole slot set
   * would make committing campaign A invalidate campaign B's open preview —
   * and two open previews are now the normal case. Narrowing is otherwise a
   * no-op: deliveredByType already ignores other campaigns' slots, and slot ids
   * are namespaced by campaign, so the id set this seeds cannot collide.
   *
   * Through the shared helper, so commit narrows identically.
   */
  const scoped = scopeToCampaign(opts.campaignId, [toCampaignWindow(campaign)], allSlots);

  const contentStrategy = (strategy.content_strategy ?? {}) as {
    platforms?: unknown;
    content_pillars?: unknown;
  };

  const result = await planFromInputs({
    clientId,
    timezone: opts.timezone,
    quota,
    slots: scoped.slots,
    campaigns: scoped.campaigns,
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
    lessons,
  });

  return createPlanRun(clientId, {
    // What this run is for. Runs predating scoping have none, which is how the
    // campaign page tells "no run for me yet" from "a run that is not mine".
    campaignId: opts.campaignId,
    status: result.status,
    // What the campaign owed when this ran. Replaces the horizon, which meant
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
