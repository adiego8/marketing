import { CHANNELS, type Channel } from "../posting-windows";
import type { QuotaEntry } from "../strategy";
import {
  countsAgainstQuota,
  isKnownStatus,
  type CampaignStatus,
  type CampaignWindow,
  type Demand,
  type ExistingSlot,
  type Observation,
} from "./types";

// OBSERVE — the deterministic half of the planner.
//
// Answers one question, with no LLM and no calendar: what does each active
// campaign still owe?
//
// It used to answer a second question — how many of those fit in each week —
// and that is what produced content attributed to nothing. Demand was paced
// across the planning horizon while a campaign was only eligible inside its own
// start/end window, so pieces generated in the weeks before a campaign started
// had no campaign they were allowed to carry. The fix is not to reconcile the
// two calendars but to remove one: a piece is generated FOR a campaign and
// dated later, by a person. There is no week for it to be outside of.

export interface ObserveInput {
  quota: Record<string, QuotaEntry>;
  slots: ExistingSlot[];
  campaigns: CampaignWindow[];
  /** Fallback channels from strategy.content_strategy.platforms. */
  strategyChannels: Channel[];
}

/** Which channels a content type may use: quota entry, then campaign, then strategy, then all. */
export function resolveChannels(
  type: string,
  entry: QuotaEntry,
  campaign: CampaignWindow,
  strategyChannels: Channel[]
): { channels: Channel[]; note: string | null } {
  if (entry.channels.length > 0) return { channels: entry.channels, note: null };

  if (campaign.channels.length > 0) {
    return {
      channels: campaign.channels,
      note: `Type "${type}" lists no channels; used the campaign's.`,
    };
  }
  if (strategyChannels.length > 0) {
    return {
      channels: strategyChannels,
      note: `Type "${type}" lists no channels; used the strategy's platforms.`,
    };
  }
  return {
    channels: [...CHANNELS],
    note: `Type "${type}" lists no channels anywhere; every channel is allowed.`,
  };
}

/**
 * Rotate the default channel across a campaign's types.
 *
 * Deterministic, and only a default — the model may override it within
 * allowedChannels. Rotating rather than always picking the first stops a
 * campaign with three types putting all of them on one platform.
 */
export function defaultChannelFor(channels: Channel[], index: number): Channel {
  return channels[index % channels.length] ?? "linkedin";
}

/**
 * What one campaign has already been given, by type.
 *
 * Counted from slots attributed to that campaign, dated or not: an accepted
 * piece waiting for a day is delivered as far as demand is concerned, or the
 * next run would propose it all over again.
 */
export function deliveredByType(
  slots: ExistingSlot[],
  campaignId: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.campaignId !== campaignId) continue;
    if (!countsAgainstQuota(slot.status)) continue;
    out[slot.type] = (out[slot.type] ?? 0) + 1;
  }
  return out;
}

export function observe(input: ObserveInput): Observation {
  const warnings: string[] = [];

  const unknown = Array.from(
    new Set(input.slots.filter((s) => !isKnownStatus(s.status)).map((s) => s.status))
  );
  if (unknown.length > 0) {
    warnings.push(
      `Ignoring slot status(es) not recognised by the planner: ${unknown.join(", ")}.`
    );
  }

  const demand: Demand[] = [];
  const campaigns: CampaignStatus[] = [];

  for (const campaign of input.campaigns) {
    const delivered = deliveredByType(input.slots, campaign.id);
    const types = Object.keys(campaign.plannedByType).filter(
      (type) => campaign.plannedByType[type] > 0
    );

    let campaignOutstanding = 0;
    let campaignDelivered = 0;

    types.forEach((type, index) => {
      const planned = campaign.plannedByType[type];
      const done = delivered[type] ?? 0;
      const outstanding = Math.max(0, planned - done);

      campaignDelivered += done;
      campaignOutstanding += outstanding;
      if (outstanding === 0) return;

      // A type the campaign wants but the quota never mentions is still
      // planned; the quota then imposes no cap on it. The cap is advisory now
      // — it is applied when a human picks a day, not here.
      const entry = input.quota[type] ?? { count: 0, channels: [] };
      const { channels, note } = resolveChannels(
        type,
        entry,
        campaign,
        input.strategyChannels
      );

      const notes = note ? [note] : [];
      notes.push(`${campaign.title} has had ${done} of ${planned}.`);
      if (entry.count > 0) {
        notes.push(`The quota suggests no more than ${entry.count} a week.`);
      }

      demand.push({
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        type,
        planned,
        delivered: done,
        outstanding,
        allowedChannels: channels,
        defaultChannel: defaultChannelFor(channels, index),
        weeklyCap: entry.count,
        notes,
      });
    });

    campaigns.push({
      campaignId: campaign.id,
      title: campaign.title,
      plannedTotal: campaign.plannedTotal,
      delivered: campaignDelivered,
      outstanding: campaignOutstanding,
      typesNeeded: types,
    });
  }

  if (input.campaigns.length === 0) {
    warnings.push(
      "No active campaigns, so there is nothing to plan. Accept a campaign to give the planner a content plan to work from."
    );
  } else if (demand.length === 0) {
    warnings.push("Every active campaign's content plan is already fully delivered.");
  }

  // A campaign whose breakdown is empty asks for nothing, and would otherwise
  // sit "active" forever producing no content with no explanation.
  for (const campaign of input.campaigns) {
    if (Object.keys(campaign.plannedByType).length === 0) {
      warnings.push(
        `Campaign "${campaign.title}" has no content plan breakdown, so it asks for nothing.`
      );
    }
  }

  return {
    quota: input.quota,
    demand,
    campaigns,
    pinnedSlotIds: input.slots.filter((s) => s.pinned).map((s) => s.id),
    totalOutstanding: demand.reduce((sum, d) => sum + d.outstanding, 0),
    warnings,
  };
}
