import type { Channel } from "../posting-windows";
import type { QuotaEntry } from "../strategy";

export type WeekKey = string; // "2026-W38"
export type IsoDate = string; // "2026-09-18"
export type LocalTime = string; // "09:00"

export const SLOT_STATUSES = [
  "planned",
  "confirmed",
  "drafted",
  "posted",
  "cancelled",
  "skipped",
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/**
 * planned/confirmed/drafted/posted consume quota; cancelled/skipped free the
 * gap again so the planner refills it.
 *
 * An UNRECOGNISED status does not count, and the caller warns. Failing open
 * here would silently under-plan, which is the harder failure to notice.
 */
const QUOTA_COUNTING = new Set(["planned", "confirmed", "drafted", "posted"]);

export function countsAgainstQuota(status: string): boolean {
  return QUOTA_COUNTING.has(status);
}

export function isKnownStatus(status: string): boolean {
  return (SLOT_STATUSES as readonly string[]).includes(status);
}

/**
 * A slot that already exists, as the planner needs to see it.
 *
 * No time or week key: the planner no longer reasons about the calendar, and
 * `date` is here only so callers can tell scheduled from unscheduled. Both
 * count identically against what a campaign is owed.
 */
export interface ExistingSlot {
  id: string;
  date: IsoDate | null;
  type: string;
  channel: string;
  status: string;
  campaignId: string | null;
  pinned: boolean;
}

export interface CampaignWindow {
  id: string;
  title: string;
  description: string;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  goal: string;
  keyMessage: string;
  /** From content_plan.breakdown; used to filter which gaps a campaign can serve. */
  plannedByType: Record<string, number>;
  plannedTotal: number;
  channels: Channel[];
  timeline: { week: number; focus: string }[];
}

/**
 * One demand record per (campaign, type) — NOT one per piece.
 *
 * It expands into `outstanding` individual gap ids for the LLM so it can vary
 * the theme across them; one gap yielding one theme would produce three
 * identical posts.
 *
 * The campaign is part of the identity, not a candidate the model picks from.
 * That is the whole point of the shape: a piece exists because one campaign
 * asked for it, so it can never come back attributed to nothing.
 */
export interface Demand {
  campaignId: string;
  campaignTitle: string;
  type: string;
  /** From the campaign's content_plan.breakdown. */
  planned: number;
  /** Already accepted against this campaign, dated or not. */
  delivered: number;
  outstanding: number;
  allowedChannels: Channel[];
  /** Computed deterministically; the LLM may override within allowedChannels. */
  defaultChannel: Channel;
  /** The quota's weekly cap for this type, 0 when uncapped. Advisory only now. */
  weeklyCap: number;
  notes: string[];
}

export interface CampaignStatus {
  campaignId: string;
  title: string;
  plannedTotal: number;
  delivered: number;
  outstanding: number;
  typesNeeded: string[];
}

export interface Observation {
  quota: Record<string, QuotaEntry>;
  demand: Demand[];
  campaigns: CampaignStatus[];
  /** Phase 3's commit must never touch these. */
  pinnedSlotIds: string[];
  totalOutstanding: number;
  warnings: string[];
}

/**
 * The structure every piece shares, whatever its format.
 *
 * A hook, the substance, and an ask. Splitting these out rather than leaving
 * one prose "brief" is what makes the output usable: a reel needs its hook in
 * the first three seconds and its CTA at the end, a carousel needs a first
 * slide and a last slide, and a post needs a line that stops the scroll. The
 * shape is the same; what changes per format is what each part means, which
 * the prompt spells out.
 */
export interface PieceStructure {
  /** The opening. Slide 1, the first three seconds, the first line. */
  hook: string;
  /** The substance, one entry per beat: slide, shot, paragraph or tweet. */
  body: string[];
  /** The ask at the end. */
  cta: string;
}

export interface Fill extends PieceStructure {
  gapId: string;
  campaignId: string | null;
  channel: Channel;
  theme: string;
  brief: string;
  rationale: string;
  needsTheme: boolean;
}

/**
 * A piece a campaign asked for, with no date.
 *
 * The four scheduling fields are null until a human gives it a day on the
 * Schedule page. They travel together — a slot has all four or none — which is
 * why scheduleSlot writes them in one update rather than one at a time.
 */
export interface ProposedSlot extends PieceStructure {
  slotId: string;
  gapId: string;
  weekKey: WeekKey | null;
  date: IsoDate | null;
  timeLocal: LocalTime | null;
  timezone: string;
  scheduledAt: string | null;
  type: string;
  channel: Channel;
  /** Never null now: a piece exists because one campaign asked for it. */
  campaignId: string;
  campaignTitle: string;
  theme: string;
  brief: string;
  rationale: string;
  needsTheme: boolean;
}

export interface Deferred {
  gapId: string;
  type: string;
  channel: Channel | null;
  reason: string;
}

export type PlanStatus = "proposed" | "noop" | "degraded";

/** Caps on LLM-authored text, keeping plan-run documents well under 1 MiB. */
export const MAX_THEME_CHARS = 120;
export const MAX_BRIEF_CHARS = 500;
export const MAX_RATIONALE_CHARS = 240;
export const MAX_HOOK_CHARS = 200;
export const MAX_CTA_CHARS = 200;
// body[] is the field that can actually blow the document limit: a plan run
// embeds every ProposedSlot, so this is capped on both axes. 8 x 300 is a
// carousel's worth of slides with room to spare.
export const MAX_BODY_ITEMS = 8;
export const MAX_BODY_ITEM_CHARS = 300;

