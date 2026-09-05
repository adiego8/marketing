export interface Run {
  id: string;
  task_type: string;
  campaign_id?: string;
  status: "running" | "completed" | "failed";
  context_snapshot?: Record<string, unknown>;
  output?: RunOutput;
  debrief?: Debrief;
  created_at: string;
  completed_at?: string;
}

export interface RunListItem {
  id: string;
  task_type: string;
  campaign_id?: string;
  status: "running" | "completed" | "failed";
  created_at: string;
  completed_at?: string;
}

export interface RunOutput {
  planning?: PlanningOutput;
  generation?: { assets: Asset[] };
  review?: { approved_assets: Asset[]; review_notes: string[]; attempts: number };
  post_production?: { produced_assets: Asset[]; review_notes?: string[] };
  deliver_slack?: { slack_message_ts?: string };
  log_run?: { logged: boolean };
  error?: string;
}

export interface PlanningOutput {
  topic: string;
  angle: string;
  tone: string;
  campaign_thread?: string;
  reasoning: string;
}

export interface Asset {
  type: string;
  content: string | Slide[];
  format?: string;
  format_reasoning?: string;
  platform_hint?: string;
  rationale?: AssetRationale;
  image_prompt?: string;
  generated_images?: string[];
  slides?: Slide[];
  duration?: string;
  goal?: string;
  priority?: string;
  effort?: string;
  suggested_scheduled_for?: string;
  schedule_reason?: string;
}

export interface ScheduledAsset {
  id: string;
  run_id?: string;
  campaign_id?: string;
  asset_index?: number;
  type: string;
  content: Record<string, unknown>;
  status: "draft" | "scheduled" | "posted";
  scheduled_for?: string;
  suggested_scheduled_for?: string;
  posted_at?: string;
  google_event_id?: string;
  saved_at: string;
}

export interface CalendarItem {
  id: string;
  run_id?: string;
  campaign_id?: string;
  campaign_title?: string;
  type: string;
  content: Record<string, unknown>;
  status: "draft" | "scheduled" | "posted";
  scheduled_for?: string;
  suggested_scheduled_for?: string;
  posted_at?: string;
  google_event_id?: string;
}

export interface Agency {
  id: string;
  name: string;
  google_connected_email?: string;
  google_connected: boolean;
  created_at: string;
}

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

export interface TaskConfig {
  id: string;
  task_type: string;
  name: string;
  description?: string;
  pipeline: PipelineStep[];
  schedule?: string;
  active: boolean;
}

export interface PipelineStep {
  step: string;
  config: Record<string, unknown>;
}

export interface SavedAsset {
  id: string;
  run_id?: string;
  campaign_id?: string;
  type: string;
  content: Record<string, unknown>;
  rating?: number;
  saved_at: string;
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

export interface Feedback {
  id: string;
  run_id: string;
  asset_index: number;
  rating: number;
  comment?: string;
  created_at: string;
}

export interface MemorySummary {
  id: string;
  period_start: string;
  period_end: string;
  summary: string;
  insights: Record<string, unknown>;
  created_at: string;
}

export interface ResearchRequest {
  company_name: string;
  website_url?: string;
  description?: string;
  competitors?: string[];
  research_focus?: string[];
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
