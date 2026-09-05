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
  Client,
  ClientListItem,
  ScheduledAsset,
  CalendarItem,
  Agency,
} from "./types";

import { auth } from "./firebase";

const API = "/api/v1";

// API routes authenticate with a Firebase ID token. getIdToken() returns the
// cached token and refreshes it only when close to expiry, so calling it per
// request is cheap.
async function authHeader(): Promise<Record<string, string>> {
  const user = auth?.currentUser;
  if (!user) return {};
  try {
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  } catch {
    return {};
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    // Merged after the spread: spreading options last would drop Content-Type
    // whenever a caller passed headers of its own.
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API error ${res.status}: ${error}`);
  }
  return res.json();
}

// Helper to prefix client-scoped paths
const c = (clientId: string) => `/clients/${clientId}`;

// Clients
export const listClients = (params?: { status?: string; search?: string }) => {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.search) search.set("search", params.search);
  const qs = search.toString();
  return request<ClientListItem[]>(`/clients${qs ? `?${qs}` : ""}`);
};

export const getClient = (id: string) => request<Client>(`/clients/${id}`);

export const createClient = (data: { name: string; website_url?: string; logo_url?: string; description?: string; contact_email?: string; contact_phone?: string; timezone?: string }) =>
  request<Client>("/clients", { method: "POST", body: JSON.stringify(data) });

export const updateClient = (id: string, data: Record<string, unknown>) =>
  request<Client>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteClient = (id: string) =>
  request<{ archived: boolean }>(`/clients/${id}`, { method: "DELETE" });

// Runs
export const triggerRun = (clientId: string, taskType: string, campaignId?: string) => {
  const qs = campaignId ? `?campaign_id=${campaignId}` : "";
  return request<{ run_id: string; status: string }>(`${c(clientId)}/runs/tasks/${taskType}${qs}`, {
    method: "POST",
  });
};

export const getRun = (clientId: string, runId: string) =>
  request<Run>(`${c(clientId)}/runs/${runId}`);

export const listRuns = (clientId: string, params?: { task_type?: string; status?: string; limit?: number; offset?: number }) => {
  const search = new URLSearchParams();
  if (params?.task_type) search.set("task_type", params.task_type);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return request<RunListItem[]>(`${c(clientId)}/runs${qs ? `?${qs}` : ""}`);
};

// Strategy
export const getStrategy = (clientId: string) =>
  request<Strategy>(`${c(clientId)}/strategy`);

export const updateStrategy = (clientId: string, data: Partial<Strategy>) =>
  request<Strategy>(`${c(clientId)}/strategy`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Tasks (agency-level, no clientId)
export const listTasks = () => request<TaskConfig[]>("/tasks");

export const updateTask = (taskType: string, data: Partial<TaskConfig>) =>
  request<TaskConfig>(`/tasks/${taskType}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Feedback
export const submitFeedback = (clientId: string, data: {
  run_id: string;
  asset_index: number;
  rating: number;
  comment?: string;
  save_asset?: boolean;
}) => request<Feedback>(`${c(clientId)}/feedback`, { method: "POST", body: JSON.stringify(data) });

export const triggerDebrief = (clientId: string, runId: string) =>
  request<{ status: string; debrief: Record<string, unknown> }>(
    `${c(clientId)}/feedback/${runId}/debrief`,
    { method: "POST" }
  );

// Assets
export const listAssets = (clientId: string, params?: { type?: string; min_rating?: number; limit?: number; campaign_id?: string }) => {
  const search = new URLSearchParams();
  if (params?.type) search.set("type", params.type);
  if (params?.min_rating) search.set("min_rating", String(params.min_rating));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.campaign_id) search.set("campaign_id", params.campaign_id);
  const qs = search.toString();
  return request<SavedAsset[]>(`${c(clientId)}/assets${qs ? `?${qs}` : ""}`);
};

export const createAsset = (clientId: string, data: { type: string; content: Record<string, unknown>; rating?: number; campaign_id?: string }) =>
  request<SavedAsset>(`${c(clientId)}/assets`, { method: "POST", body: JSON.stringify(data) });

export const generateAsset = (clientId: string, data: { type: string; brief: string; campaign_id?: string }) =>
  request<{ type: string; content: string; campaign_id?: string }>(`${c(clientId)}/assets/generate`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAsset = (clientId: string, id: string, data: { type?: string; content?: Record<string, unknown>; rating?: number }) =>
  request<SavedAsset>(`${c(clientId)}/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteAsset = (clientId: string, id: string) =>
  request<{ deleted: boolean }>(`${c(clientId)}/assets/${id}`, { method: "DELETE" });

// Onboarding
export const runResearch = (clientId: string, data: ResearchRequest) =>
  request<Record<string, unknown>>(`${c(clientId)}/onboarding/research`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createProfile = (clientId: string, data: { research: Record<string, unknown>; overrides?: Record<string, unknown> }) =>
  request<Strategy>(`${c(clientId)}/onboarding/profile`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// Memory
export const listSummaries = (clientId: string, limit = 10) =>
  request<MemorySummary[]>(`${c(clientId)}/memory/summaries?limit=${limit}`);

export const createSummary = (clientId: string, data: { period_start: string; period_end: string }) =>
  request<MemorySummary>(`${c(clientId)}/memory/summaries`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// Campaigns
export const listCampaigns = (clientId: string, status?: string) => {
  const qs = status ? `?status=${status}` : "";
  return request<CampaignListItem[]>(`${c(clientId)}/campaigns${qs}`);
};

export const getCampaign = (clientId: string, id: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}`);

export const createCampaign = (clientId: string, data: { title: string; description?: string }) =>
  request<Campaign>(`${c(clientId)}/campaigns`, { method: "POST", body: JSON.stringify(data) });

export const updateCampaign = (clientId: string, id: string, data: Record<string, unknown>) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteCampaign = (clientId: string, id: string) =>
  request<{ deleted: boolean }>(`${c(clientId)}/campaigns/${id}`, { method: "DELETE" });

export const generateCampaigns = (clientId: string, data: { prompt?: string; count?: number }) =>
  request<Campaign[]>(`${c(clientId)}/campaigns/generate`, { method: "POST", body: JSON.stringify(data) });

export const reviewCampaign = (clientId: string, id: string, comment: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}/review`, { method: "POST", body: JSON.stringify({ comment }) });

export const improveCampaign = (clientId: string, id: string, comment: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}/improve`, { method: "POST", body: JSON.stringify({ comment }) });

export const acceptCampaign = (clientId: string, id: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}/accept`, { method: "POST" });

export const rejectCampaign = (clientId: string, id: string, reason: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });

export const completeCampaign = (clientId: string, id: string) =>
  request<Campaign>(`${c(clientId)}/campaigns/${id}/complete`, { method: "POST" });

// Agency (settings)
export const getAgency = () => request<Agency>("/agencies/current");

export const updateAgency = (data: { name?: string }) =>
  request<Agency>("/agencies/current", {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// Auth
export const getAuthMe = () =>
  request<{ user_email: string; agency_id: string; google_connected: boolean }>("/auth/me");

export const signOutApi = () =>
  request<{ signed_out: boolean }>("/auth/signout", { method: "POST" });

// Schedule
export const scheduleAsset = (
  clientId: string,
  runId: string,
  assetIndex: number,
  scheduledFor: string,
) =>
  request<ScheduledAsset>(
    `${c(clientId)}/runs/${runId}/assets/${assetIndex}/schedule`,
    { method: "POST", body: JSON.stringify({ scheduled_for: scheduledFor }) },
  );

export const markAssetPosted = (clientId: string, assetId: string) =>
  request<ScheduledAsset>(`${c(clientId)}/assets/${assetId}/posted`, {
    method: "POST",
  });

export const unscheduleAsset = (clientId: string, assetId: string) =>
  request<ScheduledAsset>(`${c(clientId)}/assets/${assetId}/schedule`, {
    method: "DELETE",
  });

export const getCalendar = (clientId: string, start: string, end: string) =>
  request<CalendarItem[]>(`${c(clientId)}/calendar?start=${start}&end=${end}`);

export const getCalendarUrls = (clientId: string) =>
  request<{ calendar_id: string | null; embed_url: string | null; open_url: string | null }>(
    `${c(clientId)}/calendar/urls`,
  );
