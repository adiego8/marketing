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
  /**
   * Calendar date in the client's timezone, not UTC.
   *
   * Null until a human schedules it. A piece is generated for a campaign and
   * accepted first; the day is chosen afterwards, on the Schedule page. These
   * four fields travel together — a slot has all of them or none — which is
   * why scheduleSlot writes them in one update.
   */
  date: string | null;
  time_local: string | null;
  timezone: string;
  /** The UTC instant derived from date + time_local + timezone. */
  scheduled_at: string | null;
  week_key: string | null;
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
  /**
   * The finished, publishable copy — see lib/marketing/copy.ts. Deliberately
   * untyped here: serializeSlot passes it through unvalidated and it is
   * hand-editable JSON, so readCopy() is the single narrowing point rather
   * than a cast at every read.
   */
  content: Record<string, unknown> | null;
  google_event_id: string | null;
  /** pending | synced | stale | locked | removed | error. */
  google_sync_status: string;
  google_sync_error: string | null;
  /**
   * What the last successful push wrote, so reconciliation can tell OUR change
   * from THEIRS. Comparing the event against the slot's current rendering
   * cannot: a slot edited in the app is legitimately different from its event,
   * which is what "stale" means. Null on every slot synced before Phase 5.
   */
  google_event_title: string | null;
  google_event_body_hash: string | null;
  /** The title and notes were edited in Google; sync no longer rewrites them. */
  google_event_locked: boolean;
  /** When a move made in Google was last adopted. */
  google_adopted_at: string | null;
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
  /** Null until a human schedules it. See Slot.date above. */
  weekKey: string | null;
  date: string | null;
  timeLocal: string | null;
  timezone: string;
  scheduledAt: string | null;
  type: string;
  channel: string;
  /** Never null: a piece exists because one campaign asked for it. */
  campaignId: string;
  campaignTitle: string;
  theme: string;
  brief: string;
  rationale: string;
  /** The opening: slide 1, the first three seconds, the first line. */
  hook: string;
  /** The substance, one entry per beat: slide, shot, paragraph or tweet. */
  body: string[];
  /** The ask at the end. */
  cta: string;
  /** The model gave no theme; the campaign and channel are still correct. */
  needsTheme: boolean;
}

/**
 * A proposed slot a human rejected before it was ever committed.
 *
 * It keeps the whole slot rather than just its id, for two reasons: the page
 * can show what was turned down, and every dropped theme becomes part of the
 * avoid-list, so a replacement can never hand back the idea you just refused.
 * Camel-cased like ProposedSlot — these arrays are stored and served as-is.
 */
export interface DroppedSlot extends ProposedSlot {
  /** Why, in the operator's words. Optional, and steers the replacement. */
  reason: string;
  droppedAt: string;
  /** Set once a replacement has been generated; null while the hole is open. */
  replacedAt: string | null;
}

export interface DeferredGap {
  gapId: string;
  type: string;
  channel: string | null;
  reason: string;
}

/** One row of what a campaign still owes. Mirrors Demand in planner/types.ts. */
export interface PlanDemand {
  campaignId: string;
  campaignTitle: string;
  type: string;
  planned: number;
  delivered: number;
  outstanding: number;
  allowedChannels: string[];
  /** The quota's weekly cap, 0 when uncapped. Advisory: applied when scheduling. */
  weeklyCap: number;
  notes: string[];
}

export interface PlanCampaignStatus {
  campaignId: string;
  title: string;
  plannedTotal: number;
  delivered: number;
  outstanding: number;
  typesNeeded: string[];
}

export interface PlanObservation {
  demand: PlanDemand[];
  campaigns: PlanCampaignStatus[];
  totalOutstanding: number;
  warnings: string[];
}

export interface PlanRun {
  id: string;
  client_id: string;
  /** proposed = ready to commit · noop = every campaign plan already scheduled · degraded = themes missing */
  status: "proposed" | "noop" | "degraded" | "committed";
  /**
   * What each campaign owed when this ran.
   *
   * Replaces `horizon`, which stopped meaning anything once planning no longer
   * placed dates. Runs made before that still carry `horizon`, so it is kept
   * optional rather than migrated.
   */
  demand: PlanCampaignStatus[];
  horizon?: {
    weeks: string[];
    startDate: string;
    endDate: string;
    timezone: string;
    horizonWeeks: number;
  };
  observation: PlanObservation;
  /** What would be committed. Dropping a slot removes it from here. */
  proposed_slots: ProposedSlot[];
  dropped_slots: DroppedSlot[];
  deferred: DeferredGap[];
  warnings: string[];
  created_slot_ids: string[];
  inputs_fingerprint: string | null;
  llm: { called: boolean; degraded: boolean; durationMs: number } | null;
  committed_at: string | null;
  created_at: string;
}

/**
 * One research run: what was searched, what was found, and the strategy drafted
 * from it. Stored in its own collection rather than on the client, because a
 * dossier is sizable and listClients serializes every client document.
 *
 * There is no "running" status. A run document is written once the work is
 * finished — the app has no queue and no worker that could set one.
 */
export interface ResearchRun {
  id: string;
  client_id: string;
  status: "running" | "complete" | "degraded" | "insufficient" | "failed";
  /** The current step, while running. Null once the run has finished. */
  progress: string | null;
  inputs: {
    business_name?: string;
    website?: string | null;
    domain?: string | null;
    notes?: string | null;
    /** The operator's direction, so a re-run can start from it. */
    steer?: string;
    competitors?: string[];
  };
  dossier: Record<string, unknown>;
  /** Shaped like Strategy, minus the server-owned client_id and updated_at. */
  draft_strategy: Record<string, unknown>;
  /** What research could not settle — the agenda for the call with the client. */
  open_questions: string[];
  /** URLs the search actually cited. Claims that named anything else were dropped. */
  sources: string[];
  warnings: string[];
  llm: { model: string; searches: number; duration_ms: number } | null;
  accepted_at: string | null;
  created_at: string;
}
