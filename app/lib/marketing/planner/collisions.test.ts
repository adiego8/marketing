import { describe, it, expect } from "vitest";
import { themeCollisions } from "./collisions";
import type { Fill } from "./types";

function fill(theme: string, gapId = theme.slice(0, 8)): Fill {
  return {
    gapId,
    campaignId: "c1",
    channel: "linkedin",
    theme,
    brief: "",
    rationale: "",
    hook: "",
    body: [],
    cta: "",
    needsTheme: false,
  };
}

describe("themeCollisions", () => {
  it("catches two pieces making the same argument in different words", () => {
    // The exact failure the whole phase exists for, and the one an exact-string
    // comparison — the only check this repo had before — sails straight past.
    const out = themeCollisions([
      fill("Why per-seat pricing punishes the teams growing fastest"),
      fill("Per-seat pricing punishes the fastest growing teams"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("same argument");
  });

  it("leaves genuinely different arguments alone", () => {
    const out = themeCollisions([
      fill("Why per-seat pricing punishes the teams growing fastest"),
      fill("The first 24 hours after a call decide whether you win the job"),
      fill("What collecting three quotes actually costs you every week"),
    ]);
    expect(out).toEqual([]);
  });

  it("catches a theme this client has already had", () => {
    const out = themeCollisions(
      [fill("What collecting three quotes costs you every week")],
      [{ theme: "What collecting three quotes actually costs you each week" }]
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("already had");
  });

  it("reports every colliding pair, not just the first", () => {
    const out = themeCollisions([
      fill("What three quotes per job costs you every week", "a"),
      fill("What three quotes per job costs you each week", "b"),
      fill("Three quotes per job costs you every week", "c"),
    ]);
    expect(out).toHaveLength(3);
  });

  it("does not stem, so a heavily reworded pair can still slip through", () => {
    // Recorded rather than hidden. "punishes" and "punished" read as two
    // different words here, which is the cost of a measure that needs no
    // dictionary and no model call. The allocation is what prevents the
    // problem; this is the net underneath it, and the net has holes.
    const out = themeCollisions([
      fill("Per-seat pricing punishes teams that grow", "a"),
      fill("Growing teams are punished by per-seat pricing", "b"),
    ]);
    expect(out).toEqual([]);
  });

  it("ignores pieces with no theme, which already have their own warning", () => {
    // Two empty strings are not a collision, and saying so twice about the same
    // failed generation would bury the warning that matters.
    expect(themeCollisions([fill(""), fill("")])).toEqual([]);
    expect(themeCollisions([fill("   "), fill("A real theme about pricing")])).toEqual([]);
  });

  it("shortens a long theme rather than printing the whole thing", () => {
    const long =
      "Why per-seat pricing quietly punishes exactly the teams that are growing fastest, every single month";
    const out = themeCollisions([fill(long, "a"), fill(long, "b")]);
    expect(out[0]).toContain("…");
    expect(out[0]).not.toContain(long);
    expect(out[0]).toContain("Why per-seat pricing quietly punishes");
  });

  it("survives an empty run and a missing recent-theme list", () => {
    expect(themeCollisions([])).toEqual([]);
    expect(themeCollisions([fill("Anything at all about pricing")])).toEqual([]);
  });
});
