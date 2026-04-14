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

export interface Strategy {
  id: string;
  business_name: string;
  icp: Record<string, unknown>;
  voice: Record<string, unknown>;
  positioning: Record<string, unknown>;
  messaging: Record<string, unknown>;
  goals: Record<string, unknown>;
  content_quota: Record<string, unknown>;
  created_at: string;
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
  feedback_history: Array<{ feedback: string; improved_at?: string; submitted_at?: string; changes?: string }>;
  rejection_reason?: string;
  start_date?: string;
  end_date?: string;
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
