import { FieldValue } from "firebase-admin/firestore";
import { db, COLLECTIONS, serializeSignal } from "../firestore";
import type { BriefSnapshot, LessonScope, Signal, SignalKind } from "../types";

/**
 * What a person did that the agent got wrong.
 *
 * A signal is one episode, not a rule. Rules are Lessons (lessons.ts), which a
 * person writes and the agent is given; signals are the evidence behind them.
 * Keeping the two apart is the whole design: raw episodes injected into a
 * prompt grow without bound, contradict each other, and cannot be retired.
 *
 * Append-only. Nothing here is ever rewritten except a drop's reason, for the
 * reason given on signalId below.
 */

export interface RecordInput {
  clientId: string;
  kind: SignalKind;
  scope: LessonScope;
  type?: string;
  channel?: string;
  slotId?: string | null;
  campaignId?: string | null;
  planRunId?: string | null;
  reason?: string;
  before?: BriefSnapshot | null;
  after?: BriefSnapshot | null;
  changed?: string[];
}

/** A reason is a sentence, not an essay, and it rides in every prompt. */
export const MAX_REASON_CHARS = 300;

/**
 * Deterministic where one disagreement can arrive as several calls.
 *
 * Two cases, both of which would otherwise double-count:
 *
 * `dropped` — the reason box saves on blur, so dropping a piece and then
 * saying why calls the endpoint twice about the same rejection.
 *
 * `edited` — one person fixing one piece rarely saves once. Five passes over a
 * hook is one disagreement, not five, and collapsing them also keeps `before`
 * anchored to what the AGENT wrote: without this, the second save records the
 * first save as the "before" and the signal quietly becomes human-vs-human.
 *
 * Everything else gets a fresh id: two steers on the same slot really are two
 * rejections, and restoring twice means it was dropped twice.
 */
export function signalId(input: RecordInput): string | null {
  if (!input.slotId) return null;
  if (input.kind === "dropped" && input.planRunId) {
    return `${input.planRunId}__${input.slotId}`;
  }
  if (input.kind === "edited") {
    return `edited__${input.slotId}`;
  }
  return null;
}

/**
 * Write one signal. Never throws.
 *
 * This is telemetry riding on somebody's edit. Losing the edit because the
 * signal write failed would be strictly worse than losing the signal, so every
 * failure is swallowed and logged — callers get nothing to handle.
 *
 * Await it anyway. These run in serverless functions that can freeze the moment
 * the response is sent, so a floating promise is a write that sometimes lands
 * and sometimes does not. Since this never rejects, awaiting costs one small
 * Firestore round trip and buys certainty.
 */
export async function recordSignal(input: RecordInput): Promise<void> {
  try {
    const doc = {
      clientId: input.clientId,
      kind: input.kind,
      scope: input.scope,
      type: input.type ?? "",
      channel: input.channel ?? "",
      slotId: input.slotId ?? null,
      campaignId: input.campaignId ?? null,
      planRunId: input.planRunId ?? null,
      reason: (input.reason ?? "").slice(0, MAX_REASON_CHARS),
      before: input.before ?? null,
      after: input.after ?? null,
      changed: input.changed ?? [],
      createdAt: FieldValue.serverTimestamp(),
    };

    const id = signalId(input);
    const col = db().collection(COLLECTIONS.signals);
    if (!id) {
      await col.add(doc);
      return;
    }

    // Merging, so a reason typed after the drop — or a fifth pass over a hook —
    // lands on the episode already there rather than beside it.
    //
    // `before` is written once and never overwritten: it is what the agent
    // produced, and the whole value of an edit signal is the distance between
    // that and where a person left it. Re-writing it on every save would walk
    // it forward until the two ends met and the signal said nothing.
    const existing = await col.doc(id).get();
    const update = existing.exists && existing.data()?.before
      ? { ...doc, before: existing.data()!.before }
      : doc;
    await col.doc(id).set(update, { merge: true });
  } catch (error) {
    console.error("Could not record signal", error);
  }
}

/**
 * Sorted in memory, like every other list query here — see loadPlannerSlots in
 * planner/plan-runs.ts for why: it keeps the app running with no composite
 * index to deploy.
 */
export async function listSignals(clientId: string, limit = 200): Promise<Signal[]> {
  const snap = await db()
    .collection(COLLECTIONS.signals)
    .where("clientId", "==", clientId)
    .get();

  return snap.docs
    .map((doc) => serializeSignal(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit) as Signal[];
}
