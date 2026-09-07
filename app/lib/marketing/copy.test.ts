import { describe, it, expect } from "vitest";
import {
  normalizeFormat,
  blockLabelFor,
  formatShape,
  readCopy,
  sourceHash,
  isCopyStale,
  parseCopy,
  mergeCopy,
  copySections,
  copyToLines,
  copyWarnings,
  MAX_COPY_BLOCKS,
  MAX_BLOCK_CHARS,
  MAX_HASHTAGS,
  type SlotCopy,
} from "./copy";
import type { Slot } from "../types";

// Two things here are load-bearing and neither is obvious: normalizeFormat,
// without which every carousel on the only client with real data would be
// written as a plain post; and the refusal in parseCopy, which is what stops a
// bad model call wiping copy someone has already polished.

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: "s1",
    client_id: "c1",
    campaign_id: "cam1",
    campaign_title: "Tax Season",
    plan_run_id: "r1",
    gap_id: "2026-W37::carousel",
    date: "2026-09-08",
    time_local: "11:00",
    timezone: "America/New_York",
    scheduled_at: "2026-09-08T15:00:00.000Z",
    week_key: "2026-W37",
    type: "carousel",
    channel: "instagram",
    theme: "A bigger refund is not always the win taxpayers think it is",
    brief: "Reframe the refund as an interest-free loan.",
    rationale: "Pillar: myths",
    hook: "Got a $4,000 refund? You lent the IRS money for free.",
    body: ["Name the belief.", "Do the arithmetic.", "Offer the fix."],
    cta: "Book a withholding check.",
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

function copy(overrides: Partial<SlotCopy> = {}): SlotCopy {
  return {
    headline: null,
    blocks: [
      { label: "Slide 1", text: "Got a $4,000 refund?" },
      { label: "Slide 2", text: "You lent the IRS money for free." },
    ],
    caption: "The refund myth, in two slides.",
    hashtags: ["#tax", "#smallbusiness"],
    sourceHash: "abc",
    generatedAt: "2026-09-07T10:00:00.000Z",
    model: "gpt-5.5",
    editedAt: null,
    ...overrides,
  };
}

/** Put a copy object on a slot the way Firestore hands it back. */
function withCopy(c: SlotCopy, overrides: Partial<Slot> = {}): Slot {
  return slot({ content: c as unknown as Record<string, unknown>, ...overrides });
}

describe("normalizeFormat", () => {
  it("handles the separators the real data actually uses", () => {
    // Verified in Firestore, and the reason the first live run wrote a
    // carousel as a plain post: these are space-separated and mixed case, not
    // the underscore form the rest of the app uses.
    expect(normalizeFormat("instagram carousel", "instagram")).toBe("carousel");
    expect(normalizeFormat("instagram reel", "instagram")).toBe("reel");
    expect(normalizeFormat("instagram story", "instagram")).toBe("story");
    expect(normalizeFormat("Instagram Carousel", "instagram")).toBe("carousel");
    expect(normalizeFormat("instagram-carousel", "instagram")).toBe("carousel");
    // "CTA post" is genuinely a post, so the fallback is the right answer.
    expect(normalizeFormat("instagram CTA post", "instagram")).toBe("post");
  });

  it("strips a channel prefix off a legacy type", () => {
    // The whole reason this exists. The only client with real data carries
    // these, and without stripping, the prompt's "if not listed, treat as post"
    // fallback would write every carousel as a plain post.
    expect(normalizeFormat("instagram_carousel", "instagram")).toBe("carousel");
    expect(normalizeFormat("instagram_reel", "instagram")).toBe("reel");
    expect(normalizeFormat("instagram_story", "instagram")).toBe("story");
  });

  it("leaves a current type alone", () => {
    expect(normalizeFormat("carousel", "instagram")).toBe("carousel");
    expect(normalizeFormat("newsletter", "email")).toBe("newsletter");
    expect(normalizeFormat("post_alt", "linkedin")).toBe("post_alt");
  });

  it("only strips the prefix for the slot's own channel", () => {
    expect(normalizeFormat("linkedin_carousel", "instagram")).toBe("post");
  });

  it("falls back to post for anything it does not know", () => {
    expect(normalizeFormat("instagram_cta_post", "instagram")).toBe("post");
    expect(normalizeFormat("live_stream", "instagram")).toBe("post");
    expect(normalizeFormat("", "instagram")).toBe("post");
    expect(normalizeFormat("carousel", "")).toBe("carousel");
  });
});

describe("blockLabelFor and formatShape", () => {
  it("names the unit the format actually uses", () => {
    expect(blockLabelFor("carousel", 0)).toBe("Slide 1");
    expect(blockLabelFor("reel", 1)).toBe("Shot 2");
    expect(blockLabelFor("thread", 2)).toBe("Tweet 3");
    expect(blockLabelFor("story", 0)).toBe("Frame 1");
  });

  it("gives a newsletter a preheader, then sections", () => {
    // The subject is not a block — it is the headline field. Block 0 is the
    // preheader, which IS published copy in position 0.
    expect(blockLabelFor("newsletter", 0)).toBe("Preheader");
    expect(blockLabelFor("newsletter", 1)).toBe("Section 1");
  });

  it("treats a post as one unnumbered block", () => {
    expect(blockLabelFor("post", 0)).toBe("Post");
    expect(blockLabelFor("post_alt", 0)).toBe("Post");
  });

  it("knows which formats sit inside a caption box", () => {
    // Drives the platform measurement: the caption for a carousel, the joined
    // blocks for a post.
    expect(formatShape(slot({ type: "carousel" })).hasCaption).toBe(true);
    expect(formatShape(slot({ type: "instagram_reel" })).hasCaption).toBe(true);
    expect(formatShape(slot({ type: "post" })).hasCaption).toBe(false);
    expect(formatShape(slot({ type: "thread" })).hasCaption).toBe(false);
  });
});

describe("readCopy", () => {
  it("reads a real one back", () => {
    expect(readCopy(withCopy(copy()))?.blocks).toHaveLength(2);
  });

  it("returns null for everything Firestore could hand back instead", () => {
    // content is Record<string, unknown> | null, serializeSlot passes it
    // through unvalidated, and every slot written before this shipped is null.
    expect(readCopy(slot())).toBeNull();
    expect(readCopy(slot({ content: {} }))).toBeNull();
    expect(readCopy(slot({ content: { blocks: [] } }))).toBeNull();
    expect(readCopy(slot({ content: { blocks: "nonsense" } }))).toBeNull();
    expect(readCopy(slot({ content: { blocks: [{ text: "no label" }] } }))).toBeNull();
  });

  it("tolerates a document written by an older version of this file", () => {
    // No headline, no editedAt, no model — the shape before those existed.
    const old = readCopy(
      slot({ content: { blocks: [{ label: "Post", text: "Words" }] } })
    );
    expect(old).not.toBeNull();
    expect(old!.headline).toBeNull();
    expect(old!.model).toBeNull();
    expect(old!.hashtags).toEqual([]);
  });

  it("drops malformed blocks but keeps the good ones", () => {
    const mixed = readCopy(
      slot({
        content: {
          blocks: [
            { label: "Slide 1", text: "Good" },
            { label: "Slide 2" },
            null,
            { label: "Slide 3", text: "Also good" },
          ],
        },
      })
    );
    expect(mixed!.blocks.map((b) => b.text)).toEqual(["Good", "Also good"]);
  });
});

describe("staleness", () => {
  it("is not stale straight after writing", () => {
    const s = slot();
    expect(isCopyStale(withCopy(copy({ sourceHash: sourceHash(s) })))).toBe(false);
  });

  it("goes stale when the brief it was written from changes", () => {
    const s = slot();
    const written = withCopy(copy({ sourceHash: sourceHash(s) }), {
      hook: "A different hook entirely",
    });
    expect(isCopyStale(written)).toBe(true);
  });

  it("tracks the piece, not the notes about it", () => {
    // Fixing a typo in the rationale must not flag a hand-polished caption as
    // out of date.
    const s = slot();
    const base = sourceHash(s);
    expect(sourceHash({ ...s, theme: "other" })).not.toBe(base);
    expect(sourceHash({ ...s, hook: "other" })).not.toBe(base);
    expect(sourceHash({ ...s, cta: "other" })).not.toBe(base);
    expect(sourceHash({ ...s, body: ["one"] })).not.toBe(base);
    expect(sourceHash({ ...s, rationale: "other" })).toBe(base);
    expect(sourceHash({ ...s, brief: "other" })).toBe(base);
  });

  it("notices a reordering of the beats", () => {
    const s = slot();
    expect(sourceHash({ ...s, body: [...s.body].reverse() })).not.toBe(sourceHash(s));
  });

  it("says nothing about a slot with no copy", () => {
    expect(isCopyStale(slot())).toBe(false);
  });
});

describe("parseCopy", () => {
  it("keeps the blocks in order and labels them when the model does not", () => {
    const out = parseCopy(
      { blocks: [{ text: "One" }, { text: "Two" }, { text: "Three" }] },
      slot()
    );
    expect(out!.blocks.map((b) => b.label)).toEqual(["Slide 1", "Slide 2", "Slide 3"]);
    expect(out!.blocks.map((b) => b.text)).toEqual(["One", "Two", "Three"]);
  });

  it("labels from the legacy type too", () => {
    const out = parseCopy({ blocks: [{ text: "One" }] }, slot({ type: "instagram_reel" }));
    expect(out!.blocks[0].label).toBe("Shot 1");
  });

  it("absorbs a bare string where an object was asked for", () => {
    const out = parseCopy({ blocks: ["Just the words"] }, slot());
    expect(out!.blocks).toHaveLength(1);
    expect(out!.blocks[0].text).toBe("Just the words");
  });

  it("drops empty and malformed blocks rather than rendering blank slides", () => {
    const out = parseCopy(
      { blocks: [{ text: "One" }, { text: "   " }, null, 42, { text: "Two" }] },
      slot()
    );
    expect(out!.blocks).toHaveLength(2);
  });

  it("clamps on both axes", () => {
    const out = parseCopy(
      {
        blocks: Array.from({ length: 40 }, () => ({ text: "x".repeat(4000) })),
        caption: "c".repeat(9000),
        headline: "h".repeat(900),
      },
      slot()
    );
    expect(out!.blocks).toHaveLength(MAX_COPY_BLOCKS);
    expect(out!.blocks[0].text.length).toBe(MAX_BLOCK_CHARS);
    expect(out!.caption!.length).toBe(3000);
    expect(out!.headline!.length).toBe(200);
  });

  it("refuses an answer with nothing usable in it", () => {
    // The guarantee writeCopy relies on: a degraded result must never overwrite
    // copy someone has already polished.
    expect(parseCopy({ blocks: [] }, slot())).toBeNull();
    expect(parseCopy({}, slot())).toBeNull();
    expect(parseCopy("not an object", slot())).toBeNull();
    expect(parseCopy(null, slot())).toBeNull();
    expect(parseCopy({ blocks: [{ text: "" }] }, slot())).toBeNull();
    // A caption alone is not a piece.
    expect(parseCopy({ caption: "Only a caption" }, slot())).toBeNull();
  });

  it("keeps published words and direction apart", () => {
    // The reason a block has three fields: on a reel the voiceover, the
    // on-screen text and the camera direction are three different things, and
    // only two of them get published.
    const out = parseCopy(
      {
        blocks: [
          {
            text: "Your receipts are not the problem.",
            onScreen: "NOT THE PROBLEM",
            note: "Close on the shoebox, hands sorting",
          },
        ],
      },
      slot({ type: "instagram_reel" })
    );
    expect(out!.blocks[0].onScreen).toBe("NOT THE PROBLEM");
    expect(out!.blocks[0].note).toBe("Close on the shoebox, hands sorting");
  });

  it("omits optional fields entirely rather than storing undefined", () => {
    const out = parseCopy({ blocks: [{ text: "One" }] }, slot());
    expect("note" in out!.blocks[0]).toBe(false);
    expect("onScreen" in out!.blocks[0]).toBe(false);
    expect(out!.caption).toBeNull();
    expect(out!.headline).toBeNull();
  });

  it("adds the # a model forgot, and caps the list", () => {
    const out = parseCopy(
      {
        blocks: [{ text: "One" }],
        hashtags: ["tax", "#bookkeeping", "", ...Array(50).fill("more")],
      },
      slot()
    );
    expect(out!.hashtags[0]).toBe("#tax");
    expect(out!.hashtags[1]).toBe("#bookkeeping");
    expect(out!.hashtags.length).toBe(MAX_HASHTAGS);
  });
});

describe("mergeCopy", () => {
  it("carries provenance across a hand edit rather than accepting it", () => {
    // If the route took sourceHash from the client, a caller could forge
    // "not stale". If it recomputed it, editing the COPY would silently re-base
    // staleness against a brief the copy was never written from.
    const existing = copy({ sourceHash: "written-from-this", model: "gpt-5.5" });
    const merged = mergeCopy(
      existing,
      { headline: null, blocks: [{ label: "Slide 1", text: "Edited" }], caption: null, hashtags: [] },
      "2026-09-08T09:00:00.000Z"
    );
    expect(merged.sourceHash).toBe("written-from-this");
    expect(merged.model).toBe("gpt-5.5");
    expect(merged.generatedAt).toBe(existing.generatedAt);
    expect(merged.editedAt).toBe("2026-09-08T09:00:00.000Z");
    expect(merged.blocks[0].text).toBe("Edited");
  });

  it("reads as hand-written when there was nothing there before", () => {
    const merged = mergeCopy(
      null,
      { headline: null, blocks: [{ label: "Post", text: "Typed by a person" }], caption: null, hashtags: [] },
      "2026-09-08T09:00:00.000Z"
    );
    expect(merged.model).toBeNull();
    expect(merged.generatedAt).toBe("2026-09-08T09:00:00.000Z");
    expect(merged.sourceHash).toBe("");
  });
});

describe("copySections and copyToLines", () => {
  it("orders subject, blocks, caption, hashtags", () => {
    const sections = copySections(
      copy({ headline: "Your refund is not a bonus", caption: "A caption" })
    );
    expect(sections.map((s) => s.label)).toEqual([
      "Subject",
      "Slide 1",
      "Slide 2",
      "Caption",
      "Hashtags",
    ]);
  });

  it("folds on-screen text and direction into one note", () => {
    const sections = copySections(
      copy({
        blocks: [
          { label: "Shot 1", text: "Said out loud", onScreen: "ON SCREEN", note: "Close on hands" },
        ],
        caption: null,
        hashtags: [],
      })
    );
    expect(sections[0].note).toBe("on screen: ON SCREEN · Close on hands");
  });

  it("omits sections that are empty", () => {
    const sections = copySections(copy({ headline: null, caption: null, hashtags: [] }));
    expect(sections.map((s) => s.label)).toEqual(["Slide 1", "Slide 2"]);
  });

  it("renders lines without leaking undefined", () => {
    const text = copyToLines(copy({ headline: null, caption: null, hashtags: [] })).join("\n");
    expect(text).not.toContain("undefined");
    expect(text).toContain("SLIDE 1");
    expect(text).not.toContain("CAPTION");
  });
});

describe("copyWarnings", () => {
  it("flags a tweet over 280", () => {
    // Truncating instead would produce something silently wrong that then gets
    // pasted, which is the whole argument for warning.
    const out = copyWarnings(
      copy({ blocks: [{ label: "Tweet 1", text: "t".repeat(300) }], caption: null }),
      slot({ type: "thread", channel: "twitter" })
    );
    expect(out.join(" ")).toContain("300 characters");
    expect(out.join(" ")).toContain("280");
  });

  it("does not apply a per-block limit where the platform has none", () => {
    const out = copyWarnings(
      copy({ blocks: [{ label: "Post", text: "t".repeat(1000) }], caption: null, hashtags: [] }),
      slot({ type: "post", channel: "linkedin" })
    );
    expect(out).toEqual([]);
  });

  it("measures the caption when the format has one", () => {
    const out = copyWarnings(
      copy({ caption: "c".repeat(2500) }),
      slot({ type: "carousel", channel: "instagram" })
    );
    expect(out.join(" ")).toContain("The caption is 2500");
  });

  it("measures the joined blocks when the format has no caption", () => {
    const out = copyWarnings(
      copy({
        blocks: [
          { label: "Post", text: "p".repeat(2000) },
          { label: "Post", text: "p".repeat(2000) },
        ],
        caption: null,
      }),
      slot({ type: "post", channel: "linkedin" })
    );
    expect(out.join(" ")).toContain("The post is 4002");
  });

  it("never flags length on email", () => {
    const out = copyWarnings(
      copy({ blocks: [{ label: "Section 1", text: "e".repeat(20000) }], caption: null }),
      slot({ type: "newsletter", channel: "email" })
    );
    expect(out).toEqual([]);
  });

  it("is quiet at exactly the limit", () => {
    const out = copyWarnings(
      copy({ blocks: [{ label: "Tweet 1", text: "t".repeat(280) }], caption: null, hashtags: [] }),
      slot({ type: "thread", channel: "twitter" })
    );
    expect(out).toEqual([]);
  });
});
