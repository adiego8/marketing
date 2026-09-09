// Generating replacements for the ideas a human dropped out of a preview.
//
// Deliberately NOT a call into planFromInputs, for the same reason
// regenerate.ts is not: that pipeline observes gaps, decides fills and then
// assigns dates — and the date, time, channel and format of a dropped slot are
// precisely what must not move. So this borrows the piece that validates
// (parseFills, and through it every character cap) and skips the two stages
// that schedule.
//
// One model call for the whole batch. DecideRequest already carries N gaps, so
// dropping four costs one call, not four — and less than the full re-preview it
// replaces.

import { llmJson } from "../llm";
import { getStrategy } from "../strategy";
import { isChannel, type Channel } from "../posting-windows";
import { parseFills, type GapRequest } from "./decide";
import {
  applyReplacements,
  openDrops,
  rejectedThemes,
  type ReplaceResult,
} from "./drop";
import { getPlanRun, loadRecentThemes, updatePlanRunSlots } from "./plan-runs";
import { REPLACE_DROPPED_PROMPT } from "./prompt";
import type { DroppedSlot } from "../../types";

/** Higher than planning's 0.4: the point is a different take, as in regenerate.ts. */
const TEMPERATURE = 0.8;

export class NothingToReplaceError extends Error {
  constructor() {
    super("Nothing has been dropped from this plan, so there is nothing to replace.");
    this.name = "NothingToReplaceError";
  }
}

export class ReplaceFailedError extends Error {
  constructor(reason: string) {
    super(`Could not generate replacements: ${reason}`);
    this.name = "ReplaceFailedError";
  }
}

export class PlanCommittedError extends Error {
  constructor() {
    super(
      "This plan is already committed. Change a scheduled piece from the Schedule page instead."
    );
    this.name = "PlanCommittedError";
  }
}

/** gap_id is derived from the slot id, so the fills map back unambiguously. */
export function gapIdFor(slotId: string): string {
  return `replace__${slotId}`;
}

/**
 * One request entry per dropped slot, with the channel pinned.
 *
 * parseFills starts from default_channel and only accepts an override that is
 * inside allowed_channels, so a single-element list guarantees the channel
 * comes back unchanged — the same trick regenerate.ts:71-83 uses. Same for the
 * campaign: the slot keeps the one it was assigned.
 *
 * Exported and pure so the payload's shape is assertable without a model call.
 */
export function buildReplaceGaps(dropped: DroppedSlot[]): GapRequest[] {
  return dropped.map((slot, index) => {
    const channel: Channel = isChannel(slot.channel) ? slot.channel : "linkedin";
    return {
      gap_id: gapIdFor(slot.slotId),
      type: slot.type,
      index_in_set: index,
      of_in_set: dropped.length,
      allowed_channels: [channel],
      default_channel: channel,
      // Filtered, not asserted: a piece from a run that predates campaign
      // attribution can still carry a null here, and `[null]` would be a
      // request the model cannot satisfy.
      eligible_campaign_ids: [slot.campaignId].filter(Boolean),
    };
  });
}

/** What the model is told about each rejection. The reason is the whole signal. */
export function buildRejectedPayload(dropped: DroppedSlot[]) {
  return dropped.map((slot) => ({
    gap_id: gapIdFor(slot.slotId),
    type: slot.type,
    channel: slot.channel,
    theme: slot.theme,
    hook: slot.hook,
    body: slot.body,
    cta: slot.cta,
    reason: slot.reason,
  }));
}

export type ReplaceFn = (payload: Record<string, unknown>) => Promise<unknown>;

const callModel: ReplaceFn = (payload) =>
  llmJson({ systemPrompt: REPLACE_DROPPED_PROMPT, payload, temperature: TEMPERATURE });

/**
 * Replace some or all of a run's dropped slots.
 *
 * @param slotIds the drops to replace; empty or omitted means every open one.
 * @returns the updated run, or null when the run does not exist.
 * @throws PlanCommittedError | NothingToReplaceError | ReplaceFailedError
 */
export async function replaceDropped(
  clientId: string,
  runId: string,
  slotIds: string[] = [],
  replaceFn: ReplaceFn = callModel
) {
  const run = await getPlanRun(clientId, runId);
  if (!run) return null;
  if (run.committed_at) throw new PlanCommittedError();

  const targets = openDrops(run.dropped_slots, slotIds);
  if (targets.length === 0) throw new NothingToReplaceError();

  const strategy = await getStrategy(clientId);
  const contentStrategy = (strategy?.content_strategy ?? {}) as {
    content_pillars?: unknown;
  };

  // Everything already scheduled, PLUS every idea this run has turned down.
  // The second half is the one that matters: loadRecentThemes only sees
  // committed slots, so without it the model returns the theme you dropped
  // thirty seconds ago.
  const recentThemes = [
    ...(await loadRecentThemes(clientId)),
    ...rejectedThemes(run.dropped_slots),
  ];

  const gaps = buildReplaceGaps(targets);
  const payload = {
    rejected: buildRejectedPayload(targets),
    gaps,
    content_pillars: Array.isArray(contentStrategy.content_pillars)
      ? contentStrategy.content_pillars.filter((p): p is string => typeof p === "string")
      : [],
    recent_themes: recentThemes,
    business: {
      name: strategy?.business_name ?? "",
      icp: strategy?.icp ?? {},
      voice: strategy?.voice ?? {},
      positioning: strategy?.positioning ?? {},
    },
  };

  let raw: unknown;
  try {
    raw = await replaceFn(payload);
  } catch (error) {
    // Not degraded-but-usable, as the plan path would be. The operator already
    // has these slots and asked for better ones; handing back empty skeletons
    // would be a downgrade they did not ask for, so the drops stay dropped and
    // nothing is written.
    throw new ReplaceFailedError(
      error instanceof Error ? error.message : "the model call failed"
    );
  }

  const { fills, warnings } = parseFills(raw, gaps);
  const gapIdToSlotId = new Map(targets.map((s) => [gapIdFor(s.slotId), s.slotId]));

  const result: ReplaceResult = applyReplacements(
    run.proposed_slots,
    run.dropped_slots,
    fills,
    gapIdToSlotId,
    new Date().toISOString()
  );

  if (result.replaced === 0) {
    throw new ReplaceFailedError(
      warnings[0] ?? "the model returned nothing usable for any dropped slot"
    );
  }

  const updated = await updatePlanRunSlots(clientId, runId, {
    proposedSlots: result.proposed,
    droppedSlots: result.dropped,
  });

  return updated
    ? { run: updated, replaced: result.replaced, warnings: [...warnings, ...result.warnings] }
    : null;
}
