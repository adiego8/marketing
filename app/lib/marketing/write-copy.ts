// Writing the finished copy for one slot.
//
// The thinnest of the three generation paths, and deliberately so. It decides
// nothing: the brief is already agreed, and every judgement about the result
// lives in copy.ts, which is pure and therefore tested. This file is the model
// call and the two guards around it.

import { llmJson, DEFAULT_MODEL } from "./llm";
import { getStrategy } from "./strategy";
import { getSlot, updateSlot } from "./slots";
import { SlotNotFoundError } from "./planner/regenerate";
import { WRITE_COPY_PROMPT } from "./planner/prompt";
import { limitsFor } from "./posting-windows";
import {
  parseCopy,
  copyWarnings,
  normalizeFormat,
  sourceHash,
  type SlotCopy,
} from "./copy";
import type { Slot } from "../types";

/**
 * The model answered, but with nothing usable — or it was never asked.
 *
 * Same reasoning as RegenerateFailedError: a slot may already carry copy
 * somebody has polished, and overwriting it with an empty draft because the
 * model was unreachable is strictly worse than leaving it alone.
 */
export class WriteCopyFailedError extends Error {
  constructor(reason: string) {
    super(`Could not write the copy: ${reason}`);
    this.name = "WriteCopyFailedError";
  }
}

// Below regenerate's 0.8, because novelty is not the job here — the angle is
// already chosen and this is execution against it. Above decide's 0.4, because
// it is still writing rather than selection.
const TEMPERATURE = 0.6;

export interface WriteCopyOptions {
  /** What the operator wants different, in their words. Optional. */
  steer?: string;
}

/**
 * Everything the model is told, and nothing else.
 *
 * Exported and pure so the payload can be asserted without a network call —
 * the same shape of test regenerate.test.ts uses for its one-gap request.
 *
 * Note what is NOT here: recent_themes. Avoiding repetition is a job for the
 * stage that picks themes. This stage has one fixed brief and no discretion, so
 * carrying that list would be a large payload bought for nothing.
 */
export function buildCopyPayload(
  slot: Slot,
  strategy: Record<string, unknown> | null,
  opts: WriteCopyOptions
) {
  const limits = limitsFor(slot.channel);
  return {
    slot: {
      type: normalizeFormat(slot.type, slot.channel),
      channel: slot.channel,
      theme: slot.theme,
      hook: slot.hook,
      body: slot.body,
      cta: slot.cta,
    },
    steer: opts.steer?.trim() || "",
    campaign: slot.campaign_id
      ? { campaign_id: slot.campaign_id, title: slot.campaign_title }
      : null,
    limits,
    business: {
      name: (strategy?.business_name as string) ?? "",
      icp: strategy?.icp ?? {},
      voice: strategy?.voice ?? {},
      positioning: strategy?.positioning ?? {},
    },
  };
}

export async function writeCopy(
  clientId: string,
  slotId: string,
  opts: WriteCopyOptions = {}
): Promise<{ slot: Slot; warnings: string[] }> {
  const slot = await getSlot(clientId, slotId);
  if (!slot) throw new SlotNotFoundError();

  // Writing publishable copy from "Theme not set" produces confident nonsense.
  // Refusing costs a model call and says something actionable instead.
  if (slot.needs_theme || !slot.theme) {
    throw new WriteCopyFailedError(
      "this slot has no theme yet — regenerate it before writing the copy"
    );
  }

  const strategy = await getStrategy(clientId);
  const payload = buildCopyPayload(slot, strategy as Record<string, unknown> | null, opts);

  let raw: unknown;
  try {
    raw = await llmJson({
      systemPrompt: WRITE_COPY_PROMPT,
      payload,
      temperature: TEMPERATURE,
    });
  } catch (error) {
    throw new WriteCopyFailedError(
      error instanceof Error ? error.message : "the model call failed"
    );
  }

  const authored = parseCopy(raw, slot);
  if (!authored) {
    throw new WriteCopyFailedError("the model returned no usable copy");
  }

  const copy: SlotCopy = {
    ...authored,
    // Stamped from the brief as it stands right now, so editing the brief
    // afterwards marks this copy rather than silently invalidating it.
    sourceHash: sourceHash(slot),
    generatedAt: new Date().toISOString(),
    model: DEFAULT_MODEL,
    editedAt: null,
  };

  const updated = await updateSlot(
    clientId,
    slotId,
    {
      content: copy as unknown as Record<string, unknown>,
      // Only ever a promotion, never a demotion. "drafted" means a draft
      // exists, which is now true — and both exports and the table already
      // render it. But a slot someone has marked confirmed or posted must not
      // be dragged backwards by an agent action.
      ...(slot.status === "planned" ? { status: "drafted" as const } : {}),
    },
    // The model wrote this, not a person: lastHumanEditAt stays put, because
    // that is what tells a hand edit from agent output during reconciliation.
    false
  );
  if (!updated) throw new SlotNotFoundError();

  return { slot: updated, warnings: copyWarnings(copy, updated) };
}
