import { createHash } from "crypto";
import { db, COLLECTIONS, FieldValue, serializePlanRun, serializeSlot } from "../../firestore";
import { deleteSlotEvents } from "../calendar";
import type { Slot } from "../../types";
import { isChannel, type Channel } from "../posting-windows";
import type { CampaignWindow, ExistingSlot, IsoDate } from "./types";

// Firestore IO for the planner. Kept apart from the algorithm so every pure
// module stays testable without a database.

/** Load the slots in the horizon that the planner needs to reason about. */
export async function loadPlannerSlots(
  clientId: string,
  start: IsoDate,
  end: IsoDate
): Promise<ExistingSlot[]> {
  // Filtered on clientId only, with the date range applied in memory. Adding
  // the range to the query needs a (clientId, date) composite index, and a
  // client's slots are bounded — a few hundred a year at any realistic quota —
  // so this keeps the app working with zero Firestore setup. The index is still
  // declared in firestore.indexes.json; deploy it and this can become a range
  // query again if slot volume ever justifies it.
  const snap = await db()
    .collection(COLLECTIONS.slots)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .filter((doc) => {
      const date = String(doc.data().date ?? "");
      return date >= start && date <= end;
    })
    .map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      date: String(d.date ?? ""),
      timeLocal: String(d.timeLocal ?? "09:00"),
      weekKey: String(d.weekKey ?? ""),
      type: String(d.type ?? ""),
      channel: String(d.channel ?? ""),
      status: String(d.status ?? "planned"),
      campaignId: d.campaignId ?? null,
      pinned: d.pinned === true,
    };
  });
}

/** Recent themes, so the planner does not propose something already scheduled. */
export async function loadRecentThemes(clientId: string, limit = 20) {
  const snap = await db()
    .collection(COLLECTIONS.slots)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => doc.data())
    .filter((d) => typeof d.theme === "string" && d.theme)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, limit)
    .map((d) => ({
      date: String(d.date ?? ""),
      type: String(d.type ?? ""),
      theme: String(d.theme ?? ""),
    }));
}

/** Map a serialized campaign into the shape the planner reasons about. */
export function toCampaignWindow(campaign: {
  id: string;
  title: string;
  description: string | null;
  strategy: Record<string, unknown>;
  content_plan: Record<string, unknown>;
  start_date: string | null;
  end_date: string | null;
}): CampaignWindow {
  const plan = campaign.content_plan as {
    breakdown?: { type?: unknown; count?: unknown }[];
    total_pieces?: unknown;
    timeline?: { week?: unknown; focus?: unknown }[];
  };

  const plannedByType: Record<string, number> = {};
  if (Array.isArray(plan?.breakdown)) {
    for (const row of plan.breakdown) {
      if (typeof row?.type === "string" && typeof row?.count === "number") {
        plannedByType[row.type] = row.count;
      }
    }
  }

  const summed = Object.values(plannedByType).reduce((a, b) => a + b, 0);
  const strategy = campaign.strategy as { goal?: unknown; key_message?: unknown; channels?: unknown };

  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description ?? "",
    startDate: campaign.start_date,
    endDate: campaign.end_date,
    goal: typeof strategy?.goal === "string" ? strategy.goal : "",
    keyMessage: typeof strategy?.key_message === "string" ? strategy.key_message : "",
    plannedByType,
    plannedTotal:
      typeof plan?.total_pieces === "number" && plan.total_pieces > 0
        ? plan.total_pieces
        : summed,
    channels: Array.isArray(strategy?.channels)
      ? (strategy.channels.filter(isChannel) as Channel[])
      : [],
    timeline: Array.isArray(plan?.timeline)
      ? plan.timeline
          .filter((t) => typeof t?.week === "number" && typeof t?.focus === "string")
          .map((t) => ({ week: t.week as number, focus: t.focus as string }))
      : [],
  };
}

/**
 * A stable hash of everything the plan was computed from.
 *
 * Phase 3's commit recomputes this and refuses a preview whose inputs have
 * moved on, so a stale plan cannot be written over a calendar that changed
 * underneath it.
 */
export function fingerprintInputs(input: {
  quota: Record<string, { count: number; channels: string[] }>;
  campaigns: CampaignWindow[];
  slots: ExistingSlot[];
  startDate: string;
  endDate: string;
  timezone: string;
}): string {
  const canonical = {
    quota: Object.keys(input.quota)
      .sort()
      .map((type) => ({
        type,
        count: input.quota[type].count,
        channels: [...input.quota[type].channels].sort(),
      })),
    campaigns: input.campaigns
      .map((c) => ({
        id: c.id,
        startDate: c.startDate,
        endDate: c.endDate,
        plannedTotal: c.plannedTotal,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    slotIds: input.slots.map((s) => s.id).sort(),
    horizon: {
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: input.timezone,
    },
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function createPlanRun(clientId: string, doc: Record<string, unknown>) {
  const ref = db().collection(COLLECTIONS.planRuns).doc();
  await ref.set({ clientId, ...doc, createdAt: FieldValue.serverTimestamp() });
  const snap = await ref.get();
  return serializePlanRun(ref.id, snap.data() ?? {});
}

/**
 * Sorted in memory so no composite index is needed to run the app.
 *
 * This is the one query where that habit has a real cost: plan runs accumulate
 * without bound and each carries a full observation blob, so every call pulls
 * them all back. Fine at MVP volume, wrong at a few hundred runs per client.
 * The (clientId, createdAt desc) index is declared in firestore.indexes.json —
 * once it is deployed, move the sort and limit back into the query.
 */
export async function listPlanRuns(clientId: string, limit = 20) {
  const snap = await db()
    .collection(COLLECTIONS.planRuns)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => serializePlanRun(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit);
}

export interface DeletePlanRunResult {
  deletedSlots: number;
  removedEvents: number;
  wasCommitted: boolean;
}

/**
 * Delete a plan run and everything it created.
 *
 * Ordering is the mirror of the commit argument in calendar.ts: Google first,
 * then Firestore. A Google failure then leaves everything intact and
 * retryable, whereas deleting the slots first would orphan live calendar
 * events with no googleEventId left to find them by.
 *
 * Slots are addressed through the run's own createdSlotIds — direct document
 * refs, no query and no new composite index, matching the habit documented in
 * loadPlannerSlots above. Each is re-read and skipped unless its planRunId
 * still points here, so a slot that was re-pointed or hand-edited survives.
 *
 * Note this invalidates any OTHER uncommitted preview: fingerprintInputs
 * hashes the slot ids in the horizon, so removing slots correctly makes those
 * previews stale. That is the intended behaviour, not a bug — but the UI
 * should say so before someone presses the button.
 *
 * @returns null when the run does not exist or belongs to another agency.
 */
export async function deletePlanRun(
  clientId: string,
  runId: string,
  agencyId: string
): Promise<DeletePlanRunResult | null> {
  const run = await getPlanRun(clientId, runId);
  if (!run) return null;

  const runRef = db().collection(COLLECTIONS.planRuns).doc(runId);

  // Never committed: the run document is the only thing that exists.
  if (!run.committed_at) {
    await runRef.delete();
    return { deletedSlots: 0, removedEvents: 0, wasCommitted: false };
  }

  const refs = run.created_slot_ids.map((id) =>
    db().collection(COLLECTIONS.slots).doc(id)
  );
  const snaps = refs.length > 0 ? await db().getAll(...refs) : [];

  const mine = snaps.filter(
    (snap) => snap.exists && snap.data()?.planRunId === runId
  );
  const slots = mine.map((snap) => serializeSlot(snap.id, snap.data() ?? {}) as Slot);

  const removedEvents = await deleteSlotEvents(agencyId, clientId, slots);

  // One batch for the slots and the run, so the record and what it created
  // never disagree. Chunked at 500, Firestore's WriteBatch limit.
  const CHUNK = 400;
  for (let i = 0; i < mine.length; i += CHUNK) {
    const batch = db().batch();
    for (const snap of mine.slice(i, i + CHUNK)) batch.delete(snap.ref);
    if (i + CHUNK >= mine.length) batch.delete(runRef);
    await batch.commit();
  }
  if (mine.length === 0) await runRef.delete();

  return { deletedSlots: mine.length, removedEvents, wasCommitted: true };
}

export async function getPlanRun(clientId: string, runId: string) {
  const snap = await db().collection(COLLECTIONS.planRuns).doc(runId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.clientId !== clientId) return null;
  return serializePlanRun(snap.id, data);
}
