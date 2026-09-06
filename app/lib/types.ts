/**
 * A committed slot: one piece of content scheduled for a date, time and
 * channel. This is what `marketing_slots` holds and what serializeSlot in
 * lib/firestore.ts returns.
 *
 * Not to be confused with ProposedSlot below, which is the camelCase
 * pre-commit shape embedded in a plan run. A ProposedSlot becomes a Slot only
 * when a plan is accepted.
 */
export interface Slot {
  id: string;
  client_id: string | null;
  campaign_id: string | null;
  campaign_title: string | null;
  plan_run_id: string | null;
  gap_id: string;
  /** Calendar date in the client's timezone, not UTC. */
  date: string;
  time_local: string;
  timezone: string;
  /** The UTC instant derived from date + time_local + timezone. */
  scheduled_at: string | null;
  week_key: string;
  type: string;
  channel: string;
  theme: string;
  brief: string;
  rationale: string;
  /** The opening: slide 1, the first three seconds, the first line. */
  hook: string;
  /** The substance, one entry per beat: slide, shot, paragraph or tweet. */
  body: string[];
  /** The ask at the end. */
  cta: string;
  needs_theme: boolean;
  /**
   * Deliberately `string`, not SlotStatus.
   *
   * The PATCH route validates against SLOT_STATUSES, so anything this app
   * writes is in the union. Reads are permissive on purpose: a value put there
   * by hand, or left by an older version, should render as itself rather than
   * be coerced into "planned" — which would silently change whether it counts
   * against quota. statusPill and QUOTA_COUNTING both already fall back safely.
   */
  status: string;
  /** "agent" for planner output, "human" for a hand-added slot. */
  source: string;
  /** The planner never moves a pinned slot. */
  pinned: boolean;
  content: Record<string, unknown> | null;
  google_event_id: string | null;
  google_sync_status: string;
  google_sync_error: string | null;
  last_human_edit_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * planned/confirmed/drafted/posted consume quota; cancelled/skipped free it,
 * so the next plan run refills that gap. Mirrors SLOT_STATUSES in
 * lib/marketing/planner/types.ts.
 */
export type SlotStatus =
  | "planned"
  | "confirmed"
  | "drafted"
  | "posted"
  | "cancelled"
  | "skipped";

export interface Slide {
  slide: number;
  text: string;
  image_prompt?: string;
}

export interface AssetRationale {
  why_this_post?: string;
  why_this_format?: string;
  target_moment?: string;
  expected_outcome?: string;
}

export interface Debrief {
  what_i_did: string;
  what_i_learned: string;
  things_to_improve: string;
  what_id_do_differently: string;
}

/** One entry in content_quota.weekly: how many per week, and on which channels. */
export interface QuotaEntry {
  count: number;
  channels: string[];
}

export interface ContentQuota {
  weekly: Record<string, QuotaEntry>;
  rationale?: string;
}

export interface Strategy {
  // No `id`: the strategy document is keyed by client_id, one per client.
  client_id: string;
  business_name: string;
  icp: Record<string, unknown>;
  voice: Record<string, unknown>;
  positioning: Record<string, unknown>;
  messaging: Record<string, unknown>;
  goals: Record<string, unknown>;
  // Top-level, not nested under goals as the Python onboarding flow stored it.
  content_strategy: Record<string, unknown>;
  content_quota: ContentQuota;
  updated_at: string;
}

export interface Campaign {
  id: string;
  title: string;
  description?: string;
  status: "idea" | "proposal" | "in_review" | "active" | "completed" | "rejected";
  strategy: Record<string, unknown>;
  content_plan: Record<string, unknown>;
  /** Heterogeneous: review writes submitted_at, improve writes improved_at + changes. */
  feedback_history: Array<{ feedback: string; improved_at?: string; submitted_at?: string; changes?: string }>;
  rejection_reason?: string;
  start_date?: string;
  end_date?: string;
  /** How the planner distributes this campaign's content across its window. */
  pacing?: "even" | "front_loaded" | "back_loaded";
  created_at: string;
  updated_at: string;
}

export interface CampaignListItem {
  id: string;
  title: string;
  status: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
}

export interface Branding {
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  fonts?: {
    headline?: string;
    body?: string;
  };
  visual_style?: string;
  mood?: string;
  dos?: string;
  donts?: string;
}

export interface Client {
  id: string;
  agency_id: string;
  name: string;
  website_url?: string;
  logo_url?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  status: "active" | "paused" | "archived";
  /** IANA zone. Every scheduling decision is made in the client's local time. */
  timezone: string;
  research?: Record<string, unknown>;
  research_status?: "researching" | "completed" | "failed";
  branding?: Branding;
  google_calendar_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientListItem {
  id: string;
  name: string;
  status: string;
  website_url?: string;
  logo_url?: string;
  contact_email?: string;
  created_at: string;
}

// --- Planner (Phase 2) ---

export interface ProposedSlot {
  slotId: string;
  gapId: string;
  weekKey: string;
  date: string;
  timeLocal: string;
  timezone: string;
  scheduledAt: string;
  type: string;
  channel: string;
  campaignId: string | null;
  campaignTitle: string | null;
  theme: string;
  brief: string;
  rationale: string;
  /** The opening: slide 1, the first three seconds, the first line. */
  hook: string;
  /** The substance, one entry per beat: slide, shot, paragraph or tweet. */
  body: string[];
  /** The ask at the end. */
  cta: string;
  /** The model gave no theme; the date and channel are still correct. */
  needsTheme: boolean;
}

export interface DeferredGap {
  gapId: string;
  weekKey: string;
  type: string;
  channel: string | null;
  reason: string;
}

export interface PlanGap {
  weekKey: string;
  type: string;
  quotaCount: number;
  wanted: number;
  existing: number;
  deficit: number;
  surplus: number;
  allowedChannels: string[];
  partialWeek: boolean;
  notes: string[];
}

export interface PlanObservation {
  timezone: string;
  today: string;
  weeks: string[];
  startDate: string;
  endDate: string;
  gaps: PlanGap[];
  campaigns: {
    campaignId: string;
    title: string;
    deficit: number;
    urgency: number;
  }[];
  totalDeficit: number;
  warnings: string[];
}

export interface PlanRun {
  id: string;
  client_id: string;
  /** proposed = ready to commit · noop = quota already met · degraded = themes missing */
  status: "proposed" | "noop" | "degraded" | "committed";
  horizon: {
    weeks: string[];
    startDate: string;
    endDate: string;
    timezone: string;
    horizonWeeks: number;
  };
  observation: PlanObservation;
  proposed_slots: ProposedSlot[];
  deferred: DeferredGap[];
  warnings: string[];
  created_slot_ids: string[];
  inputs_fingerprint: string | null;
  llm: { called: boolean; degraded: boolean; durationMs: number } | null;
  committed_at: string | null;
  created_at: string;
}
