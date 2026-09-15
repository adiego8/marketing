import { describe, it, expect } from "vitest";
import { buildCopyPayload } from "./write-copy";
import type { Slot } from "../types";

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
    created_at: null,
    updated_at: null,
    ...over,
  };
}

describe("buildCopyPayload — lessons", () => {
  it("carries the rules through to the payload", () => {
    const payload = buildCopyPayload(slot(), null, {}, ["Name the trade."]);
    expect(payload.lessons).toEqual(["Name the trade."]);
  });

  // Same convention as `steer`: the key is always there, so the prompt never
  // has to reason about a missing one.
  it("defaults to an empty array rather than omitting the key", () => {
    const payload = buildCopyPayload(slot(), null, {});
    expect(payload).toHaveProperty("lessons");
    expect(payload.lessons).toEqual([]);
  });
});
