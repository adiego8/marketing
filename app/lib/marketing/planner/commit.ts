import { db, COLLECTIONS, FieldValue } from "../../firestore";
import { listCampaigns } from "../campaigns";
import { getStrategy } from "../strategy";
import type { QuotaEntry } from "../strategy";
import {
  fingerprintInputs,
  getPlanRun,
  loadPlannerSlots,
  toCampaignWindow,
} from "./plan-runs";
import type { ProposedSlot } from "./types";

/**
 * Turn a previewed plan into real slots.
 *
 * The preview deliberately writes nothing, so this is the only place in the
 * planner that creates calendar state. Three things guard it:
 *
 *  1. A run can be committed once. `committedAt` is checked and set.
 *  2. The plan is refused if the inputs it was computed from have moved on —
 *     see the fingerprint check below. This is the important one.
 *  3. Slot ids are deterministic and written with create(), so a double click
 *     or a retried request cannot produce a second copy of the same slot.
 *
 * The whole thing is one atomic batch: either every slot and the run's own
 * bookkeeping land together, or nothing does. A half-committed plan would be
 * the worst outcome here, because the observe stage counts existing slots and
 * would then see a quota partly met with no record of why.
 */

export class PlanAlreadyCommittedError extends Error {
  constructor() {
    super("This plan has already been committed.");
    this.name = "PlanAlreadyCommittedError";
  }
}

export class NothingToCommitError extends Error {
  constructor() {
    super("This plan proposed no slots, so there is nothing to commit.");
    this.name = "NothingToCommitError";
  }
}

export class StalePlanError extends Error {
  constructor() {
    super(
      "The calendar or strategy changed after this plan was generated. " +
        "Generate a new preview so you can see what would actually be scheduled."
    );
    this.name = "StalePlanError";
  }
}

/**
 * Recompute the fingerprint of everything the plan was derived from.
 *
 * Mirrors the inputs planFromInputs hashes. Not a formality: between preview
 * and commit someone can change the weekly quota, retire a campaign, or add a
 * slot by hand — and committing a stale plan would silently schedule content
 * against a strategy that no longer exists.
 */
async function currentFingerprint(
  clientId: string,
  horizon: { startDate: string; endDate: string; timezone: string }
): Promise<string | null> {
  const strategy = await getStrategy(clientId);
  if (!strategy) return null;

  const [campaigns, slots] = await Promise.all([
    listCampaigns(clientId, "active"),
    loadPlannerSlots(clientId, horizon.startDate, horizon.endDate),
  ]);

  return fingerprintInputs({
    quota: (strategy.content_quota?.weekly ?? {}) as Record<string, QuotaEntry>,
    campaigns: campaigns.map(toCampaignWindow),
    slots,
    startDate: horizon.startDate,
    endDate: horizon.endDate,
    timezone: horizon.timezone,
  });
}

/**
 * The Firestore shape of a slot.
 *
 * Field names must match what loadPlannerSlots reads. If they drift, committed
 * slots stop being counted against quota and every later run re-proposes
 * content that is already scheduled — silently, because nothing errors.
 * Exported so a test can hold the two in agreement.
 */
export function slotDoc(clientId: string, runId: string, slot: ProposedSlot) {
  return {
    clientId,
    planRunId: runId,
    gapId: slot.gapId,
    date: slot.date,
    timeLocal: slot.timeLocal,
    timezone: slot.timezone,
    scheduledAt: slot.scheduledAt,
    weekKey: slot.weekKey,
    type: slot.type,
    channel: slot.channel,
    campaignId: slot.campaignId,
    campaignTitle: slot.campaignTitle,
    theme: slot.theme,
    brief: slot.brief,
    rationale: slot.rationale,
    needsTheme: slot.needsTheme,
    status: "planned",
    // Human edits set this; the planner never moves a pinned slot.
    pinned: false,
    // Distinguishes planner output from a slot someone added by hand.
    source: "agent",
    // The written copy, once there is any. Nothing produces it yet.
    content: null,
    // Phase 4 fills these when the slot reaches Google Calendar. The names
    // must match serializeSlot — this was `calendarEventId` and so every
    // committed slot read back as unsynced regardless of the truth.
    googleEventId: null,
    googleSyncStatus: "pending",
    lastHumanEditAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * @returns the updated plan run, or null when the run does not exist.
 * @throws PlanAlreadyCommittedError | NothingToCommitError | StalePlanError
 */
export async function commitPlan(clientId: string, runId: string) {
  const run = await getPlanRun(clientId, runId);
  if (!run) return null;

  if (run.committed_at) throw new PlanAlreadyCommittedError();
  if (run.proposed_slots.length === 0) throw new NothingToCommitError();

  // Only meaningful if the run recorded one. Runs predating the fingerprint
  // are committed without the check rather than being made uncommittable.
  if (run.inputs_fingerprint) {
    const now = await currentFingerprint(clientId, run.horizon);
    if (now !== run.inputs_fingerprint) throw new StalePlanError();
  }

  const batch = db().batch();
  const slotIds: string[] = [];

  for (const slot of run.proposed_slots) {
    const ref = db().collection(COLLECTIONS.slots).doc(slot.slotId);
    // create(), not set(): if this id already exists the whole batch fails
    // rather than overwriting a slot someone else owns.
    batch.create(ref, slotDoc(clientId, runId, slot));
    slotIds.push(slot.slotId);
  }

  batch.update(db().collection(COLLECTIONS.planRuns).doc(runId), {
    status: "committed",
    createdSlotIds: slotIds,
    committedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  const updated = await getPlanRun(clientId, runId);
  return updated;
}
