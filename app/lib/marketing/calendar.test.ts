import { describe, it, expect } from "vitest";
import { eventTitle, eventDescription, MAX_EVENT_DESCRIPTION_CHARS } from "./calendar";
import { sourceHash, type SlotCopy } from "./copy";
import type { Slot } from "../types";

// The calendar event is often the only surface someone sees on the day, so it
// has to carry the whole piece. Neither of these had a test before.
function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: "s1",
    client_id: "c1",
    campaign_id: "cam1",
    campaign_title: "Tax Season",
    plan_run_id: "r1",
    gap_id: "2026-W37::reel",
    date: "2026-09-08",
    time_local: "11:00",
    timezone: "America/New_York",
    scheduled_at: "2026-09-08T15:00:00.000Z",
    week_key: "2026-W37",
    type: "reel",
    channel: "instagram",
    theme: "Three signs your bookkeeping is asking for help",
    brief: "Turn the feeling into signals.",
    rationale: "Pillar: process",
    hook: "Your receipts are not the problem.",
    body: ["Open on the shoebox.", "Name the three signals.", "Land on the fix."],
    cta: "Book a wellness check.",
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
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("eventTitle", () => {
  it("leads with channel and format, then the theme", () => {
    expect(eventTitle(slot())).toBe(
      "Instagram · Reel — Three signs your bookkeeping is asking for help"
    );
  });

  it("says so when the theme is missing instead of leaving a dangling dash", () => {
    expect(eventTitle(slot({ needs_theme: true, theme: "" }))).toContain(
      "Theme not set"
    );
  });
});

describe("eventDescription", () => {
  it("carries the whole piece, in order", () => {
    const d = eventDescription(slot());
    expect(d).toContain("HOOK");
    expect(d).toContain("Your receipts are not the problem.");
    expect(d).toContain("1. Open on the shoebox.");
    expect(d).toContain("3. Land on the fix.");
    expect(d).toContain("CTA");
    expect(d).toContain("Book a wellness check.");
    // The hook has to precede the body, and the CTA has to come last.
    expect(d.indexOf("HOOK")).toBeLessThan(d.indexOf("BODY"));
    expect(d.indexOf("BODY")).toBeLessThan(d.indexOf("CTA"));
  });

  it("includes the campaign and the reasoning", () => {
    const d = eventDescription(slot());
    expect(d).toContain("Tax Season");
    expect(d).toContain("Pillar: process");
  });

  it("appends a link back to the schedule when an app URL is given", () => {
    expect(eventDescription(slot(), "https://x.test")).toContain(
      "https://x.test/clients/c1/schedule"
    );
    expect(eventDescription(slot())).not.toContain("undefined");
  });

  it("degrades for a slot written before the structure existed", () => {
    // These fields are absent on older slots; the event must not print empty
    // section headers for them.
    const d = eventDescription(slot({ hook: "", body: [], cta: "" }));
    expect(d).not.toContain("HOOK");
    expect(d).not.toContain("BODY");
    expect(d).not.toContain("CTA");
    expect(d).toContain("Three signs your bookkeeping is asking for help");
  });

  it("says the theme is missing rather than printing an empty section", () => {
    expect(eventDescription(slot({ needs_theme: true, theme: "" }))).toContain(
      "could not reach the model"
    );
  });
});

describe("eventDescription with finished copy", () => {
  function copy(over: Partial<SlotCopy> = {}): SlotCopy {
    return {
      headline: null,
      blocks: [
        { label: "Slide 1", text: "Your receipts are not the problem." },
        { label: "Slide 2", text: "The process that demands them is." },
      ],
      caption: "Two slides on the real cost.",
      hashtags: ["#bookkeeping"],
      sourceHash: "",
      generatedAt: "2026-09-07T10:00:00.000Z",
      model: "gpt-5.5",
      editedAt: null,
      ...over,
    };
  }

  /** A slot carrying copy written from its own current brief. */
  function withFreshCopy(over: Partial<SlotCopy> = {}) {
    const base = slot();
    return slot({
      content: copy({ sourceHash: sourceHash(base), ...over }) as unknown as Record<string, unknown>,
    });
  }

  it("replaces the brief with the words once they exist", () => {
    // The copy says what the brief said, in finished form. Printing both is
    // noise on the one surface someone reads on the day.
    const out = eventDescription(withFreshCopy());
    expect(out).toContain("SLIDE 1");
    expect(out).toContain("Your receipts are not the problem.");
    expect(out).toContain("CAPTION");
    expect(out).not.toContain("HOOK");
    expect(out).not.toContain("BODY");
  });

  it("keeps the brief alongside copy that is out of date", () => {
    // The bug this branch exists for: regenerate a synced slot's brief and the
    // calendar would otherwise show words written from a brief nobody can see.
    const out = eventDescription(
      slot({
        content: copy({ sourceHash: "written-from-an-older-brief" }) as unknown as Record<string, unknown>,
      })
    );
    expect(out).toContain("HEADS UP");
    expect(out).toContain("changed after this copy was written");
    expect(out).toContain("SLIDE 1");
    expect(out).toContain("HOOK");
    expect(out).toContain("BODY");
  });

  it("is unchanged for a slot with no copy", () => {
    // The regression guard: every slot that exists today takes this path.
    const out = eventDescription(slot());
    expect(out).toContain("HOOK");
    expect(out).toContain("BODY");
    expect(out).not.toContain("SLIDE 1");
    expect(out).not.toContain("HEADS UP");
  });

  it("stays under Google's limit and keeps the link when it truncates", () => {
    // Over ~8 KB Google answers 400, which would park the most content-rich
    // slots in the plan in googleSyncStatus "error".
    const huge = withFreshCopy({
      blocks: Array.from({ length: 12 }, (_, i) => ({
        label: `Slide ${i + 1}`,
        text: "x".repeat(1200),
      })),
      caption: "c".repeat(3000),
    });
    const out = eventDescription(huge, "https://app.example.com");
    expect(out.length).toBeLessThanOrEqual(MAX_EVENT_DESCRIPTION_CHARS);
    expect(out).toContain("truncated");
    expect(out.endsWith("/clients/c1/schedule")).toBe(true);
  });

  it("does not truncate an ordinary piece", () => {
    const out = eventDescription(withFreshCopy(), "https://app.example.com");
    expect(out).not.toContain("truncated");
    expect(out.endsWith("/clients/c1/schedule")).toBe(true);
  });
});
