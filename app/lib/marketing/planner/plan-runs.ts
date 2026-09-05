import { createHash } from "crypto";
import { db, COLLECTIONS, FieldValue, serializePlanRun } from "../../firestore";
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

export async function getPlanRun(clientId: string, runId: string) {
  const snap = await db().collection(COLLECTIONS.planRuns).doc(runId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.clientId !== clientId) return null;
  return serializePlanRun(snap.id, data);
}
