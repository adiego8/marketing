// Writing a piece's finished copy while the plan is still a preview.
//
// The same job as write-copy.ts, against the other place a piece can live. A
// committed piece is a document in marketing_slots; a proposed one is an entry
// in its run's proposedSlots array, and has no document at all until commitPlan
// creates one. So the generation is shared — generateCopy takes a CopyBrief and
// knows nothing about either — and only the load and the store differ.
//
// Structured exactly like replace.ts, for the same reasons: read the run, refuse
// once it is committed, call the model, fold the answer back with a pure
// function from drop.ts, write the whole array once, return the whole run.

import { getPlanRun, updatePlanRunSlots } from "./plan-runs";
import { applyCopyToProposed } from "./drop";
import { PlanCommittedError } from "./replace";
import { getStrategy } from "../strategy";
import { lessonsForPrompt } from "../lessons-store";
import { recordSignal } from "../signals";
import { snapshotOf } from "../lessons";
import {
  generateCopy,
  copyBriefOfProposed,
  WriteCopyFailedError,
  type CopyFn,
  type WriteCopyOptions,
} from "../write-copy";
import type { ProposedSlot } from "../../types";

/** The proposal named is not in this run — dropped, or never there. */
export class ProposedSlotNotFoundError extends Error {
  constructor() {
    super("That piece is not in this plan. It may have been dropped.");
    this.name = "ProposedSlotNotFoundError";
  }
}

/**
 * Write the copy for one proposed piece, before the plan is accepted.
 *
 * @returns the updated run, or null when the run does not exist.
 * @throws PlanCommittedError | ProposedSlotNotFoundError | WriteCopyFailedError
 */
export async function writeProposedCopy(
  clientId: string,
  runId: string,
  slotId: string,
  opts: WriteCopyOptions = {},
  copyFn?: CopyFn
) {
  const run = await getPlanRun(clientId, runId);
  if (!run) return null;

  // Once committed the pieces are real documents, and writing here would edit a
  // historical record while the slot everyone can see stayed as it was.
  if (run.committed_at) throw new PlanCommittedError();

  const proposed = run.proposed_slots as ProposedSlot[];
  const slot = proposed.find((s) => s.slotId === slotId);
  if (!slot) throw new ProposedSlotNotFoundError();

  const brief = copyBriefOfProposed(slot);

  // A steer on a piece that already has copy is a rejection of that copy. On a
  // first write it is direction, not feedback, so it teaches nothing. Same rule
  // write-copy.ts applies post-commit; the ids differ only in which id exists.
  if (opts.steer?.trim() && slot.content) {
    await recordSignal({
      clientId,
      kind: "steered",
      scope: "copy",
      type: slot.type,
      channel: slot.channel,
      slotId: slot.slotId,
      campaignId: slot.campaignId,
      planRunId: runId,
      reason: opts.steer,
      before: snapshotOf(slot),
    });
  }

  const { copy } = await generateCopy(
    brief,
    (await getStrategy(clientId)) as Record<string, unknown> | null,
    opts,
    await lessonsForPrompt(clientId, "copy"),
    copyFn
  );

  // Re-read rather than folding into the array captured above. The model call
  // takes up to five minutes, which is long enough for the operator to have
  // dropped this piece or another one in the meantime — and writing the stale
  // array back would silently resurrect what they dropped.
  const fresh = await getPlanRun(clientId, runId);
  if (!fresh) return null;
  if (fresh.committed_at) throw new PlanCommittedError();

  const applied = applyCopyToProposed(
    fresh.proposed_slots as ProposedSlot[],
    slotId,
    copy as unknown as Record<string, unknown>
  );
  if (!applied.found) throw new ProposedSlotNotFoundError();

  return updatePlanRunSlots(clientId, runId, {
    proposedSlots: applied.proposed,
    droppedSlots: fresh.dropped_slots,
  });
}

export { WriteCopyFailedError };
