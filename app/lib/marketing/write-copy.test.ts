import { describe, it, expect } from "vitest";
import {
  buildCopyPayload,
  copyBriefOfSlot,
  copyBriefOfProposed,
  generateCopy,
  WriteCopyFailedError,
  type CopyFn,
} from "./write-copy";
import { isCopyStale, sourceHash } from "./copy";
import type { ProposedSlot, Slot } from "../types";

// The copy stage is where a voice rule most obviously belongs — "name the
// trade, never 'leverage'" is about wording, not about which piece to write.
// These assert only that the rules arrive; whether the model obeys them is not
// something a unit test can know.

function slot(over: Partial<Slot> = {}): Slot {
  return {
    id: "s1",
    client_id: "c1",
    campaign_id: "camp1",
    campaign_title: "Launch",
    plan_run_id: "run1",
    gap_id: "g1",
    date: "2026-09-15",
    time_local: "09:00",
    timezone: "UTC",
    scheduled_at: null,
    week_key: "2026-W38",
    type: "post",
    channel: "linkedin",
    theme: "Why quarterly filing slips",
    brief: "",
    rationale: "",
    hook: "Nobody diarises the deadline.",
    body: ["Name the date.", "What it costs."],
    cta: "Book the check.",
    needs_theme: false,
    status: "planned",
    source: "agent",
    pinned: false,
    content: null,
    google_event_id: null,
    google_sync_status: "pending",
    google_sync_error: null,
    google_event_title: null,
    google_event_body_hash: null,
    google_event_locked: false,
    google_adopted_at: null,
    last_human_edit_at: null,
    publication: null,
    last_publish_error: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

describe("buildCopyPayload — lessons", () => {
  it("carries the rules through to the payload", () => {
    const payload = buildCopyPayload(copyBriefOfSlot(slot()), null, {}, ["Name the trade."]);
    expect(payload.lessons).toEqual(["Name the trade."]);
  });

  // Same convention as `steer`: the key is always there, so the prompt never
  // has to reason about a missing one.
  it("defaults to an empty array rather than omitting the key", () => {
    const payload = buildCopyPayload(copyBriefOfSlot(slot()), null, {});
    expect(payload).toHaveProperty("lessons");
    expect(payload.lessons).toEqual([]);
  });
});

/**
 * A ProposedSlot matching the Slot factory above, field for field.
 *
 * Kept deliberately parallel: the whole point of the equivalence test below is
 * that two shapes describing the same piece produce the same brief, so any
 * divergence here must be a real one.
 */
function proposed(over: Partial<ProposedSlot> = {}): ProposedSlot {
  const s = slot();
  return {
    slotId: s.id,
    gapId: s.gap_id,
    weekKey: s.week_key,
    date: s.date,
    timeLocal: s.time_local,
    timezone: s.timezone,
    scheduledAt: s.scheduled_at,
    type: s.type,
    channel: s.channel,
    campaignId: s.campaign_id ?? "",
    campaignTitle: s.campaign_title ?? "",
    theme: s.theme,
    brief: s.brief,
    rationale: s.rationale,
    hook: s.hook,
    body: s.body,
    cta: s.cta,
    content: s.content,
    needsTheme: s.needs_theme,
    ...over,
  };
}

/**
 * The camelCase/snake_case tripwire.
 *
 * A Slot says campaign_id and needs_theme; a ProposedSlot says campaignId and
 * needsTheme. Both feed the same generator, so a mistyped key here does not
 * fail — it silently drops the campaign from the prompt, or reads needsTheme as
 * undefined and writes confident nonsense from a piece with no theme. That is
 * the exact class of bug firestore.test.ts exists because of.
 */
describe("copyBriefOfSlot / copyBriefOfProposed", () => {
  it("produce identical briefs from the same piece in either shape", () => {
    expect(copyBriefOfProposed(proposed())).toEqual(copyBriefOfSlot(slot()));
  });

  it("carries the campaign through from both shapes", () => {
    expect(copyBriefOfSlot(slot({ campaign_id: "c9", campaign_title: "Launch" })))
      .toMatchObject({ campaignId: "c9", campaignTitle: "Launch" });
    expect(copyBriefOfProposed(proposed({ campaignId: "c9", campaignTitle: "Launch" })))
      .toMatchObject({ campaignId: "c9", campaignTitle: "Launch" });
  });

  it("reads the no-theme flag from both spellings", () => {
    expect(copyBriefOfSlot(slot({ needs_theme: true })).needsTheme).toBe(true);
    expect(copyBriefOfProposed(proposed({ needsTheme: true })).needsTheme).toBe(true);
  });

  it("tolerates a slot with no beats rather than passing undefined on", () => {
    expect(copyBriefOfSlot(slot({ body: undefined as unknown as string[] })).body).toEqual([]);
  });
});

/** A model that answers with usable copy, so nothing here touches the network. */
const stubCopy: CopyFn = async () => ({
  blocks: [
    { label: "Slide 1", text: "Nobody diarises the deadline." },
    { label: "Slide 2", text: "That is the whole problem." },
  ],
  caption: "The date everyone misses.",
  hashtags: ["#filing"],
});

describe("generateCopy", () => {
  it("writes copy from a brief, with no slot and no Firestore", async () => {
    const { copy } = await generateCopy(copyBriefOfSlot(slot()), null, {}, [], stubCopy);
    expect(copy.blocks).toHaveLength(2);
    expect(copy.blocks[0].text).toBe("Nobody diarises the deadline.");
  });

  /**
   * The stamp is what makes staleness work: copy written now must read as
   * current now, and only stop being current when the brief moves.
   */
  it("stamps the brief it was written from, so it is not born stale", async () => {
    const s = slot();
    const { copy } = await generateCopy(copyBriefOfSlot(s), null, {}, [], stubCopy);
    expect(copy.sourceHash).toBe(sourceHash(s));
    expect(isCopyStale({ ...s, content: copy as unknown as Record<string, unknown> }))
      .toBe(false);
  });

  it("goes stale once the brief moves underneath it", async () => {
    const s = slot();
    const { copy } = await generateCopy(copyBriefOfSlot(s), null, {}, [], stubCopy);
    const edited: Slot = {
      ...s,
      hook: "A different hook entirely",
      content: copy as unknown as Record<string, unknown>,
    };
    expect(isCopyStale(edited)).toBe(true);
  });

  /**
   * Refusing costs a model call. Writing publishable words from "Theme not set"
   * produces confident nonsense, which is worse than an error.
   */
  it("refuses a piece with no theme before calling the model", async () => {
    let called = false;
    const spy: CopyFn = async () => {
      called = true;
      return {};
    };
    await expect(
      generateCopy(copyBriefOfSlot(slot({ needs_theme: true })), null, {}, [], spy)
    ).rejects.toThrow(WriteCopyFailedError);
    expect(called).toBe(false);
  });

  it("refuses an empty theme, not just the flag", async () => {
    await expect(
      generateCopy(copyBriefOfSlot(slot({ theme: "" })), null, {}, [], stubCopy)
    ).rejects.toThrow(WriteCopyFailedError);
  });

  /**
   * Never half a result. A piece may already carry copy somebody polished, and
   * overwriting it because the model was unreachable is strictly worse than
   * leaving it alone — so both failures throw rather than return empty copy.
   */
  it("throws when the model call fails", async () => {
    const boom: CopyFn = async () => {
      throw new Error("upstream timeout");
    };
    await expect(
      generateCopy(copyBriefOfSlot(slot()), null, {}, [], boom)
    ).rejects.toThrow(/upstream timeout/);
  });

  it("throws when the model answers with nothing usable", async () => {
    const empty: CopyFn = async () => ({ blocks: [] });
    await expect(
      generateCopy(copyBriefOfSlot(slot()), null, {}, [], empty)
    ).rejects.toThrow(WriteCopyFailedError);
  });
});
