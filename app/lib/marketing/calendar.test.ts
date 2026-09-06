import { describe, it, expect } from "vitest";
import { eventTitle, eventDescription } from "./calendar";
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
