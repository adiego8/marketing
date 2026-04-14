import type {
  Run,
  RunListItem,
  Strategy,
  TaskConfig,
  Feedback,
  SavedAsset,
  MemorySummary,
  ResearchRequest,
  Campaign,
  CampaignListItem,
} from "./types";

const API = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API error ${res.status}: ${error}`);
  }
  return res.json();
}

// Runs
export const triggerRun = (taskType: string, campaignId?: string) => {
  const qs = campaignId ? `?campaign_id=${campaignId}` : "";
  return request<{ run_id: string; status: string }>(`/runs/tasks/${taskType}${qs}`, {
    method: "POST",
  });
};

export const getRun = (runId: string) => request<Run>(`/runs/${runId}`);

export const listRuns = (params?: { task_type?: string; limit?: number; offset?: number }) => {
  const search = new URLSearchParams();
  if (params?.task_type) search.set("task_type", params.task_type);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return request<RunListItem[]>(`/runs${qs ? `?${qs}` : ""}`);
};

// Strategy
export const getStrategy = () => request<Strategy>("/strategy");

export const updateStrategy = (data: Partial<Strategy>) =>
  request<Strategy>("/strategy", {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Tasks
export const listTasks = () => request<TaskConfig[]>("/tasks");

export const updateTask = (taskType: string, data: Partial<TaskConfig>) =>
  request<TaskConfig>(`/tasks/${taskType}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Feedback
export const submitFeedback = (data: {
  run_id: string;
  asset_index: number;
  rating: number;
  comment?: string;
  save_asset?: boolean;
}) => request<Feedback>("/feedback", { method: "POST", body: JSON.stringify(data) });

export const triggerDebrief = (runId: string) =>
  request<{ status: string; debrief: Record<string, unknown> }>(
    `/feedback/${runId}/debrief`,
    { method: "POST" }
  );

// Assets
export const listAssets = (params?: { type?: string; min_rating?: number; limit?: number; campaign_id?: string }) => {
  const search = new URLSearchParams();
  if (params?.type) search.set("type", params.type);
  if (params?.min_rating) search.set("min_rating", String(params.min_rating));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.campaign_id) search.set("campaign_id", params.campaign_id);
  const qs = search.toString();
  return request<SavedAsset[]>(`/assets${qs ? `?${qs}` : ""}`);
};

export const createAsset = (data: { type: string; content: Record<string, unknown>; rating?: number; campaign_id?: string }) =>
  request<SavedAsset>("/assets", { method: "POST", body: JSON.stringify(data) });

export const generateAsset = (data: { type: string; brief: string; campaign_id?: string }) =>
  request<{ type: string; content: string; campaign_id?: string }>("/assets/generate", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAsset = (id: string, data: { type?: string; content?: Record<string, unknown>; rating?: number }) =>
  request<SavedAsset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteAsset = (id: string) =>
  request<{ deleted: boolean }>(`/assets/${id}`, { method: "DELETE" });

// Onboarding
export const runResearch = (data: ResearchRequest) =>
  request<Record<string, unknown>>("/onboarding/research", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createProfile = (data: { research: Record<string, unknown>; overrides?: Record<string, unknown> }) =>
  request<Strategy>("/onboarding/profile", {
    method: "POST",
    body: JSON.stringify(data),
  });

// Memory
export const listSummaries = (limit = 10) =>
  request<MemorySummary[]>(`/memory/summaries?limit=${limit}`);

export const createSummary = (data: { period_start: string; period_end: string }) =>
  request<MemorySummary>("/memory/summaries", {
    method: "POST",
    body: JSON.stringify(data),
  });

// Campaigns
export const listCampaigns = (status?: string) => {
  const qs = status ? `?status=${status}` : "";
  return request<CampaignListItem[]>(`/campaigns${qs}`);
};

export const getCampaign = (id: string) => request<Campaign>(`/campaigns/${id}`);

export const createCampaign = (data: { title: string; description?: string }) =>
  request<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(data) });

export const updateCampaign = (id: string, data: Record<string, unknown>) =>
  request<Campaign>(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteCampaign = (id: string) =>
  request<{ deleted: boolean }>(`/campaigns/${id}`, { method: "DELETE" });

export const generateCampaigns = (data: { prompt?: string; count?: number }) =>
  request<Campaign[]>("/campaigns/generate", { method: "POST", body: JSON.stringify(data) });

export const reviewCampaign = (id: string, comment: string) =>
  request<Campaign>(`/campaigns/${id}/review`, { method: "POST", body: JSON.stringify({ comment }) });

export const improveCampaign = (id: string, comment: string) =>
  request<Campaign>(`/campaigns/${id}/improve`, { method: "POST", body: JSON.stringify({ comment }) });

export const acceptCampaign = (id: string) =>
  request<Campaign>(`/campaigns/${id}/accept`, { method: "POST" });

export const rejectCampaign = (id: string, reason: string) =>
  request<Campaign>(`/campaigns/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });

export const completeCampaign = (id: string) =>
  request<Campaign>(`/campaigns/${id}/complete`, { method: "POST" });
