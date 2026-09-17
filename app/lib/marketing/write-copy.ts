// Writing the finished copy for one slot.
//
// The thinnest of the three generation paths, and deliberately so. It decides
// nothing: the brief is already agreed, and every judgement about the result
// lives in copy.ts, which is pure and therefore tested. This file is the model
// call and the two guards around it.

import { llmJson, DEFAULT_MODEL } from "./llm";
import { recordSignal } from "./signals";
import { snapshotOf } from "./lessons";
import { lessonsForPrompt } from "./lessons-store";
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
import type { ProposedSlot, Slot } from "../types";

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
/**
 * Everything writing copy depends on, in one shape.
 *
 * It exists because the same generation now serves two callers whose field
 * names disagree: a committed `Slot` spells things `campaign_id` and
 * `needs_theme`, an uncommitted `ProposedSlot` spells them `campaignId` and
 * `needsTheme`. Normalising once, in a pure function with a test, is the whole
 * defence against that drift — `firestore.test.ts` exists because a
 * `calendarEventId`/`googleEventId` mismatch once made every committed slot
 * read back as unsynced, and this is the same hazard.
 */
export interface CopyBrief {
  type: string;
  channel: string;
  theme: string;
  hook: string;
  body: string[];
  cta: string;
  needsTheme: boolean;
  campaignId: string | null;
  campaignTitle: string | null;
  /** Existing copy, which makes a steer a rejection rather than direction. */
  content: Record<string, unknown> | null;
}

export function copyBriefOfSlot(slot: Slot): CopyBrief {
  return {
    type: slot.type,
    channel: slot.channel,
    theme: slot.theme,
    hook: slot.hook,
    body: slot.body ?? [],
    cta: slot.cta,
    needsTheme: slot.needs_theme,
    campaignId: slot.campaign_id,
    campaignTitle: slot.campaign_title,
    content: slot.content,
  };
}

export function copyBriefOfProposed(slot: ProposedSlot): CopyBrief {
  return {
    type: slot.type,
    channel: slot.channel,
    theme: slot.theme,
    hook: slot.hook,
    body: slot.body ?? [],
    cta: slot.cta,
    needsTheme: slot.needsTheme,
    // Never null on a proposal — a piece exists because a campaign asked for
    // it — but the brief allows null because a Slot's may be.
    campaignId: slot.campaignId,
    campaignTitle: slot.campaignTitle,
    content: slot.content,
  };
}

export function buildCopyPayload(
  brief: CopyBrief,
  strategy: Record<string, unknown> | null,
  opts: WriteCopyOptions,
  /** Rules taught for this client. Always passed, often empty. */
  lessons: string[] = []
) {
  const limits = limitsFor(brief.channel);
  return {
    slot: {
      type: normalizeFormat(brief.type, brief.channel),
      channel: brief.channel,
      theme: brief.theme,
      hook: brief.hook,
      body: brief.body,
      cta: brief.cta,
    },
    steer: opts.steer?.trim() || "",
    lessons,
    campaign: brief.campaignId
      ? { campaign_id: brief.campaignId, title: brief.campaignTitle }
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

/** The model call, injectable so the orchestration above it can be tested. */
export type CopyFn = (payload: Record<string, unknown>) => Promise<unknown>;

const callModel: CopyFn = (payload) =>
  llmJson({ systemPrompt: WRITE_COPY_PROMPT, payload, temperature: TEMPERATURE });

/**
 * Brief in, finished copy out. No Firestore, no knowledge of where the piece
 * lives — which is what lets one implementation serve a committed slot and an
 * uncommitted proposal.
 *
 * @throws WriteCopyFailedError when there is no theme, the model call fails, or
 *   the answer contains nothing usable. Never returns half a result: a slot may
 *   already carry copy somebody has polished, and overwriting it because the
 *   model was unreachable is strictly worse than leaving it alone.
 */
export async function generateCopy(
  brief: CopyBrief,
  strategy: Record<string, unknown> | null,
  opts: WriteCopyOptions = {},
  lessons: string[] = [],
  copyFn: CopyFn = callModel
): Promise<{ copy: SlotCopy; warnings: string[] }> {
  // Writing publishable copy from "Theme not set" produces confident nonsense.
  // Refusing costs a model call and says something actionable instead.
  if (brief.needsTheme || !brief.theme) {
    throw new WriteCopyFailedError(
      "this slot has no theme yet — regenerate it before writing the copy"
    );
  }

  let raw: unknown;
  try {
    raw = await copyFn(buildCopyPayload(brief, strategy, opts, lessons));
  } catch (error) {
    throw new WriteCopyFailedError(
      error instanceof Error ? error.message : "the model call failed"
    );
  }

  const authored = parseCopy(raw, brief);
  if (!authored) {
    throw new WriteCopyFailedError("the model returned no usable copy");
  }

  const copy: SlotCopy = {
    ...authored,
    // Stamped from the brief as it stands right now, so editing the brief
    // afterwards marks this copy rather than silently invalidating it.
    sourceHash: sourceHash(brief),
    generatedAt: new Date().toISOString(),
    model: DEFAULT_MODEL,
    editedAt: null,
  };

  return { copy, warnings: copyWarnings(copy, brief) };
}

export async function writeCopy(
  clientId: string,
  slotId: string,
  opts: WriteCopyOptions = {},
  copyFn?: CopyFn
): Promise<{ slot: Slot; warnings: string[] }> {
  const slot = await getSlot(clientId, slotId);
  if (!slot) throw new SlotNotFoundError();

  const brief = copyBriefOfSlot(slot);

  // A steer on a piece that already has copy is a rejection of that copy. On a
  // first write it is just direction, not feedback, so it teaches nothing.
  if (opts.steer?.trim() && slot.content) {
    await recordSignal({
      clientId,
      kind: "steered",
      scope: "copy",
      type: slot.type,
      channel: slot.channel,
      slotId: slot.id,
      campaignId: slot.campaign_id,
      planRunId: slot.plan_run_id,
      reason: opts.steer,
      before: snapshotOf(slot),
    });
  }

  // The no-theme refusal lives in generateCopy, so both callers make it.
  const { copy } = await generateCopy(
    brief,
    (await getStrategy(clientId)) as Record<string, unknown> | null,
    opts,
    await lessonsForPrompt(clientId, "copy"),
    copyFn
  );

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
