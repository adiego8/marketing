import type {
  Strategy,
  Campaign,
  CampaignListItem,
  Client,
  ClientListItem,
  Slot,
  SlotStatus,
  PlanRun,
  ResearchRun,
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

// Research
export const listResearchRuns = (clientId: string) =>
  request<{ runs: ResearchRun[] }>(`${c(clientId)}/research`).then((r) => r.runs);

// Returns in milliseconds with a run in "running" — the work continues on the
// server via after(), so the caller polls listResearchRuns rather than waiting.
export const runResearch = (
  clientId: string,
  data: { steer?: string; competitors?: string } = {}
) =>
  request<ResearchRun>(`${c(clientId)}/research`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const acceptResearch = (clientId: string, runId: string) =>
  request<{ strategy: Strategy; run: ResearchRun }>(
    `${c(clientId)}/research/runs/${runId}/accept`,
    { method: "POST" }
  );

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
/** Writes everything the active campaigns still owe. Undated; no horizon. */
export const previewPlan = (clientId: string) =>
  request<PlanRun>(`${c(clientId)}/plan/preview`, { method: "POST" });

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

export const regenerateSlot = (
  clientId: string,
  slotId: string,
  data: { mode: "angle" | "rewrite"; steer?: string }
) =>
  request<Slot>(`${c(clientId)}/slots/${slotId}/regenerate`, {
    method: "POST",
    body: JSON.stringify(data),
  });

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
    /** Slots whose date and time followed a move made in Google. */
    adopted: number;
    /** Slots cancelled because their event is gone from Google. */
    cancelled: number;
    /** Slots whose text Google now owns. */
    locked: number;
    calendarId: string;
    errors: string[];
    /** Reconcile refused or degraded — not a per-slot failure. */
    warnings: string[];
    /** One line per Google-side change adopted, written for a person. */
    changes: string[];
    embed_url: string;
    open_url: string;
  }>(`${c(clientId)}/calendar/sync`, {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  });

// Slots
export const listSlots = (
  clientId: string,
  params?: {
    start?: string;
    end?: string;
    status?: string;
    /** "unscheduled" for accepted pieces still waiting for a day. */
    dated?: "scheduled" | "unscheduled";
  }
) => {
  const q = new URLSearchParams();
  if (params?.start) q.set("start", params.start);
  if (params?.end) q.set("end", params.end);
  if (params?.status) q.set("status", params.status);
  if (params?.dated) q.set("dated", params.dated);
  const qs = q.toString();
  return request<Slot[]>(`${c(clientId)}/slots${qs ? `?${qs}` : ""}`);
};

/**
 * Give a piece a day, or move it.
 *
 * The response carries `quota_warning` when the week goes over its cap — the
 * write still happened; the warning is advice, not a rejection.
 */
export const scheduleSlot = (
  clientId: string,
  slotId: string,
  schedule: { date: string; timeLocal?: string }
) =>
  request<Slot & { quota_warning: string | null }>(
    `${c(clientId)}/slots/${slotId}/schedule`,
    { method: "PATCH", body: JSON.stringify(schedule) }
  );

export interface SlotEdit {
  status?: SlotStatus;
  pinned?: boolean;
  theme?: string;
  brief?: string;
  rationale?: string;
  hook?: string;
  body?: string[];
  cta?: string;
  /** The finished copy. null clears it. */
  content?: Record<string, unknown> | null;
  /**
   * Take an event's text back from Google after a hand edit there locked it.
   * The only way out of a lock, so the rule is not permanent.
   */
  google_event_locked?: boolean;
}

/**
 * Write the finished, publishable words from the brief the slot carries.
 *
 * Returns the updated slot plus any platform-limit warnings — a tweet over 280
 * is worth saying out loud rather than silently shortening.
 */
export const writeSlotCopy = (
  clientId: string,
  slotId: string,
  data: { steer?: string } = {}
) =>
  request<Slot & { warnings: string[] }>(`${c(clientId)}/slots/${slotId}/copy`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateSlot = (clientId: string, slotId: string, data: SlotEdit) =>
  request<Slot>(`${c(clientId)}/slots/${slotId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deletePlanRun = (clientId: string, runId: string) =>
  request<{
    deleted: boolean;
    deletedSlots: number;
    removedEvents: number;
    wasCommitted: boolean;
  }>(`${c(clientId)}/plan/runs/${runId}`, { method: "DELETE" });

export const commitPlan = (clientId: string, runId: string) =>
  request<PlanRun>(`${c(clientId)}/plan/runs/${runId}/commit`, { method: "POST" });

/**
 * Editing a preview before it is committed.
 *
 * All three return the whole run, so the page replaces its state rather than
 * patching it — the same habit as commitPlan. `drop_warnings` carries what
 * could not be done (a slot already replaced, say) without failing the call.
 */
type PlanRunEdit = PlanRun & { drop_warnings?: string[]; replaced?: number };

export const dropPlanSlots = (
  clientId: string,
  runId: string,
  drops: { slotId: string; reason?: string }[]
) =>
  request<PlanRunEdit>(`${c(clientId)}/plan/runs/${runId}/drop`, {
    method: "POST",
    body: JSON.stringify({ drops }),
  });

export const restorePlanSlots = (clientId: string, runId: string, slotIds: string[]) =>
  request<PlanRunEdit>(`${c(clientId)}/plan/runs/${runId}/restore`, {
    method: "POST",
    body: JSON.stringify({ slotIds }),
  });

/** One model call for every dropped slot. Empty `slotIds` means all of them. */
export const replaceDroppedSlots = (
  clientId: string,
  runId: string,
  slotIds: string[] = []
) =>
  request<PlanRunEdit>(`${c(clientId)}/plan/runs/${runId}/replace`, {
    method: "POST",
    body: JSON.stringify({ slotIds }),
  });
