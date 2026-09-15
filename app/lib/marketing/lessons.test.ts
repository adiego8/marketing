import { describe, it, expect } from "vitest";
import {
  lessonsFor,
  diffBrief,
  snapshotOf,
  MAX_LESSONS_PER_PROMPT,
} from "./lessons";
import type { Lesson, LessonScope } from "../types";

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    client_id: "c1",
    text: "Open with the cost of the status quo.",
    scope: "plan_themes",
    status: "active",
    source: "written",
    owner: "client",
    evidence: [],
    evidence_count: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    retired_at: null,
    ...over,
  };
}

describe("lessonsFor", () => {
  it("returns the text of lessons in scope", () => {
    expect(lessonsFor([lesson()], "plan_themes")).toEqual([
      "Open with the cost of the status quo.",
    ]);
  });

  // A rule about hooks has no business steering campaign strategy, and every
  // irrelevant line in a prompt is one the real instruction competes with.
  it("keeps a lesson out of a prompt it is not about", () => {
    const all = [
      lesson({ id: "a", scope: "copy", text: "Copy rule" }),
      lesson({ id: "b", scope: "plan_themes", text: "Theme rule" }),
      lesson({ id: "c", scope: "campaign_ideas", text: "Campaign rule" }),
    ];
    expect(lessonsFor(all, "copy")).toEqual(["Copy rule"]);
    expect(lessonsFor(all, "campaign_ideas")).toEqual(["Campaign rule"]);
  });

  // The whole point of retiring rather than deleting: it stops acting, and
  // stays readable on the page.
  it("never sends a retired lesson", () => {
    expect(lessonsFor([lesson({ status: "retired" })], "plan_themes")).toEqual([]);
  });

  it("drops a lesson with no text rather than sending a blank rule", () => {
    expect(lessonsFor([lesson({ text: "   " })], "plan_themes")).toEqual([]);
  });

  it("trims, so a stray newline does not reach the model", () => {
    expect(lessonsFor([lesson({ text: "  Say it plainly.  " })], "plan_themes")).toEqual([
      "Say it plainly.",
    ]);
  });

  // Strongest first, so if the cap bites it is the weakly-evidenced rules that
  // fall off rather than whichever happened to be written last.
  it("puts the best-evidenced lesson first", () => {
    const all = [
      lesson({ id: "a", text: "Weak", evidence_count: 1 }),
      lesson({ id: "b", text: "Strong", evidence_count: 9 }),
      lesson({ id: "c", text: "Middling", evidence_count: 4 }),
    ];
    expect(lessonsFor(all, "plan_themes")).toEqual(["Strong", "Middling", "Weak"]);
  });

  it("breaks a tie on recency", () => {
    const all = [
      lesson({ id: "a", text: "Older", created_at: "2026-01-01T00:00:00.000Z" }),
      lesson({ id: "b", text: "Newer", created_at: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(lessonsFor(all, "plan_themes")).toEqual(["Newer", "Older"]);
  });

  // The failure mode this feature has to avoid: a prompt that grows until the
  // actual task is buried under guidance.
  it("caps how many reach one prompt", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      lesson({ id: `l${i}`, text: `Rule ${i}`, evidence_count: 40 - i })
    );
    expect(lessonsFor(many, "plan_themes")).toHaveLength(MAX_LESSONS_PER_PROMPT);
    expect(lessonsFor(many, "plan_themes", 3)).toEqual(["Rule 0", "Rule 1", "Rule 2"]);
  });

  it("returns an empty array, never undefined, when nothing is taught", () => {
    for (const scope of ["plan_themes", "copy", "campaign_ideas"] as LessonScope[]) {
      expect(lessonsFor([], scope)).toEqual([]);
    }
  });
});

describe("snapshotOf", () => {
  it("fills in what a partial slot is missing", () => {
    expect(snapshotOf({ theme: "A theme" })).toEqual({
      theme: "A theme",
      hook: "",
      body: [],
      cta: "",
    });
  });

  it("copies body rather than aliasing it", () => {
    const body = ["one"];
    const snap = snapshotOf({ body });
    body.push("two");
    expect(snap.body).toEqual(["one"]);
  });

  it("survives null", () => {
    expect(snapshotOf(null).theme).toBe("");
  });
});

describe("diffBrief", () => {
  const before = { theme: "T", hook: "H", body: ["a", "b"], cta: "C" };

  // Saving a form without touching it is not feedback. Counting it as one would
  // quietly inflate the evidence behind every rule.
  it("reports nothing when nothing moved", () => {
    expect(diffBrief(before, { ...before, body: ["a", "b"] })).toEqual([]);
  });

  it("names only the fields that changed", () => {
    expect(diffBrief(before, { ...before, hook: "New hook" })).toEqual(["hook"]);
    expect(
      diffBrief(before, { ...before, theme: "New", cta: "Also new" })
    ).toEqual(["theme", "cta"]);
  });

  // body is a fresh array on every read, so identity comparison would report a
  // change on every single save.
  it("compares the beats by value", () => {
    expect(diffBrief(before, { ...before, body: ["a", "b"] })).toEqual([]);
    expect(diffBrief(before, { ...before, body: ["a", "different"] })).toEqual(["body"]);
    expect(diffBrief(before, { ...before, body: ["a"] })).toEqual(["body"]);
    expect(diffBrief(before, { ...before, body: ["a", "b", "c"] })).toEqual(["body"]);
  });
});
