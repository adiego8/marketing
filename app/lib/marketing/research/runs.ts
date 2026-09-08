// Firestore IO for research runs, kept apart from the algorithm so parse.ts and
// run.ts stay testable without a database — the same split planner/plan-runs.ts
// makes.
//
// A run row is written BEFORE any model call, as "running". That is the whole
// reason the feature survives navigation: the work happens in after(), which
// outlives the response, so the browser has nothing to hold open and a person
// who leaves the page can come back to it. The row is the shared state; the
// request is just what started it.

import { db, COLLECTIONS, FieldValue, serializeResearchRun } from "../../firestore";
import { isStale } from "./parse";
import type { ResearchInputs, ResearchResult } from "./run";

/** Open a run and claim the client. Nothing has been searched yet. */
export async function startResearchRun(clientId: string, inputs: ResearchInputs) {
  const ref = db().collection(COLLECTIONS.researchRuns).doc();
  await ref.set({
    clientId,
    status: "running",
    progress: "Starting",
    inputs,
    dossier: {},
    draftStrategy: {},
    openQuestions: [],
    sources: [],
    warnings: [],
    llm: null,
    acceptedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  return serializeResearchRun(ref.id, snap.data() ?? {});
}

export async function updateResearchProgress(runId: string, progress: string) {
  await db().collection(COLLECTIONS.researchRuns).doc(runId).update({ progress });
}

export async function finishResearchRun(runId: string, result: ResearchResult) {
  await db().collection(COLLECTIONS.researchRuns).doc(runId).update({
    status: result.status,
    progress: null,
    inputs: result.inputs,
    dossier: result.dossier,
    draftStrategy: result.draft_strategy,
    openQuestions: result.open_questions,
    sources: result.sources,
    warnings: result.warnings,
    llm: result.llm,
  });
}

/** Both passes failed, or something threw. The row says so rather than hanging. */
export async function failResearchRun(runId: string, message: string) {
  await db().collection(COLLECTIONS.researchRuns).doc(runId).update({
    status: "failed",
    progress: null,
    warnings: [message],
  });
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
 * A run in flight for this client, or null.
 *
 * Used to refuse a second run rather than spend on it twice — the first version
 * of this page had no such guard, and a re-click during the three silent
 * minutes bought a duplicate.
 *
 * A stale row does not count. after() dies with its invocation, so a run killed
 * at maxDuration would otherwise block this client forever.
 */
export async function findRunningRun(clientId: string) {
  const runs = await listResearchRuns(clientId, 5);
  return runs.find((r) => r.status === "running") ?? null;
}

/**
 * Sorted in memory, so the app runs with no composite index deployed — the same
 * trade listPlanRuns makes, and the same caveat: research runs carry a dossier
 * each, so once a client has many of them this should move into the query. The
 * (clientId, createdAt desc) index is declared in firestore.indexes.json.
 *
 * Staleness is applied HERE rather than written back. A read that repairs the
 * database is a write nobody asked for, and the truth — "this row says running
 * and nothing is coming back for it" — is derivable every time it is needed.
 */
export async function listResearchRuns(clientId: string, limit = 10) {
  const snap = await db()
    .collection(COLLECTIONS.researchRuns)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => serializeResearchRun(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit)
    .map((run) =>
      isStale(run)
        ? {
            ...run,
            status: "failed" as const,
            progress: null,
            warnings: [
              ...run.warnings,
              "This run was interrupted before it finished. Nothing was saved from it — run it again.",
            ],
          }
        : run
    );
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
