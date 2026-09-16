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
  /**
   * What an external agent reported publishing, and where.
   *
   * One map rather than four fields: it is a single unit, so "has this gone
   * out" is one null check rather than four that could disagree. Null until an
   * agent reports, and never written by this app's own UI.
   */
  publication: Publication | null;
  /**
   * The last failed publish attempt. Deliberately does NOT move the status:
   * cancelled and skipped free the slot's quota, so demoting a failed publish
   * would have the next plan run propose a replacement for a piece that is
   * still sitting there waiting to be retried.
   */
  last_publish_error: { reason: string; reported_at: string | null } | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Publication {
  external_id: string;
  external_url: string | null;
  /** The platform's own timestamp, as reported. */
  published_at: string;
  /** When we recorded it. Ours, not theirs. */
  reported_at: string | null;
  /**
   * The caller's assertion that a repeat is the same request. Stored so a
   * retried queue message replays instead of posting twice.
   */
  idempotency_key: string;
  /** Which key claimed this, for the audit trail. Never the key itself. */
  key_prefix: string | null;
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

/* ----------------------------------------------------- the feedback loop -- */
//
// An episode becomes a Signal; several signals justify a Lesson; lessons are
// what the agent actually writes against. Raw feedback is never fed back into a
// prompt — it grows without bound, accumulates contradictions and cannot be
// retired.

/** Which prompt a lesson applies to. */
export type LessonScope = "campaign_ideas" | "plan_themes" | "copy";

export const LESSON_SCOPES: LessonScope[] = [
  "campaign_ideas",
  "plan_themes",
  "copy",
];

export type SignalKind =
  /** A generated piece was rewritten by hand. The strongest signal: it shows
      the target rather than the miss. */
  | "edited"
  /** A proposed piece was dropped before it was ever accepted. */
  | "dropped"
  /** A drop was put back — the rejection itself was wrong. */
  | "restored"
  /** A rewrite was asked for with a direction. */
  | "steered"
  /** A piece was skipped or cancelled after being accepted. */
  | "retired";

/** The fields of a piece a person can disagree with. */
export interface BriefSnapshot {
  theme: string;
  hook: string;
  body: string[];
  cta: string;
}

export interface Signal {
  id: string;
  client_id: string;
  kind: SignalKind;
  scope: LessonScope;
  /** What kind of piece it was, so a rule can be about reels specifically. */
  type: string;
  channel: string;
  slot_id: string | null;
  campaign_id: string | null;
  plan_run_id: string | null;
  /** A drop reason or a steer. Empty when the episode carried no words. */
  reason: string;
  /** Edits only: what the agent wrote, and what it became. */
  before: BriefSnapshot | null;
  after: BriefSnapshot | null;
  /** Which fields actually changed. Empty for everything but an edit. */
  changed: string[];
  created_at: string;
}

export interface Lesson {
  id: string;
  client_id: string;
  /** One short imperative rule. A model obeys a rule; it ignores a paragraph. */
  text: string;
  scope: LessonScope;
  status: "active" | "retired";
  /** "distilled" is Phase 3 — an LLM proposing lessons from signals. */
  source: "written" | "distilled";
  /**
   * Written from the first day and never read.
   *
   * Agency-wide house rules ("we never write 'leverage'") become a filter
   * change rather than a migration, which is the only reason this exists now.
   */
  owner: "client" | "agency";
  evidence: string[];
  evidence_count: number;
  created_at: string;
  retired_at: string | null;
}

// --- Agent API (Phase 8) ---
//
// A second auth rail: an external agent holds a key, reads what a client owes
// and reports what it published. Deliberately separate from Session — nothing
// on this rail can reach a human's privileges.

/** What a key is allowed to do. A key carries an explicit list; never "all". */
export type ApiKeyScope = "schedule:read" | "brand:read" | "schedule:publish";

export const API_KEY_SCOPES: ApiKeyScope[] = [
  "schedule:read",
  "brand:read",
  "schedule:publish",
];

/**
 * A key as the app shows it back. Never carries the secret.
 *
 * `id` is the sha256 of the key, which is also the document id — it identifies
 * a key for revocation without being usable to authenticate, since it is the
 * hash rather than the input.
 */
export interface ApiKey {
  id: string;
  client_id: string;
  agency_id: string;
  name: string;
  /** The leading fragment, the only displayable part: "mk_live_7fQ2xR9v". */
  prefix: string;
  scopes: ApiKeyScope[];
  status: "active" | "revoked" | "expired";
  created_by: string | null;
  created_at: string | null;
  /** Throttled to once an hour — a read endpoint must not cost a write. */
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Whether a piece's finished copy is usable right now. */
export type CopyState = "ready" | "stale" | "missing";

/** One piece, as an external agent sees it. A projection, not the document. */
export interface AgentSlot {
  id: string;
  date: string | null;
  time_local: string | null;
  timezone: string;
  scheduled_at: string | null;
  channel: string;
  format: string;
  format_label: string;
  status: string;
  publishable: boolean;
  campaign: { id: string; title: string | null } | null;
  theme: string;
  brief: {
    one_line: string;
    hook: string;
    body: string[];
    cta: string;
    rationale: string;
  };
  copy: {
    state: CopyState;
    headline: string | null;
    blocks: { label: string; text: string; on_screen: string | null }[];
    caption: string | null;
    hashtags: string[];
    authored_by: "agent" | "human" | null;
    generated_at: string | null;
    edited_at: string | null;
  };
  published: {
    external_id: string | null;
    external_url: string | null;
    published_at: string;
  } | null;
  updated_at: string | null;
}
