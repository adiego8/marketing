import { describe, it, expect } from "vitest";
import { planMarkdown, planFilename } from "./plan-markdown";
import type { Slot } from "../../types";

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: "s1",
    client_id: "c1",
    campaign_id: null,
    campaign_title: null,
    plan_run_id: "r1",
    gap_id: "2026-W37::post",
    date: "2026-09-08",
    time_local: "09:00",
    timezone: "America/New_York",
    scheduled_at: "2026-09-08T13:00:00.000Z",
    week_key: "2026-W37",
    type: "post",
    channel: "linkedin",
    theme: "Why quarterly filing slips",
    brief: "Open with the deadline nobody tracks.",
    rationale: "Pillar: process",
    needs_theme: false,
    status: "planned",
    source: "agent",
    pinned: false,
    content: null,
    google_event_id: null,
    google_sync_status: "pending",
    last_human_edit_at: null,
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

const META = {
  clientName: "MyWellTax",
  timezone: "America/New_York",
  start: "2026-09-08",
  end: "2026-09-21",
  generatedAt: new Date("2026-09-05T14:30:00Z"),
};

describe("planMarkdown", () => {
  it("puts the client, range and timezone in the header", () => {
    const md = planMarkdown([slot()], META);
    expect(md).toContain("# Content plan — MyWellTax");
    expect(md).toContain("**2026-09-08 to 2026-09-21**");
    // The timezone is the difference between "09:00" meaning anything and
    // meaning something, so it has to be on the page.
    expect(md).toContain("times shown in America/New_York");
  });

  it("renders the date in the client's own calendar day", () => {
    // Parsed as UTC deliberately: a reader in UTC-5 opening this must not see
    // the 8th become the 7th.
    expect(planMarkdown([slot()], META)).toContain("**Tue 8 Sep · 09:00**");
  });

  it("groups by ISO week in the order given", () => {
    const md = planMarkdown(
      [
        slot({ id: "a", week_key: "2026-W37" }),
        slot({ id: "b", week_key: "2026-W38", date: "2026-09-15" }),
        slot({ id: "c", week_key: "2026-W37" }),
      ],
      META
    );
    expect(md.indexOf("## 2026-W37")).toBeLessThan(md.indexOf("## 2026-W38"));
    expect(md.match(/## 2026-W37/g)).toHaveLength(1);
  });

  it("says so when a theme is missing rather than leaving a blank", () => {
    const md = planMarkdown([slot({ needs_theme: true, theme: "" })], META);
    expect(md).toContain("_Theme not set._");
  });

  it("omits cancelled and skipped slots but accounts for them", () => {
    const md = planMarkdown(
      [slot({ id: "a" }), slot({ id: "b", status: "cancelled", theme: "Dropped idea" })],
      META
    );
    expect(md).not.toContain("Dropped idea");
    expect(md).toContain("1 cancelled or skipped slot omitted");
    expect(md).toContain("1 piece of content scheduled");
  });

  it("marks a non-default status inline", () => {
    expect(planMarkdown([slot({ status: "posted" })], META)).toContain("_(posted)_");
    // A planned slot is the unremarkable case and stays unannotated.
    expect(planMarkdown([slot()], META)).not.toContain("_(planned)_");
  });

  it("handles an empty range without pretending there is content", () => {
    const md = planMarkdown([], META);
    expect(md).toContain("_No content scheduled in this range._");
    expect(md).not.toContain("pieces of content scheduled");
  });

  it("includes campaign and rationale when present", () => {
    const md = planMarkdown([slot({ campaign_title: "Q4 Launch" })], META);
    expect(md).toContain("Campaign: Q4 Launch · Pillar: process");
  });

  it("is deterministic given a fixed generation time", () => {
    expect(planMarkdown([slot()], META)).toBe(planMarkdown([slot()], META));
    expect(planMarkdown([slot()], META)).toContain("Generated 2026-09-05 14:30 UTC");
  });

  it("titlecases channel and type without leaking underscores", () => {
    const md = planMarkdown([slot({ type: "post_alt" })], META);
    expect(md).toContain("Linkedin · Post Alt");
    expect(md).not.toContain("post_alt");
  });
});

describe("planFilename", () => {
  it("slugs the client and sorts chronologically", () => {
    expect(planFilename("MyWellTax", "2026-09-08", "2026-09-21")).toBe(
      "mywelltax-content-plan-2026-09-08-to-2026-09-21.md"
    );
  });

  it("survives punctuation and a name that is entirely punctuation", () => {
    expect(planFilename("Acme, Inc.", "2026-01-01", "2026-01-07")).toBe(
      "acme-inc-content-plan-2026-01-01-to-2026-01-07.md"
    );
    expect(planFilename("!!!", "2026-01-01", "2026-01-07")).toBe(
      "client-content-plan-2026-01-01-to-2026-01-07.md"
    );
  });
});
