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

export interface ExistingSlot {
  id: string;
  date: IsoDate;
  timeLocal: LocalTime;
  weekKey: WeekKey;
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
 * One gap record per (week, type) carrying a deficit — NOT one per slot.
 * It expands into `deficit` individual gap ids for the LLM so it can vary the
 * theme across them; a single gap yielding a single theme would produce three
 * identical posts.
 */
export interface Gap {
  weekKey: WeekKey;
  type: string;
  quotaCount: number;
  /** After proration and capacity apportionment. */
  wanted: number;
  existing: number;
  existingPast: number;
  deficit: number;
  surplus: number;
  allowedChannels: Channel[];
  /** Computed deterministically; the LLM may override within allowedChannels. */
  defaultChannel: Channel;
  eligibleCampaignIds: string[];
  partialWeek: boolean;
  notes: string[];
}

export interface CampaignStatus {
  campaignId: string;
  title: string;
  plannedTotal: number;
  assigned: number;
  deficit: number;
  daysRemaining: number;
  /** Pieces per remaining day — the ranking signal. */
  urgency: number;
  activeWeeks: WeekKey[];
  typesNeeded: string[];
}

export interface WeekCapacity {
  weekKey: WeekKey;
  eligibleDays: number;
  maxSlots: number;
  used: number;
  remaining: number;
  oversubscribed: boolean;
}

export interface Observation {
  timezone: string;
  today: IsoDate;
  weeks: WeekKey[];
  startDate: IsoDate;
  endDate: IsoDate;
  quota: Record<string, QuotaEntry>;
  gaps: Gap[];
  campaigns: CampaignStatus[];
  capacity: Record<WeekKey, WeekCapacity>;
  /** Phase 3's commit must never touch these. */
  pinnedSlotIds: string[];
  totalDeficit: number;
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

export interface ProposedSlot extends PieceStructure {
  slotId: string;
  gapId: string;
  weekKey: WeekKey;
  date: IsoDate;
  timeLocal: LocalTime;
  timezone: string;
  scheduledAt: string;
  type: string;
  channel: Channel;
  campaignId: string | null;
  campaignTitle: string | null;
  theme: string;
  brief: string;
  rationale: string;
  needsTheme: boolean;
}

export interface Deferred {
  gapId: string;
  weekKey: WeekKey;
  type: string;
  channel: Channel | null;
  reason: string;
}

export type PlanStatus = "proposed" | "noop" | "degraded";

/** Minutes of lead time before a slot may be scheduled. */
export const LEAD_TIME_MINUTES = 60;

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

/** Horizon bounds. */
export const MIN_HORIZON_WEEKS = 1;
export const MAX_HORIZON_WEEKS = 8;
