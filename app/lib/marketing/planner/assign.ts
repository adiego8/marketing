import { DateTime } from "luxon";
import {
  MAX_SLOTS_PER_DAY,
  MIN_GAP_MINUTES,
  windowFor,
  type Channel,
} from "../posting-windows";
import { mintSlotId } from "./slot-id";
import {
  countsAgainstQuota,
  LEAD_TIME_MINUTES,
  type CampaignWindow,
  type Deferred,
  type ExistingSlot,
  type Fill,
  type Gap,
  type IsoDate,
  type LocalTime,
  type ProposedSlot,
} from "./types";
import { daysInSpan, minutesOf, toUtcInstant, weekdayOf, type WeekSpan } from "./weeks";

// ASSIGN — turns themed fills into dated slots. Pure: no IO, no LLM.
//
// Every date and time decision lives here, which is why the LLM is never asked
// for one. Deterministic given the same inputs, so the golden test can pin the
// exact output array.

export interface AssignInput {
  clientId: string;
  timezone: string;
  now: Date;
  spans: WeekSpan[];
  gapsByGapId: Map<string, Gap>;
  fills: Fill[];
  existing: ExistingSlot[];
  campaigns: Map<string, CampaignWindow>;
}

export interface AssignResult {
  proposed: ProposedSlot[];
  deferred: Deferred[];
}

interface Occupied {
  channel: string;
  timeLocal: LocalTime;
}

/**
 * Most-constrained-first.
 *
 * Without this, Instagram (which posts any day) consumes the shared Tue-Thu
 * capacity and LinkedIn (Tue-Thu only) gets deferred despite having nowhere
 * else to go. Classic greedy scheduling fix.
 */
export function orderFills(fills: Fill[], gaps: Map<string, Gap>): Fill[] {
  return fills.slice().sort((a, b) => {
    const aDays = windowFor(a.channel).weekdays.length;
    const bDays = windowFor(b.channel).weekdays.length;
    if (aDays !== bDays) return aDays - bDays;
    const aGap = gaps.get(a.gapId);
    const bGap = gaps.get(b.gapId);
    return (aGap?.type ?? "").localeCompare(bGap?.type ?? "") ||
      a.gapId.localeCompare(b.gapId);
  });
}

/**
 * Pick a local time on a given day for a channel, or null if none works.
 *
 * Never fabricates a time: if every preferred window is blocked, the caller
 * moves to another day and ultimately defers with a reason. A deferred fill
 * that explains itself is far more useful than a slot at a nonsense hour.
 */
export function pickTime(
  date: IsoDate,
  channel: Channel,
  tz: string,
  now: DateTime,
  occupied: Occupied[]
): LocalTime | null {
  const cutoff = now.plus({ minutes: LEAD_TIME_MINUTES });
  const sameChannel = occupied.filter((o) => o.channel === channel);

  for (const time of windowFor(channel).times) {
    // toUtcInstant returns null for a local time that does not exist (DST).
    const instant = toUtcInstant(date, time, tz);
    if (!instant) continue;
    if (DateTime.fromJSDate(instant) < cutoff) continue;

    const clash = sameChannel.some(
      (o) => Math.abs(minutesOf(o.timeLocal) - minutesOf(time)) < MIN_GAP_MINUTES
    );
    if (!clash) return time;
  }
  return null;
}

/**
 * Days in the week this fill could land on: the channel's posting weekdays,
 * still in the future, inside the campaign window, and under the daily cap.
 *
 * The campaign window is an intersection rather than a later filter, so a
 * window that removes every candidate produces an explicit deferral instead of
 * a slot outside the campaign.
 */
export function candidateDays(
  span: WeekSpan,
  channel: Channel,
  tz: string,
  now: DateTime,
  campaign: CampaignWindow | undefined,
  dayLoad: Map<IsoDate, number>
): IsoDate[] {
  const weekdays = new Set(windowFor(channel).weekdays);
  const cutoff = now.plus({ minutes: LEAD_TIME_MINUTES });

  return daysInSpan(span, tz).filter((date) => {
    if (!weekdays.has(weekdayOf(date, tz))) return false;
    if (campaign?.startDate && date < campaign.startDate) return false;
    if (campaign?.endDate && date > campaign.endDate) return false;
    if ((dayLoad.get(date) ?? 0) >= MAX_SLOTS_PER_DAY) return false;
    // At least one posting window on this day is still ahead of us.
    return windowFor(channel).times.some((time) => {
      const instant = toUtcInstant(date, time, tz);
      return instant !== null && DateTime.fromJSDate(instant) >= cutoff;
    });
  });
}

export function assign(input: AssignInput): AssignResult {
  const tz = input.timezone;
  const now = DateTime.fromJSDate(input.now).setZone(tz);
  const proposed: ProposedSlot[] = [];
  const deferred: Deferred[] = [];

  // Day load counts EVERY type and channel, not just the one being placed:
  // the cap belongs to the day, so a 9-piece weekly quota cannot stack three
  // posts on Tuesday just because they are different content types.
  const dayLoad = new Map<IsoDate, number>();
  const occupiedByDay = new Map<IsoDate, Occupied[]>();
  const takenIds = new Set<string>();

  for (const slot of input.existing) {
    takenIds.add(slot.id);
    if (!countsAgainstQuota(slot.status)) continue;
    dayLoad.set(slot.date, (dayLoad.get(slot.date) ?? 0) + 1);
    const list = occupiedByDay.get(slot.date) ?? [];
    list.push({ channel: slot.channel, timeLocal: slot.timeLocal });
    occupiedByDay.set(slot.date, list);
  }

  // Group by week so fills spread within their own week, then order each group
  // most-constrained-first.
  const byWeek = new Map<string, Fill[]>();
  for (const fill of input.fills) {
    const gap = input.gapsByGapId.get(fill.gapId);
    if (!gap) continue;
    const list = byWeek.get(gap.weekKey) ?? [];
    list.push(fill);
    byWeek.set(gap.weekKey, list);
  }

  for (const span of input.spans) {
    const fills = orderFills(byWeek.get(span.weekKey) ?? [], input.gapsByGapId);

    fills.forEach((fill, indexInWeek) => {
      const gap = input.gapsByGapId.get(fill.gapId)!;
      const campaign = fill.campaignId ? input.campaigns.get(fill.campaignId) : undefined;
      const days = candidateDays(span, fill.channel, tz, now, campaign, dayLoad);

      if (days.length === 0) {
        deferred.push({
          gapId: fill.gapId,
          weekKey: gap.weekKey,
          type: gap.type,
          channel: fill.channel,
          reason: campaign
            ? `No ${fill.channel} day left in ${gap.weekKey} inside the "${campaign.title}" window under the ${MAX_SLOTS_PER_DAY}/day cap.`
            : `No ${fill.channel} day left in ${gap.weekKey} under the ${MAX_SLOTS_PER_DAY}/day cap.`,
        });
        return;
      }

      // Spread the k-th of n fills across the available days rather than
      // letting a pure lowest-load pick pile everything onto Monday-Tuesday.
      //
      // Anchored at both ends rather than centred: with a single fill there is
      // nothing to spread, so ideal 0 lets the channel's own weekday preference
      // decide (a lone LinkedIn post belongs on its preferred Tuesday, not
      // parked mid-week). With several, they stretch to the extremes.
      const ideal =
        fills.length <= 1
          ? 0
          : Math.round((indexInWeek * (days.length - 1)) / (fills.length - 1));
      const ranked = days
        .map((date, i) => ({
          date,
          load: dayLoad.get(date) ?? 0,
          distance: Math.abs(i - ideal),
          preference: windowFor(fill.channel).weekdays.indexOf(weekdayOf(date, tz)),
        }))
        .sort(
          (a, b) =>
            a.load - b.load ||
            a.distance - b.distance ||
            a.preference - b.preference ||
            a.date.localeCompare(b.date)
        );

      let placed = false;
      for (const candidate of ranked) {
        const occupied = occupiedByDay.get(candidate.date) ?? [];
        const time = pickTime(candidate.date, fill.channel, tz, now, occupied);
        if (!time) continue;

        const instant = toUtcInstant(candidate.date, time, tz);
        if (!instant) continue;

        proposed.push({
          slotId: mintSlotId(takenIds, input.clientId, candidate.date, gap.type, fill.channel),
          gapId: fill.gapId,
          weekKey: gap.weekKey,
          date: candidate.date,
          timeLocal: time,
          timezone: tz,
          scheduledAt: instant.toISOString(),
          type: gap.type,
          channel: fill.channel,
          campaignId: fill.campaignId,
          campaignTitle: campaign?.title ?? null,
          theme: fill.theme,
          brief: fill.brief,
          rationale: fill.rationale,
          hook: fill.hook,
          body: fill.body,
          cta: fill.cta,
          needsTheme: fill.needsTheme,
        });

        dayLoad.set(candidate.date, (dayLoad.get(candidate.date) ?? 0) + 1);
        occupied.push({ channel: fill.channel, timeLocal: time });
        occupiedByDay.set(candidate.date, occupied);
        placed = true;
        break;
      }

      if (!placed) {
        deferred.push({
          gapId: fill.gapId,
          weekKey: gap.weekKey,
          type: gap.type,
          channel: fill.channel,
          reason: `Every ${fill.channel} posting time in ${gap.weekKey} was already taken or within ${MIN_GAP_MINUTES} minutes of another post.`,
        });
      }
    });
  }

  // Chronological, which is the order the preview page renders.
  proposed.sort(
    (a, b) => a.date.localeCompare(b.date) || a.timeLocal.localeCompare(b.timeLocal)
  );
  return { proposed, deferred };
}
