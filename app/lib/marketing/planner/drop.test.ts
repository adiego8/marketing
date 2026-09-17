import { describe, expect, it } from "vitest";
import {
  applyDrops,
  applyReplacements,
  applyRestores,
  MAX_DROP_REASON_CHARS,
  openDrops,
  parseDrops,
  parseSlotIds,
  rejectedThemes,
  replacementSlot,
} from "./drop";
import { buildReplaceGaps, gapIdFor } from "./replace";
import type { DroppedSlot, ProposedSlot } from "../../types";
import type { Fill } from "./types";

function slot(over: Partial<ProposedSlot> = {}): ProposedSlot {
  return {
    slotId: "c1__2026-09-15__post__linkedin__0",
    gapId: "2026-W38__post__0",
    weekKey: "2026-W38",
    date: "2026-09-15",
    timeLocal: "09:00",
    timezone: "Europe/Madrid",
    scheduledAt: "2026-09-15T07:00:00.000Z",
    type: "post",
    channel: "linkedin",
    campaignId: "camp1",
    campaignTitle: "Launch",
    theme: "Why upfront pricing wins",
    brief: "Argue for showing the price first.",
    rationale: "Pillar: transparency.",
    hook: "Nobody tells you the price.",
    body: ["beat one", "beat two"],
    cta: "See our pricing.",
    needsTheme: false,
    ...over,
  };
}

function dropped(over: Partial<DroppedSlot> = {}): DroppedSlot {
  return {
    ...slot(),
    reason: "",
    droppedAt: "2026-09-08T10:00:00.000Z",
    replacedAt: null,
    ...over,
  };
}

function fill(over: Partial<Fill> = {}): Fill {
  return {
    gapId: gapIdFor("c1__2026-09-15__post__linkedin__0"),
    campaignId: "camp1",
    channel: "linkedin",
    theme: "The hidden cost of a free quote",
    brief: "A different argument entirely.",
    rationale: "Pillar: transparency.",
    hook: "Free quotes are not free.",
    body: ["a", "b"],
    cta: "Get a real number.",
    needsTheme: false,
    ...over,
  };
}

describe("parseDrops", () => {
  it("reads slot ids and reasons", () => {
    expect(parseDrops({ drops: [{ slotId: "a", reason: " too salesy " }] })).toEqual([
      { slotId: "a", reason: "too salesy" },
    ]);
  });

  it("caps a long reason rather than rejecting it", () => {
    const [row] = parseDrops({ drops: [{ slotId: "a", reason: "x".repeat(900) }] });
    expect(row.reason).toHaveLength(MAX_DROP_REASON_CHARS);
  });

  it("defaults a missing or non-string reason to empty", () => {
    expect(parseDrops({ drops: [{ slotId: "a" }, { slotId: "b", reason: 7 }] })).toEqual([
      { slotId: "a", reason: "" },
      { slotId: "b", reason: "" },
    ]);
  });

  it("skips junk entries and dedupes by slot id", () => {
    expect(
      parseDrops({ drops: [{ slotId: "a" }, { slotId: "a", reason: "dup" }, {}, null, 3] })
    ).toEqual([{ slotId: "a", reason: "" }]);
  });

  it("returns nothing for a body with no drops array", () => {
    expect(parseDrops({})).toEqual([]);
    expect(parseDrops(null)).toEqual([]);
    expect(parseDrops({ drops: "a" })).toEqual([]);
  });
});

describe("parseSlotIds", () => {
  it("trims, dedupes and drops non-strings", () => {
    expect(parseSlotIds({ slotIds: [" a ", "a", "", 4, "b"] })).toEqual(["a", "b"]);
  });

  it("returns empty for junk", () => {
    expect(parseSlotIds({})).toEqual([]);
    expect(parseSlotIds({ slotIds: {} })).toEqual([]);
  });
});

describe("applyDrops", () => {
  const now = "2026-09-08T12:00:00.000Z";

  it("moves a slot out of proposed and into dropped", () => {
    const a = slot({ slotId: "a" });
    const b = slot({ slotId: "b" });
    const result = applyDrops([a, b], [], [{ slotId: "a", reason: "too salesy" }], now);

    expect(result.proposed.map((s) => s.slotId)).toEqual(["b"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toMatchObject({
      slotId: "a",
      reason: "too salesy",
      droppedAt: now,
      replacedAt: null,
      // The whole slot is kept, not just its id.
      theme: a.theme,
      date: a.date,
    });
    expect(result.warnings).toEqual([]);
  });

  it("keeps the rest of the plan untouched", () => {
    const keep = slot({ slotId: "b", theme: "keep me" });
    const result = applyDrops([slot({ slotId: "a" }), keep], [], [{ slotId: "a", reason: "" }], now);
    expect(result.proposed[0]).toEqual(keep);
  });

  it("edits the reason when the slot is already dropped", () => {
    const existing = dropped({ slotId: "a", reason: "first" });
    const result = applyDrops([], [existing], [{ slotId: "a", reason: "second" }], now);

    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toBe("second");
    // The original drop time survives a reason edit.
    expect(result.dropped[0].droppedAt).toBe(existing.droppedAt);
    expect(result.warnings).toEqual([]);
  });

  it("will not edit the reason of a drop that has been replaced", () => {
    const done = dropped({ slotId: "a", reason: "first", replacedAt: now });
    const result = applyDrops([], [done], [{ slotId: "a", reason: "second" }], now);

    expect(result.dropped[0].reason).toBe("first");
    expect(result.warnings).toHaveLength(1);
  });

  it("warns about a slot that is in neither list", () => {
    const result = applyDrops([], [], [{ slotId: "ghost", reason: "" }], now);
    expect(result.warnings[0]).toContain("ghost");
    expect(result.dropped).toEqual([]);
  });

  it("drops several at once", () => {
    const result = applyDrops(
      [slot({ slotId: "a" }), slot({ slotId: "b" }), slot({ slotId: "c" })],
      [],
      [{ slotId: "a", reason: "" }, { slotId: "c", reason: "" }],
      now
    );
    expect(result.proposed.map((s) => s.slotId)).toEqual(["b"]);
    expect(result.dropped.map((s) => s.slotId)).toEqual(["a", "c"]);
  });
});

describe("applyRestores", () => {
  it("puts the slot back exactly as it was, without the drop bookkeeping", () => {
    const original = slot({ slotId: "a" });
    const result = applyRestores([], [dropped({ ...original, reason: "nope" })], ["a"]);

    expect(result.dropped).toEqual([]);
    expect(result.proposed).toEqual([original]);
    expect(result.proposed[0]).not.toHaveProperty("reason");
    expect(result.proposed[0]).not.toHaveProperty("droppedAt");
    expect(result.proposed[0]).not.toHaveProperty("replacedAt");
  });

  it("restores in calendar order, not append order", () => {
    const early = slot({ slotId: "early", date: "2026-09-14" });
    const late = slot({ slotId: "late", date: "2026-09-18" });
    const result = applyRestores([late], [dropped({ ...early })], ["early"]);
    expect(result.proposed.map((s) => s.slotId)).toEqual(["early", "late"]);
  });

  it("refuses when a replacement already holds that slot id", () => {
    const taken = slot({ slotId: "a", theme: "the replacement" });
    const result = applyRestores([taken], [dropped({ slotId: "a", replacedAt: "x" })], ["a"]);

    expect(result.proposed).toEqual([taken]);
    expect(result.dropped).toHaveLength(1);
    expect(result.warnings[0]).toContain("already been replaced");
  });

  it("restores the others even when one is refused", () => {
    const result = applyRestores(
      [slot({ slotId: "a" })],
      [
        dropped({ slotId: "a", replacedAt: "x" }),
        dropped({ slotId: "b", date: "2026-09-16" }),
      ],
      ["a", "b"]
    );
    expect(result.proposed.map((s) => s.slotId)).toEqual(["a", "b"]);
    expect(result.dropped.map((s) => s.slotId)).toEqual(["a"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("warns about an id that was never dropped", () => {
    const result = applyRestores([], [], ["ghost"]);
    expect(result.warnings[0]).toContain("ghost");
  });
});

describe("openDrops", () => {
  const list = [
    dropped({ slotId: "a" }),
    dropped({ slotId: "b", replacedAt: "2026-09-08T11:00:00.000Z" }),
    dropped({ slotId: "c" }),
  ];

  it("ignores drops that already have a replacement", () => {
    expect(openDrops(list).map((d) => d.slotId)).toEqual(["a", "c"]);
  });

  it("narrows to a selection", () => {
    expect(openDrops(list, ["c"]).map((d) => d.slotId)).toEqual(["c"]);
  });

  it("treats an empty selection as all of them", () => {
    expect(openDrops(list, [])).toHaveLength(2);
  });

  it("ignores a selected id that is already replaced", () => {
    expect(openDrops(list, ["b"])).toEqual([]);
  });
});

describe("rejectedThemes", () => {
  it("includes replaced drops, so a rejected idea can never come back", () => {
    const themes = rejectedThemes([
      dropped({ slotId: "a", theme: "One", replacedAt: "x" }),
      dropped({ slotId: "b", theme: "Two" }),
    ]);
    expect(themes.map((t) => t.theme)).toEqual(["One", "Two"]);
  });

  it("dedupes case-insensitively and skips empties", () => {
    const themes = rejectedThemes([
      dropped({ slotId: "a", theme: "Same" }),
      dropped({ slotId: "b", theme: "same" }),
      dropped({ slotId: "c", theme: "  " }),
    ]);
    expect(themes).toHaveLength(1);
  });
});

describe("replacementSlot", () => {
  it("keeps everything the assign stage decided and changes only the idea", () => {
    const original = dropped({ reason: "too salesy" });
    const next = replacementSlot(original, fill());

    expect(next.slotId).toBe(original.slotId);
    expect(next.date).toBe(original.date);
    expect(next.timeLocal).toBe(original.timeLocal);
    expect(next.scheduledAt).toBe(original.scheduledAt);
    expect(next.channel).toBe(original.channel);
    expect(next.type).toBe(original.type);
    expect(next.campaignId).toBe(original.campaignId);
    expect(next.campaignTitle).toBe(original.campaignTitle);

    expect(next.theme).toBe("The hidden cost of a free quote");
    expect(next.hook).toBe("Free quotes are not free.");
    expect(next).not.toHaveProperty("reason");
    expect(next).not.toHaveProperty("replacedAt");
  });
});

describe("applyReplacements", () => {
  const now = "2026-09-08T12:30:00.000Z";
  const map = new Map([[gapIdFor("c1__2026-09-15__post__linkedin__0"), "c1__2026-09-15__post__linkedin__0"]]);

  it("adds the replacement and marks the drop replaced", () => {
    const result = applyReplacements([], [dropped()], [fill()], map, now);

    expect(result.replaced).toBe(1);
    expect(result.proposed).toHaveLength(1);
    expect(result.proposed[0].theme).toBe("The hidden cost of a free quote");
    expect(result.dropped[0].replacedAt).toBe(now);
    // The rejected theme is kept, which is what keeps it on the avoid-list.
    expect(result.dropped[0].theme).toBe("Why upfront pricing wins");
  });

  it("leaves the slot dropped when the model returned no theme", () => {
    const result = applyReplacements(
      [],
      [dropped()],
      [fill({ theme: "", needsTheme: true })],
      map,
      now
    );

    expect(result.replaced).toBe(0);
    expect(result.proposed).toEqual([]);
    expect(result.dropped[0].replacedAt).toBeNull();
    expect(result.warnings[0]).toContain("still dropped");
  });

  it("inserts the replacement in calendar order", () => {
    const later = slot({ slotId: "later", date: "2026-09-20" });
    const result = applyReplacements([later], [dropped()], [fill()], map, now);
    expect(result.proposed.map((s) => s.date)).toEqual(["2026-09-15", "2026-09-20"]);
  });

  it("ignores a fill for a gap that was not requested", () => {
    const result = applyReplacements([], [dropped()], [fill({ gapId: "nope" })], map, now);
    expect(result.replaced).toBe(0);
    expect(result.dropped[0].replacedAt).toBeNull();
  });

  it("never touches a drop that was already replaced", () => {
    const done = dropped({ replacedAt: "earlier" });
    const result = applyReplacements([], [done], [fill()], map, now);
    expect(result.replaced).toBe(0);
    expect(result.dropped[0].replacedAt).toBe("earlier");
  });
});

describe("buildReplaceGaps", () => {
  it("pins the channel so parseFills cannot move the piece", () => {
    const [gap] = buildReplaceGaps([dropped({ channel: "instagram" })]);
    expect(gap.allowed_channels).toEqual(["instagram"]);
    expect(gap.default_channel).toBe("instagram");
  });

  it("pins the campaign to the one the slot already serves", () => {
    const [gap] = buildReplaceGaps([dropped({ campaignId: "camp7" })]);
    expect(gap.eligible_campaign_ids).toEqual(["camp7"]);
  });

  it("always sends exactly one campaign, never a choice", () => {
    const gaps = buildReplaceGaps([
      dropped({ slotId: "a", campaignId: "camp7" }),
      dropped({ slotId: "b", campaignId: "camp9" }),
    ]);
    expect(gaps.map((g) => g.eligible_campaign_ids)).toEqual([["camp7"], ["camp9"]]);
  });

  it("falls back to a real channel when the stored one is junk", () => {
    const [gap] = buildReplaceGaps([dropped({ channel: "myspace" })]);
    expect(gap.allowed_channels).toEqual(["linkedin"]);
  });

  it("numbers the batch so the model can vary them", () => {
    const gaps = buildReplaceGaps([
      dropped({ slotId: "a" }),
      dropped({ slotId: "b" }),
    ]);
    expect(gaps.map((g) => g.index_in_set)).toEqual([0, 1]);
    expect(gaps.every((g) => g.of_in_set === 2)).toBe(true);
    expect(new Set(gaps.map((g) => g.gap_id)).size).toBe(2);
  });
});
