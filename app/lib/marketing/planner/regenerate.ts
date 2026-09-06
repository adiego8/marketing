// Regenerating one committed slot.
//
// Deliberately NOT a call into planFromInputs. That pipeline observes gaps,
// decides fills and then assigns dates — and the date, time, channel and format
// of an existing slot are precisely what must not move. So this borrows the
// pieces that validate (parseFills, and through it every character cap) and
// skips the two stages that schedule.

import { llmJson } from "../llm";
import { getStrategy } from "../strategy";
import { getSlot, updateSlot } from "../slots";
import { isChannel, type Channel } from "../posting-windows";
import { parseFills, type GapRequest } from "./decide";
import { loadRecentThemes } from "./plan-runs";
import { REGENERATE_SLOT_PROMPT } from "./prompt";
import type { Slot } from "../../types";

export type RegenerateMode = "angle" | "rewrite";

export class SlotNotFoundError extends Error {
  constructor() {
    super("Slot not found");
    this.name = "SlotNotFoundError";
  }
}

/**
 * The model answered, but with nothing usable.
 *
 * This is the case the plan path deliberately tolerates — a run whose model
 * call fails still produces correctly dated skeletons. Here it must not:
 * overwriting a working piece with an empty one because the model was
 * unreachable is strictly worse than leaving it alone.
 */
export class RegenerateFailedError extends Error {
  constructor(reason: string) {
    super(`Could not regenerate this slot: ${reason}`);
    this.name = "RegenerateFailedError";
  }
}

const TEMPERATURE = 0.8; // Higher than planning: the point is a different take.

export interface RegenerateOptions {
  mode: RegenerateMode;
  /** What the operator wants different, in their words. Optional. */
  steer?: string;
}

export async function regenerateSlot(
  clientId: string,
  slotId: string,
  opts: RegenerateOptions
): Promise<Slot> {
  const slot = await getSlot(clientId, slotId);
  if (!slot) throw new SlotNotFoundError();

  const strategy = await getStrategy(clientId);
  const contentStrategy = (strategy?.content_strategy ?? {}) as {
    content_pillars?: unknown;
  };

  // Everything already scheduled EXCEPT this slot. Telling the model to avoid
  // the theme it is being asked to rewrite is a good way to get nonsense.
  const recentThemes = (await loadRecentThemes(clientId)).filter(
    (t) => !(t.date === slot.date && t.theme === slot.theme)
  );

  const channel: Channel = isChannel(slot.channel) ? slot.channel : "linkedin";

  // One gap, with the channel pinned. parseFills starts from default_channel
  // and only accepts an override that is inside allowed_channels, so a
  // single-element list guarantees the channel comes back unchanged.
  const gap: GapRequest = {
    gap_id: `regen__${slot.id}`,
    week: slot.week_key,
    type: slot.type,
    index_in_week: 0,
    of_in_week: 1,
    allowed_channels: [channel],
    default_channel: channel,
    eligible_campaign_ids: slot.campaign_id ? [slot.campaign_id] : [],
  };

  const payload = {
    gap_id: gap.gap_id,
    mode: opts.mode,
    steer: opts.steer?.trim() || "",
    slot: {
      type: slot.type,
      channel: slot.channel,
      theme: slot.theme,
      hook: slot.hook,
      body: slot.body,
      cta: slot.cta,
    },
    campaign: slot.campaign_id
      ? { campaign_id: slot.campaign_id, title: slot.campaign_title }
      : null,
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
    raw = await llmJson({
      systemPrompt: REGENERATE_SLOT_PROMPT,
      payload,
      temperature: TEMPERATURE,
    });
  } catch (error) {
    throw new RegenerateFailedError(
      error instanceof Error ? error.message : "the model call failed"
    );
  }

  // Same validation and the same character caps as the planner, because it is
  // literally the same function.
  const { fills } = parseFills(raw, [gap]);
  const fill = fills[0];
  if (!fill || fill.needsTheme || !fill.theme) {
    throw new RegenerateFailedError("the model returned no usable content");
  }

  // In rewrite mode the theme is not the model's to change, whatever it
  // returned. Enforced here rather than trusted to the prompt.
  const theme = opts.mode === "rewrite" ? slot.theme : fill.theme;

  const updated = await updateSlot(
    clientId,
    slotId,
    {
      theme,
      brief: fill.brief,
      rationale: fill.rationale,
      hook: fill.hook,
      body: fill.body,
      cta: fill.cta,
    },
    // The model wrote this, not a person: lastHumanEditAt stays put, because
    // that is what will distinguish a hand edit from agent output when
    // reconciliation lands.
    false
  );
  if (!updated) throw new SlotNotFoundError();
  return updated;
}
