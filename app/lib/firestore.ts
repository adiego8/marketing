import { adminDb, adminInitError } from "./firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

// Server-side Firestore handle (Admin SDK). Throws if accessed without
// Firebase env vars configured, surfacing misconfig instead of silent no-ops.
export function db() {
  if (!adminDb) {
    throw new Error(
      adminInitError
        ? `Firestore is not configured: Firebase Admin credentials were rejected (${adminInitError}).`
        : "Firestore is not configured (missing Firebase Admin env vars)."
    );
  }
  return adminDb;
}

export { FieldValue, Timestamp };

// Collection names (single source of truth).
//
// Everything is marketing_* prefixed, including members and credentials. This
// app shares the `numerico-app` Firebase project with numerico-website and
// reminders-app, so reusing the bare `users` collection would mean any website
// admin is implicitly a marketing admin, and reusing `google_credentials` would
// collide with the website's own Gmail/Calendar grants. Sign-in is shared;
// authorisation is not.
export const COLLECTIONS = {
  agencies: "marketing_agencies",
  members: "marketing_members",
  clients: "marketing_clients",
  strategies: "marketing_strategies",
  campaigns: "marketing_campaigns",
  slots: "marketing_slots",
  planRuns: "marketing_plan_runs",
  researchRuns: "marketing_research_runs",
  googleCredentials: "marketing_google_credentials",
} as const;

// Convert Firestore Timestamps to ISO strings for JSON responses.
// Passes through strings already in ISO form; everything else becomes null.
export function toISO(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * The array sibling of str().
 *
 * A slot written before the piece structure existed has no `body` at all, and
 * must deserialize to [] rather than undefined — every render site maps over
 * it.
 */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// --- Serializers: camelCase in Firestore, snake_case in API responses ---

export function serializeClient(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    agency_id: d.agencyId ?? null,
    name: str(d.name),
    website_url: d.websiteUrl ?? null,
    logo_url: d.logoUrl ?? null,
    description: d.description ?? null,
    contact_email: d.contactEmail ?? null,
    contact_phone: d.contactPhone ?? null,
    status: str(d.status, "active"),
    // IANA zone. Every week boundary and local->UTC conversion depends on it.
    timezone: str(d.timezone, "UTC"),
    branding: d.branding ?? null,
    google_calendar_id: d.googleCalendarId ?? null,
    google_synced_at: toISO(d.googleSyncedAt),
    created_at: toISO(d.createdAt),
    updated_at: toISO(d.updatedAt),
  };
}

export function serializeStrategy(clientId: string, d: FirebaseFirestore.DocumentData) {
  return {
    client_id: clientId,
    business_name: str(d.businessName),
    icp: d.icp ?? {},
    voice: d.voice ?? {},
    positioning: d.positioning ?? {},
    messaging: d.messaging ?? {},
    goals: d.goals ?? {},
    // { weekly: { post: { count, channels[] } }, rationale }
    content_quota: d.contentQuota ?? {},
    content_strategy: d.contentStrategy ?? {},
    updated_at: toISO(d.updatedAt),
  };
}

export function serializeResearchRun(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    status: str(d.status, "complete"),
    // What it was told to research, so a thin run is diagnosable.
    inputs: d.inputs ?? {},
    dossier: d.dossier ?? {},
    draft_strategy: d.draftStrategy ?? {},
    open_questions: Array.isArray(d.openQuestions) ? d.openQuestions : [],
    // URLs the search actually cited. Every claim in the dossier points at one
    // of these; anything that did not was dropped before the run was stored.
    sources: Array.isArray(d.sources) ? d.sources : [],
    warnings: Array.isArray(d.warnings) ? d.warnings : [],
    llm: d.llm ?? null,
    // Set once, when a human accepts the draft into the strategy.
    accepted_at: toISO(d.acceptedAt),
    created_at: toISO(d.createdAt),
  };
}

export function serializeCampaign(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    title: str(d.title),
    description: d.description ?? null,
    status: str(d.status, "proposal"),
    strategy: d.strategy ?? {},
    // Shape is byte-identical to the Python campaign_generator output:
    // { total_pieces, breakdown: [{type, count, description}], timeline: [{week, focus}] }
    content_plan: d.contentPlan ?? {},
    pacing: str(d.pacing, "even"),
    feedback_history: Array.isArray(d.feedbackHistory) ? d.feedbackHistory : [],
    rejection_reason: d.rejectionReason ?? null,
    start_date: d.startDate ?? null,
    end_date: d.endDate ?? null,
    created_at: toISO(d.createdAt),
    updated_at: toISO(d.updatedAt),
  };
}

export function serializeSlot(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    campaign_id: d.campaignId ?? null,
    campaign_title: d.campaignTitle ?? null,
    plan_run_id: d.planRunId ?? null,
    gap_id: str(d.gapId),
    // Local calendar date + time in the client's timezone; scheduled_at is the
    // derived UTC instant. week_key is denormalized so quota math needs no
    // date arithmetic at read time.
    date: str(d.date),
    time_local: str(d.timeLocal),
    timezone: str(d.timezone, "UTC"),
    scheduled_at: toISO(d.scheduledAt),
    week_key: str(d.weekKey),
    type: str(d.type),
    channel: str(d.channel),
    theme: str(d.theme),
    brief: str(d.brief),
    rationale: str(d.rationale),
    hook: str(d.hook),
    body: strArray(d.body),
    cta: str(d.cta),
    needs_theme: d.needsTheme === true,
    status: str(d.status, "planned"),
    source: str(d.source, "agent"),
    pinned: d.pinned === true,
    content: d.content ?? null,
    google_event_id: d.googleEventId ?? null,
    google_sync_status: str(d.googleSyncStatus, "pending"),
    // Written by syncSlots on a failure and, until now, never read — so a
    // slot could sit in "error" with the reason invisible to the UI.
    google_sync_error: d.googleSyncError ?? null,
    // What the last push wrote, for reconcile. Null means "we do not know",
    // which classify() reads as "no divergence" rather than guessing.
    google_event_title: d.googleEventTitle ?? null,
    google_event_body_hash: d.googleEventBodyHash ?? null,
    google_event_locked: d.googleEventLocked === true,
    google_adopted_at: toISO(d.googleAdoptedAt),
    last_human_edit_at: toISO(d.lastHumanEditAt),
    created_at: toISO(d.createdAt),
    updated_at: toISO(d.updatedAt),
  };
}

export function serializePlanRun(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    status: str(d.status, "proposed"),
    horizon: d.horizon ?? {},
    // The observation snapshot and the decision, kept so a no-op run is
    // diagnosable rather than silently empty.
    observation: d.observation ?? {},
    proposed_slots: Array.isArray(d.proposedSlots) ? d.proposedSlots : [],
    deferred: Array.isArray(d.deferred) ? d.deferred : [],
    warnings: Array.isArray(d.warnings) ? d.warnings : [],
    created_slot_ids: Array.isArray(d.createdSlotIds) ? d.createdSlotIds : [],
    // Hash of everything the plan was computed from. The commit step compares
    // it against a freshly computed one and refuses a preview whose inputs have
    // moved on, so a stale plan cannot overwrite a calendar that changed.
    inputs_fingerprint: d.inputsFingerprint ?? null,
    llm: d.llm ?? null,
    committed_at: toISO(d.committedAt),
    created_at: toISO(d.createdAt),
  };
}

export { num };
