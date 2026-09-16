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
  signals: "marketing_signals",
  lessons: "marketing_lessons",
  apiKeys: "marketing_api_keys",
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
    // What it is doing right now, while status is "running". The work takes
    // minutes; without this the UI can only show a spinner and hope.
    progress: d.progress ?? null,
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
    // derived UTC instant. week_key is denormalized so the quota check needs no
    // date arithmetic at read time.
    //
    // All four are null on an unscheduled piece, and null rather than "" on
    // purpose: an empty string sorts and compares as a real date, so it slips
    // through range filters like `slot.date < start` instead of being caught.
    date: d.date ? str(d.date) : null,
    time_local: d.timeLocal ? str(d.timeLocal) : null,
    timezone: str(d.timezone, "UTC"),
    scheduled_at: toISO(d.scheduledAt),
    week_key: d.weekKey ? str(d.weekKey) : null,
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
    // Written only by the agent API. `reported_at` is ours and arrives as a
    // Timestamp; `published_at` is the platform's own and arrives as a string.
    // toISO handles both, which is what it is for.
    publication: publication(d.publication),
    last_publish_error: d.lastPublishError
      ? {
          reason: str((d.lastPublishError as Record<string, unknown>).reason),
          reported_at: toISO((d.lastPublishError as Record<string, unknown>).reportedAt),
        }
      : null,
    created_at: toISO(d.createdAt),
    updated_at: toISO(d.updatedAt),
  };
}

/** Null unless there is an external id — a publication without one is debris. */
function publication(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const externalId = str(p.externalId);
  if (!externalId) return null;
  return {
    external_id: externalId,
    external_url: typeof p.externalUrl === "string" ? p.externalUrl : null,
    published_at: toISO(p.publishedAt) ?? "",
    reported_at: toISO(p.reportedAt),
    idempotency_key: str(p.idempotencyKey),
    key_prefix: typeof p.keyPrefix === "string" ? p.keyPrefix : null,
  };
}

/**
 * Force a stored observation into the shape callers expect.
 *
 * Runs made before planning stopped placing dates hold `gaps`, `capacity` and a
 * horizon instead of `demand`, and passing that through raw is what put an
 * `undefined.map()` on the Plan page for anyone with history. Every other field
 * here already defends itself; this one was typed as though the store had been
 * migrated when it had not.
 *
 * Old runs come back readable and empty rather than being rewritten: the plan
 * they describe is either committed, in which case its slots are the record, or
 * abandoned, in which case nothing is owed to it.
 */
function planObservation(value: unknown) {
  const o = (value ?? {}) as Record<string, unknown>;
  return {
    demand: Array.isArray(o.demand) ? o.demand : [],
    campaigns: Array.isArray(o.campaigns) ? o.campaigns : [],
    totalOutstanding:
      typeof o.totalOutstanding === "number"
        ? o.totalOutstanding
        : typeof o.totalDeficit === "number"
          ? o.totalDeficit
          : 0,
    warnings: Array.isArray(o.warnings) ? o.warnings : [],
  };
}

export function serializePlanRun(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    // The campaign this run was generated for. Null on every run made before
    // planning was scoped, which is why the campaign page filters by it rather
    // than assuming it: an old client-wide run must not be mistaken for one
    // belonging to whichever campaign happens to be open.
    campaign_id: d.campaignId ?? null,
    status: str(d.status, "proposed"),
    // What each campaign owed when the run was made. `horizon` is only present
    // on runs from before planning stopped placing dates; it is passed through
    // so those still render rather than being migrated.
    demand: Array.isArray(d.demand) ? d.demand : [],
    horizon: d.horizon ?? undefined,
    // The observation snapshot, kept so a no-op run is diagnosable rather than
    // silently empty. Normalised, because a run predating the campaign-demand
    // model carries a completely different shape.
    observation: planObservation(d.observation),
    proposed_slots: Array.isArray(d.proposedSlots) ? d.proposedSlots : [],
    // Ideas a human rejected before commit. Absent on every run predating the
    // drop feature, hence the fallback rather than a migration.
    dropped_slots: Array.isArray(d.droppedSlots) ? d.droppedSlots : [],
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

/* ----------------------------------------------------- the feedback loop -- */

function brief(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  return {
    theme: str(d.theme, ""),
    hook: str(d.hook, ""),
    body: Array.isArray(d.body) ? d.body.map((b) => String(b)) : [],
    cta: str(d.cta, ""),
  };
}

export function serializeSignal(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    client_id: d.clientId ?? null,
    kind: str(d.kind, "edited"),
    scope: str(d.scope, "plan_themes"),
    type: str(d.type, ""),
    channel: str(d.channel, ""),
    slot_id: d.slotId ?? null,
    campaign_id: d.campaignId ?? null,
    plan_run_id: d.planRunId ?? null,
    reason: str(d.reason, ""),
    before: brief(d.before),
    after: brief(d.after),
    changed: Array.isArray(d.changed) ? d.changed.map((c) => String(c)) : [],
    created_at: toISO(d.createdAt) ?? "",
  };
}

export function serializeLesson(id: string, d: FirebaseFirestore.DocumentData) {
  const evidence = Array.isArray(d.evidence) ? d.evidence.map((e) => String(e)) : [];
  return {
    id,
    client_id: d.clientId ?? null,
    text: str(d.text, ""),
    scope: str(d.scope, "plan_themes"),
    status: d.retiredAt ? "retired" : "active",
    source: str(d.source, "written"),
    // Never read yet. See the note on Lesson.owner in lib/types.ts.
    owner: str(d.owner, "client"),
    evidence,
    // Stored rather than derived from evidence.length: a distilled lesson can
    // cite more episodes than it keeps ids for.
    evidence_count: typeof d.evidenceCount === "number" ? d.evidenceCount : evidence.length,
    created_at: toISO(d.createdAt) ?? "",
    retired_at: toISO(d.retiredAt),
  };
}

/**
 * A key, as the app shows it back. The secret is never in the document, so
 * there is nothing to withhold here — `id` is the sha256, which identifies the
 * key for revocation without being able to authenticate as it.
 *
 * Status is derived rather than stored, like serializeLesson's: storing it
 * would let it disagree with the timestamps, and expiry passes on its own
 * without anyone writing anything.
 */
export function serializeApiKey(id: string, d: FirebaseFirestore.DocumentData) {
  const expiresAt = toISO(d.expiresAt);
  const revokedAt = toISO(d.revokedAt);
  const expired = !!expiresAt && Date.parse(expiresAt) <= Date.now();
  return {
    id,
    // Null means every client in the agency, present and future. A key minted
    // before the allowlist stored a single clientId; both shapes are read here
    // so nothing needs migrating.
    client_ids: Array.isArray(d.clientIds)
      ? strArray(d.clientIds)
      : d.clientId
        ? [String(d.clientId)]
        : null,
    agency_id: d.agencyId ?? null,
    name: str(d.name, ""),
    prefix: str(d.prefix, ""),
    // Whatever is on the document, not what this version knows about: a scope
    // dropped from the union must still be visible so it can be revoked.
    scopes: strArray(d.scopes),
    status: revokedAt ? "revoked" : expired ? "expired" : "active",
    created_by: d.createdBy ?? null,
    created_at: toISO(d.createdAt),
    last_used_at: toISO(d.lastUsedAt),
    expires_at: expiresAt,
    revoked_at: revokedAt,
  };
}
