import { DateTime } from "luxon";
import {
  CHANNELS,
  MAX_SLOTS_PER_DAY,
  windowFor,
  type Channel,
} from "../posting-windows";
import type { QuotaEntry } from "../strategy";
import {
  countsAgainstQuota,
  isKnownStatus,
  LEAD_TIME_MINUTES,
  type CampaignStatus,
  type CampaignWindow,
  type ExistingSlot,
  type Gap,
  type IsoDate,
  type Observation,
  type WeekCapacity,
  type WeekKey,
} from "./types";
import { daysInSpan, horizonWeeks, weekdayOf, todayIn, type WeekSpan } from "./weeks";

// OBSERVE — the deterministic half of the planner.
//
// Answers "how many pieces of each type is each week short?" without any LLM
// involvement. Quota decides HOW MANY slots exist. Campaigns only decide which
// one each slot draws from — campaign deficit never creates extra slots.

export interface ObserveInput {
  timezone: string;
  now: Date;
  horizonWeeks: number;
  quota: Record<string, QuotaEntry>;
  slots: ExistingSlot[];
  campaigns: CampaignWindow[];
  /** Fallback channels from strategy.content_strategy.platforms. */
  strategyChannels: Channel[];
}

/**
 * How much of a week's quota is still fair to ask for.
 *
 * Prorating by the fraction of the week remaining, rather than demanding the
 * full quota, is what stops a Friday run cramming four posts into the weekend.
 * ceil() rather than floor() so a light quota late in the week still yields one
 * slot instead of rounding to nothing.
 */
export function proratedWanted(
  quotaCount: number,
  existingPast: number,
  daysRemaining: number
): number {
  if (daysRemaining >= 7) return quotaCount;
  if (daysRemaining <= 0) return existingPast;
  const prorated = Math.ceil((quotaCount * daysRemaining) / 7);
  return Math.min(quotaCount, existingPast + prorated);
}

/**
 * Days in the week still open to at least one of the given channels.
 *
 * Counting raw calendar days is wrong and produces weekend LinkedIn posts.
 * Concretely: on Saturday 2026-09-05 the week runs to Sunday 09-06, so two
 * calendar days remain — but LinkedIn posts Tue-Thu, so a LinkedIn-only quota
 * has ZERO eligible days and the whole current-week gap must defer.
 *
 * Eligibility is per (day, time): at 14:00 local, today's 09:00 LinkedIn window
 * is gone but a 19:30 Instagram window is still open.
 */
export function eligibleDays(
  span: WeekSpan,
  channels: Channel[],
  tz: string,
  now: DateTime
): IsoDate[] {
  const cutoff = now.plus({ minutes: LEAD_TIME_MINUTES });
  const weekdays = new Set<number>();
  for (const channel of channels) {
    for (const day of windowFor(channel).weekdays) weekdays.add(day);
  }

  return daysInSpan(span, tz).filter((date) => {
    if (!weekdays.has(weekdayOf(date, tz))) return false;
    // At least one preferred posting time on this day must still be ahead of us.
    return channels.some((channel) =>
      windowFor(channel).times.some((time) => {
        const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
        return dt.isValid && dt >= cutoff;
      })
    );
  });
}

/**
 * Trim a set of deficits down to a hard capacity using largest-remainder, so
 * the total lands exactly on capacity. Doing this here means the LLM is never
 * asked to fill a slot that physically cannot exist.
 */
export function apportion(deficits: number[], capacity: number): number[] {
  const total = deficits.reduce((a, b) => a + b, 0);
  if (total <= capacity || total === 0) return deficits.slice();

  const exact = deficits.map((d) => (d * capacity) / total);
  const floors = exact.map(Math.floor);
  let remaining = capacity - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = floors.slice();
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }
  return result;
}

/** Which channels a content type may use: quota entry, then campaigns, then strategy, then all. */
export function resolveChannels(
  type: string,
  entry: QuotaEntry,
  campaigns: CampaignWindow[],
  strategyChannels: Channel[]
): { channels: Channel[]; note: string | null } {
  if (entry.channels.length > 0) return { channels: entry.channels, note: null };

  const fromCampaigns = Array.from(
    new Set(campaigns.flatMap((c) => (c.plannedByType[type] ? c.channels : [])))
  );
  if (fromCampaigns.length > 0) {
    return {
      channels: fromCampaigns,
      note: `Type "${type}" lists no channels; used the active campaigns' channels.`,
    };
  }
  if (strategyChannels.length > 0) {
    return {
      channels: strategyChannels,
      note: `Type "${type}" lists no channels; used the strategy platforms.`,
    };
  }
  return {
    channels: [...CHANNELS],
    note: `Type "${type}" lists no channels; every channel is allowed.`,
  };
}

/**
 * Spread the default channel across a week's gaps rather than defaulting every
 * one to the first allowed channel, which would put a whole week on LinkedIn
 * before the LLM ever gets a say.
 */
function defaultChannelFor(channels: Channel[], index: number): Channel {
  return channels[index % channels.length];
}

export function computeCapacity(
  span: WeekSpan,
  channels: Channel[],
  tz: string,
  now: DateTime,
  slots: ExistingSlot[]
): WeekCapacity {
  const days = eligibleDays(span, channels, tz, now);
  const maxSlots = days.length * MAX_SLOTS_PER_DAY;
  const used = slots.filter(
    (s) => s.weekKey === span.weekKey && countsAgainstQuota(s.status)
  ).length;
  return {
    weekKey: span.weekKey,
    eligibleDays: days.length,
    maxSlots,
    used,
    remaining: Math.max(0, maxSlots - used),
    oversubscribed: false,
  };
}

/**
 * Rank campaigns by how far behind they are per remaining day. A ranking, not
 * an assignment — the LLM picks from it.
 */
export function rankCampaigns(
  campaigns: CampaignWindow[],
  slots: ExistingSlot[],
  today: IsoDate,
  weeks: WeekSpan[]
): CampaignStatus[] {
  const horizonStart = weeks[0].start;
  const horizonEnd = weeks[weeks.length - 1].end;

  return campaigns
    .filter((c) => {
      // A campaign with no window is treated as spanning the horizon; the
      // caller warns about it.
      if (!c.startDate || !c.endDate) return true;
      return c.startDate <= horizonEnd && c.endDate >= horizonStart;
    })
    .map((c) => {
      const assigned = slots.filter(
        (s) => s.campaignId === c.id && countsAgainstQuota(s.status)
      ).length;
      const deficit = Math.max(0, c.plannedTotal - assigned);
      const end = c.endDate ?? horizonEnd;
      const start = c.startDate && c.startDate > today ? c.startDate : today;
      const daysRemaining = Math.max(
        0,
        Math.round(
          DateTime.fromISO(end).diff(DateTime.fromISO(start), "days").days
        ) + 1
      );
      return {
        campaignId: c.id,
        title: c.title,
        plannedTotal: c.plannedTotal,
        assigned,
        deficit,
        daysRemaining,
        urgency: deficit / Math.max(1, daysRemaining),
        activeWeeks: weeks
          .filter(
            (w) =>
              (!c.startDate || c.startDate <= w.end) &&
              (!c.endDate || c.endDate >= w.start)
          )
          .map((w) => w.weekKey),
        typesNeeded: Object.keys(c.plannedByType),
      };
    })
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        a.daysRemaining - b.daysRemaining ||
        a.title.localeCompare(b.title)
    );
}

export function observe(input: ObserveInput): Observation {
  const tz = input.timezone;
  const now = DateTime.fromJSDate(input.now).setZone(tz);
  const today = todayIn(tz, now);
  const spans = horizonWeeks(today, input.horizonWeeks, tz);
  const warnings: string[] = [];

  // Unknown statuses are not counted, and must be visible: silently ignoring
  // one under-plans in a way nobody would think to look for.
  const unknown = Array.from(
    new Set(input.slots.filter((s) => !isKnownStatus(s.status)).map((s) => s.status))
  );
  if (unknown.length > 0) {
    warnings.push(
      `Ignoring slot status(es) not recognised by the planner: ${unknown.join(", ")}.`
    );
  }

  const campaignStatuses = rankCampaigns(input.campaigns, input.slots, today, spans);
  for (const c of input.campaigns) {
    if (!c.startDate || !c.endDate) {
      warnings.push(`Campaign "${c.title}" is active with no start/end window.`);
    }
  }

  const gaps: Gap[] = [];
  const capacity: Record<WeekKey, WeekCapacity> = {};

  // WHAT gets made comes from the campaigns' content plans; the quota only
  // says how fast. Driving demand from the quota instead produced content no
  // campaign had asked for — a "cta" every week because the quota listed one —
  // while silently dropping types a campaign DID ask for but the quota never
  // mentioned.
  //
  // Pieces still owed per type, across every active campaign, after subtracting
  // what is already scheduled. Decremented as the loop allocates across weeks:
  // without that, week two would re-plan what week one already took.
  const owed = new Map<string, number>();
  for (const campaign of input.campaigns) {
    for (const [type, planned] of Object.entries(campaign.plannedByType)) {
      if (planned <= 0) continue;
      const done = input.slots.filter(
        (s) =>
          s.campaignId === campaign.id &&
          s.type === type &&
          countsAgainstQuota(s.status)
      ).length;
      owed.set(type, (owed.get(type) ?? 0) + Math.max(0, planned - done));
    }
  }

  // Entries can exist with a value of 0 once a campaign is fully delivered, so
  // the "anything left?" test is on the values, not the map's size.
  const demandTypes = Array.from(owed.keys()).filter((t) => (owed.get(t) ?? 0) > 0);

  if (input.campaigns.length === 0) {
    warnings.push(
      "No active campaigns, so there is nothing to plan. Accept a campaign to give the planner a content plan to work from."
    );
  } else if (demandTypes.length === 0) {
    warnings.push(
      "Every active campaign's content plan is already fully scheduled."
    );
  }

  for (const [spanIndex, span] of spans.entries()) {
    const isPartial = span.start <= today && today <= span.end;
    const weeksLeft = spans.length - spanIndex;

    // Per-type gaps for this week, before capacity trimming.
    const weekGaps: Gap[] = demandTypes.map((type, index) => {
      // A type a campaign wants but the quota never mentions still gets
      // planned; the quota then imposes no weekly cap on it.
      const entry = input.quota[type] ?? { count: 0, channels: [] };
      const { channels, note } = resolveChannels(
        type,
        entry,
        input.campaigns,
        input.strategyChannels
      );
      const notes = note ? [note] : [];

      const ofType = input.slots.filter(
        (s) => s.weekKey === span.weekKey && s.type === type && countsAgainstQuota(s.status)
      );
      const existing = ofType.length;
      const existingPast = ofType.filter((s) => s.date < today).length;

      const days = eligibleDays(span, channels, tz, now);

      // Spread what the campaign still owes across the weeks left, then let
      // the quota cap the pace. A quota of 0 for this type means no cap.
      const stillOwed = owed.get(type) ?? 0;
      const paced = Math.ceil(stillOwed / weeksLeft);
      const cap = entry.count > 0 ? entry.count : paced;
      const target = Math.min(paced, cap);

      const wanted = isPartial
        ? proratedWanted(target, existingPast, days.length)
        : target;

      if (stillOwed > 0) {
        notes.push(
          `${stillOwed} left in the campaign plan, over ${weeksLeft} week(s).`
        );
      }
      if (entry.count > 0 && paced > entry.count) {
        notes.push(`Held to ${entry.count}/week by the quota.`);
      }
      if (isPartial && wanted < target) {
        notes.push(
          `Partial week: ${days.length} posting day(s) left, so asking for ${wanted} of ${target}.`
        );
      }
      if (days.length === 0) {
        notes.push(
          `No day left this week that ${channels.join("/")} can post on.`
        );
      }

      const eligibleCampaignIds = campaignStatuses
        .filter(
          (c) =>
            c.activeWeeks.includes(span.weekKey) &&
            (c.typesNeeded.length === 0 || c.typesNeeded.includes(type))
        )
        .map((c) => c.campaignId);

      return {
        weekKey: span.weekKey,
        type,
        // The weekly cap, not the demand. Demand is the campaign's.
        quotaCount: entry.count,
        wanted,
        existing,
        existingPast,
        deficit: Math.max(0, wanted - existing),
        surplus: entry.count > 0 ? Math.max(0, existing - entry.count) : 0,
        allowedChannels: channels,
        defaultChannel: defaultChannelFor(channels, index),
        eligibleCampaignIds,
        partialWeek: isPartial,
        notes,
      };
    });

    // Trim against what the week can physically hold.
    const allChannels = Array.from(new Set(weekGaps.flatMap((g) => g.allowedChannels)));
    const cap = computeCapacity(span, allChannels, tz, now, input.slots);
    const totalDeficit = weekGaps.reduce((sum, g) => sum + g.deficit, 0);

    if (totalDeficit > cap.remaining) {
      const trimmed = apportion(
        weekGaps.map((g) => g.deficit),
        cap.remaining
      );
      weekGaps.forEach((g, i) => {
        if (trimmed[i] < g.deficit) {
          g.notes.push(`Trimmed from ${g.deficit} to ${trimmed[i]} by weekly capacity.`);
        }
        g.deficit = trimmed[i];
      });
      cap.oversubscribed = true;
      warnings.push(
        `${span.weekKey}: the campaign plans need ${totalDeficit} more slot(s) but ${MAX_SLOTS_PER_DAY}/day over ${cap.eligibleDays} posting day(s) allows ${cap.remaining}. Trimmed proportionally.`
      );
    }

    // Consume what this week took, so the next week plans the remainder and
    // not the whole campaign again.
    for (const gap of weekGaps) {
      const taken = gap.deficit + gap.existing;
      owed.set(gap.type, Math.max(0, (owed.get(gap.type) ?? 0) - taken));
    }

    capacity[span.weekKey] = cap;
    gaps.push(...weekGaps);
  }

  return {
    timezone: tz,
    today,
    weeks: spans.map((s) => s.weekKey),
    startDate: spans[0].start,
    endDate: spans[spans.length - 1].end,
    quota: input.quota,
    gaps,
    campaigns: campaignStatuses,
    capacity,
    pinnedSlotIds: input.slots.filter((s) => s.pinned).map((s) => s.id),
    totalDeficit: gaps.reduce((sum, g) => sum + g.deficit, 0),
    warnings,
  };
}
