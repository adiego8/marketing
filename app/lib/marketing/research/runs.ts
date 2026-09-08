// Firestore IO for research runs, kept apart from the algorithm so parse.ts and
// run.ts stay testable without a database — the same split planner/plan-runs.ts
// makes.
//
// A run document is written only once the work has finished. There is no
// "running" state because there is nothing in this app that could set one: no
// queue, no worker, no cron. A research run is one blocking request, so the
// document exists or it does not.

import { db, COLLECTIONS, FieldValue, serializeResearchRun } from "../../firestore";
import type { ResearchResult } from "./run";

export async function createResearchRun(clientId: string, result: ResearchResult) {
  const ref = db().collection(COLLECTIONS.researchRuns).doc();
  await ref.set({
    clientId,
    status: result.status,
    inputs: result.inputs,
    dossier: result.dossier,
    draftStrategy: result.draft_strategy,
    openQuestions: result.open_questions,
    sources: result.sources,
    warnings: result.warnings,
    llm: result.llm,
    acceptedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  return serializeResearchRun(ref.id, snap.data() ?? {});
}

export async function getResearchRun(clientId: string, runId: string) {
  const snap = await db().collection(COLLECTIONS.researchRuns).doc(runId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  // Scoped to the client so a run id from another agency reads as missing.
  if (data.clientId !== clientId) return null;
  return serializeResearchRun(snap.id, data);
}

/**
 * Sorted in memory, so the app runs with no composite index deployed — the same
 * trade listPlanRuns makes, and the same caveat: research runs carry a dossier
 * each, so once a client has many of them this should move into the query. The
 * (clientId, createdAt desc) index is declared in firestore.indexes.json.
 */
export async function listResearchRuns(clientId: string, limit = 10) {
  const snap = await db()
    .collection(COLLECTIONS.researchRuns)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => serializeResearchRun(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit);
}

/** Stamp a run as accepted. Returns false if someone got there first. */
export async function markResearchAccepted(runId: string): Promise<boolean> {
  const ref = db().collection(COLLECTIONS.researchRuns).doc(runId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.acceptedAt) return false;
    tx.update(ref, { acceptedAt: FieldValue.serverTimestamp() });
    return true;
  });
}
