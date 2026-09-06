import type {
  Strategy,
  Campaign,
  CampaignListItem,
  Client,
  ClientListItem,
  Slot,
  SlotStatus,
  PlanRun,
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

// Strategy
export const getStrategy = (clientId: string) =>
  request<Strategy>(`${c(clientId)}/strategy`);

export const updateStrategy = (clientId: string, data: Partial<Strategy>) =>
  request<Strategy>(`${c(clientId)}/strategy`, {
    method: "PUT",
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

// Auth
export const getAuthMe = () =>
  request<{ user_email: string; agency_id: string; google_connected: boolean }>("/auth/me");

// Planner
export const previewPlan = (clientId: string, weeks = 2) =>
  request<PlanRun>(`${c(clientId)}/plan/preview`, {
    method: "POST",
    body: JSON.stringify({ weeks }),
  });

export const listPlanRuns = (clientId: string, limit = 20) =>
  request<PlanRun[]>(`${c(clientId)}/plan/runs?limit=${limit}`);

export const getPlanRun = (clientId: string, runId: string) =>
  request<PlanRun>(`${c(clientId)}/plan/runs/${runId}`);

/**
 * The plan as a PDF.
 *
 * Not `request()`: that parses JSON, and a download link cannot carry the
 * Authorization header every endpoint requires — so the bytes are fetched with
 * the token and handed to the browser as a blob.
 */
export async function downloadPlanPdf(
  clientId: string,
  params?: { start?: string; end?: string }
): Promise<{ blob: Blob; filename: string }> {
  const q = new URLSearchParams();
  if (params?.start) q.set("start", params.start);
  if (params?.end) q.set("end", params.end);

  const res = await fetch(
    `${API}${c(clientId)}/plan/export${q.toString() ? `?${q}` : ""}`,
    { headers: await authHeader() }
  );
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? "content-plan.pdf" };
}

// Google Calendar
export const getGoogleStatus = () =>
  request<{
    configured: boolean;
    missing: string[];
    connected: boolean;
    email: string | null;
    scopes: string[];
    needs_reconnect: boolean;
  }>("/google/status");

export const startGoogleConnect = (returnTo?: string) =>
  request<{ url: string }>("/google/start", {
    method: "POST",
    body: JSON.stringify({ returnTo }),
  });

export const disconnectGoogle = () =>
  request<{ connected: boolean }>("/google/disconnect", { method: "POST" });

export const syncCalendar = (
  clientId: string,
  params?: { start?: string; end?: string }
) =>
  request<{
    synced: number;
    failed: number;
    removed: number;
    calendarId: string;
    errors: string[];
    embed_url: string;
    open_url: string;
  }>(`${c(clientId)}/calendar/sync`, {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  });

// Slots
export const listSlots = (
  clientId: string,
  params?: { start?: string; end?: string; status?: string }
) => {
  const q = new URLSearchParams();
  if (params?.start) q.set("start", params.start);
  if (params?.end) q.set("end", params.end);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return request<Slot[]>(`${c(clientId)}/slots${qs ? `?${qs}` : ""}`);
};

export const updateSlot = (
  clientId: string,
  slotId: string,
  data: { status?: SlotStatus; pinned?: boolean }
) =>
  request<Slot>(`${c(clientId)}/slots/${slotId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const commitPlan = (clientId: string, runId: string) =>
  request<PlanRun>(`${c(clientId)}/plan/runs/${runId}/commit`, { method: "POST" });
