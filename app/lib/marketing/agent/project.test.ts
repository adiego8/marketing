import { describe, it, expect } from "vitest";
import { sourceHash } from "../copy";
import {
  copyState,
  publishable,
  projectSlot,
  projectBranding,
  safeLogoUrl,
  sortKeyOf,
  paginate,
  clampLimit,
  encodeCursor,
  decodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "./project";
import type { Slot } from "../../types";

/**
 * This projection is a promise to somebody else's code. Two things make it
 * worth its own test file rather than a few assertions on the route:
 *
 *  - Field names here cannot be renamed once an agent depends on them, so the
 *    key list is pinned the way commit.test.ts pins the serializer's.
 *  - The two judgements it makes — is the copy usable, may this be published —
 *    are the only thing standing between a half-written draft and a client's
 *    live feed. Neither is visible in a manual click-through.
 */

function slot(over: Partial<Slot> = {}): Slot {
  const base: Slot = {
    id: "s1",
    client_id: "c1",
    campaign_id: "camp1",
    campaign_title: "Launch",
    plan_run_id: "run1",
    gap_id: "camp1__post__0",
    date: "2026-09-16",
    time_local: "09:30",
    timezone: "Europe/Madrid",
    scheduled_at: "2026-09-16T07:30:00.000Z",
    week_key: "2026-W38",
    type: "carousel",
    channel: "linkedin",
    theme: "Why quarterly planning breaks",
    brief: "Open with the deadline nobody tracks.",
    rationale: "Pillar: process",
    hook: "Nobody diarises the deadline.",
    body: ["Name the date.", "What it costs."],
    cta: "Book the check.",
    needs_theme: false,
    status: "confirmed",
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
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-14T11:02:44.019Z",
  };
  return { ...base, ...over };
}

/** Copy written from this slot's current brief, so it reads as fresh. */
function freshCopy(s: Slot, over: Record<string, unknown> = {}) {
  return {
    headline: null,
    blocks: [
      { label: "Slide 1", text: "The deadline nobody tracks.", note: "shot: whiteboard" },
      { label: "Slide 2", text: "What it costs you.", onScreen: "€4,000" },
    ],
    caption: "The box you paste into.",
    hashtags: ["#tax"],
    sourceHash: sourceHash(s),
    generatedAt: "2026-09-10T09:00:00.000Z",
    model: "gpt-5.5",
    editedAt: null,
    ...over,
  };
}

describe("copyState", () => {
  it("reports missing when there is no copy", () => {
    expect(copyState(slot({ content: null }))).toBe("missing");
  });

  // readCopy returns null for an empty block list, so this must land on
  // "missing" rather than falling through to a staleness comparison.
  it("reports missing when the copy has no blocks", () => {
    expect(copyState(slot({ content: { blocks: [] } }))).toBe("missing");
  });

  it("reports ready when the copy matches the brief", () => {
    const s = slot();
    expect(copyState(slot({ content: freshCopy(s) }))).toBe("ready");
  });

  it("reports stale once the brief moves underneath it", () => {
    const s = slot();
    const written = freshCopy(s);
    expect(copyState(slot({ content: written, hook: "A different opening." }))).toBe(
      "stale"
    );
  });

  /**
   * The trap this function exists for. isCopyStale answers false for a slot
   * with no copy at all, so anything built on that boolean treats "nothing
   * written yet" as "fine to publish".
   */
  it("never calls an empty piece ready", () => {
    expect(copyState(slot({ content: null }))).not.toBe("ready");
    expect(copyState(slot({ content: {} }))).not.toBe("ready");
    expect(copyState(slot({ content: { blocks: "nonsense" } }))).not.toBe("ready");
  });
});

describe("publishable", () => {
  const s = slot();

  it("passes a confirmed piece with fresh copy", () => {
    expect(publishable(slot({ status: "confirmed", content: freshCopy(s) }))).toBe(true);
  });

  // The gate is a human decision AND a readiness fact. Either alone is not it.
  it("refuses a confirmed piece whose copy went stale", () => {
    expect(
      publishable(slot({ status: "confirmed", content: freshCopy(s), cta: "Changed." }))
    ).toBe(false);
  });

  it("refuses a confirmed piece with no copy", () => {
    expect(publishable(slot({ status: "confirmed", content: null }))).toBe(false);
  });

  it("refuses anything a human has not confirmed", () => {
    for (const status of ["planned", "drafted", "skipped", "cancelled"]) {
      expect(publishable(slot({ status, content: freshCopy(s) })), status).toBe(false);
    }
  });
});

describe("projectSlot", () => {
  const s = slot();
  const projected = projectSlot(slot({ content: freshCopy(s) }));

  /**
   * The external contract. Renaming any of these breaks somebody else's code
   * silently, so the list is pinned here the way commit.test.ts pins the
   * fields serializeSlot reads.
   */
  it("emits exactly the agreed fields", () => {
    expect(Object.keys(projected).sort()).toEqual(
      [
        "brief",
        "campaign",
        "channel",
        "copy",
        "date",
        "format",
        "format_label",
        "id",
        "publishable",
        "published",
        "scheduled_at",
        "status",
        "theme",
        "time_local",
        "timezone",
        "updated_at",
      ].sort()
    );
  });

  // Planner bookkeeping and calendar-sync state are ours. Exposing them would
  // make them a contract we could never change.
  it("leaks no internal state", () => {
    const json = JSON.stringify(projected);
    expect(json).not.toContain("plan_run_id");
    expect(json).not.toContain("gap_id");
    expect(json).not.toContain("google");
    expect(json).not.toContain("week_key");
    expect(json).not.toContain("needs_theme");
    expect(json).not.toContain("sourceHash");
  });

  /**
   * `note` is production direction — "shot: whiteboard" — and copy.ts says it
   * is never published. An agent that pasted it would put stage directions on
   * a client's feed.
   */
  it("strips production notes from every block", () => {
    expect(JSON.stringify(projected.copy.blocks)).not.toContain("whiteboard");
    for (const block of projected.copy.blocks) {
      expect(block).not.toHaveProperty("note");
    }
  });

  it("keeps on-screen text, which is published words", () => {
    expect(projected.copy.blocks[1].on_screen).toBe("€4,000");
  });

  it("carries the brief so a piece with no copy is still workable", () => {
    expect(projected.brief.hook).toBe("Nobody diarises the deadline.");
    expect(projected.brief.body).toEqual(["Name the date.", "What it costs."]);
  });

  it("names who wrote the copy", () => {
    expect(projected.copy.authored_by).toBe("agent");
    const byHand = projectSlot(slot({ content: freshCopy(s, { model: null }) }));
    expect(byHand.copy.authored_by).toBe("human");
    expect(projectSlot(slot()).copy.authored_by).toBeNull();
  });

  // A slot the planner could not theme carries "Theme not set" nowhere useful;
  // an empty string is honest and an agent can test for it.
  it("blanks a theme the planner never set", () => {
    expect(projectSlot(slot({ needs_theme: true, theme: "junk" })).theme).toBe("");
  });

  it("passes an unrecognised status through rather than coercing it", () => {
    expect(projectSlot(slot({ status: "something_else" })).status).toBe("something_else");
  });

  it("reports a publication once one exists", () => {
    const published = projectSlot(
      slot({
        publication: {
          external_id: "urn:li:share:7241",
          external_url: "https://linkedin.com/feed/update/7241",
          published_at: "2026-09-16T07:31:04.000Z",
          reported_at: "2026-09-16T07:31:10.000Z",
          idempotency_key: "slot_s1:1",
          key_prefix: "mk_live_7fQ2",
        },
      })
    );
    expect(published.published?.external_url).toBe(
      "https://linkedin.com/feed/update/7241"
    );
    // The idempotency key and the key prefix are ours, not the caller's.
    expect(JSON.stringify(published.published)).not.toContain("mk_live");
    expect(JSON.stringify(published.published)).not.toContain("idempotency");
  });

  it("carries no campaign rather than an empty one", () => {
    expect(projectSlot(slot({ campaign_id: null })).campaign).toBeNull();
  });
});

describe("safeLogoUrl", () => {
  it("accepts http and https", () => {
    expect(safeLogoUrl("https://cdn.example/logo.png")).toBe(
      "https://cdn.example/logo.png"
    );
    expect(safeLogoUrl("http://cdn.example/logo.png")).toBe("http://cdn.example/logo.png");
  });

  /**
   * logo_url is hand-typed and nothing validates it, and GET /logo answers a
   * 302 with whatever it holds. Without this guard anyone who can edit a
   * client turns our domain into an open redirect.
   */
  it("refuses a scheme that is not http", () => {
    expect(safeLogoUrl("javascript:alert(1)")).toBeNull();
    expect(safeLogoUrl("data:image/png;base64,iVBORw0KG")).toBeNull();
    expect(safeLogoUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses anything that is not an absolute URL", () => {
    expect(safeLogoUrl("/logo.png")).toBeNull();
    expect(safeLogoUrl("cdn.example/logo.png")).toBeNull();
    expect(safeLogoUrl("")).toBeNull();
    expect(safeLogoUrl("   ")).toBeNull();
    expect(safeLogoUrl(null)).toBeNull();
    expect(safeLogoUrl(42)).toBeNull();
  });
});

describe("projectBranding", () => {
  it("keeps the fields it promises", () => {
    const b = projectBranding({
      colors: { primary: "#0d9488", accent: "#fff" },
      fonts: { headline: "Plus Jakarta Sans" },
      visual_style: "clean",
      dos: "be specific",
    });
    expect(b.colors?.primary).toBe("#0d9488");
    expect(b.fonts?.headline).toBe("Plus Jakarta Sans");
    expect(b.visual_style).toBe("clean");
    expect(b.dos).toBe("be specific");
  });

  /**
   * branding is stored unvalidated — parseClientPatch only checks it is an
   * object. Passing it through would promise a shape we never enforce.
   */
  it("drops anything it was not asked to carry", () => {
    const b = projectBranding({
      colors: { primary: "#000", evil: "<script>" },
      internal_note: "do not ship",
      dos: "keep",
    });
    expect(JSON.stringify(b)).not.toContain("evil");
    expect(JSON.stringify(b)).not.toContain("internal_note");
    expect(b.dos).toBe("keep");
  });

  it("renders junk as an empty shape rather than throwing", () => {
    expect(() => projectBranding(null)).not.toThrow();
    expect(() => projectBranding("nonsense")).not.toThrow();
    expect(projectBranding({ colors: "not an object" }).colors?.primary).toBeUndefined();
  });
});

describe("paging", () => {
  const items = [
    { id: "a", date: "2026-09-16", time_local: "09:00" },
    { id: "b", date: "2026-09-16", time_local: "09:00" },
    { id: "c", date: "2026-09-17", time_local: "10:00" },
  ];

  // Two pieces can share a day and a time; without the id the order between
  // them is arbitrary and a cursor skips or repeats one.
  it("orders totally, with the id as the tiebreaker", () => {
    expect(sortKeyOf(items[0]) < sortKeyOf(items[1])).toBe(true);
    expect(sortKeyOf(items[1]) < sortKeyOf(items[2])).toBe(true);
  });

  it("sorts undated pieces ahead of dated ones", () => {
    expect(sortKeyOf({ id: "z", date: null, time_local: null }) < sortKeyOf(items[0])).toBe(
      true
    );
  });

  it("pages through without repeating or skipping", () => {
    const first = paginate(items, null, 2);
    expect(first.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();

    const second = paginate(items, decodeCursor(first.nextCursor), 2);
    expect(second.items.map((i) => i.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns no cursor when everything fits", () => {
    expect(paginate(items, null, 10).nextCursor).toBeNull();
  });

  it("survives a cursor from nowhere", () => {
    expect(paginate(items, "zzzz", 10).items).toEqual([]);
    expect(decodeCursor("!!!not base64!!!")).not.toBe("");
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("round-trips a cursor", () => {
    const key = sortKeyOf(items[0]);
    expect(decodeCursor(encodeCursor(key))).toBe(key);
  });
});

describe("clampLimit", () => {
  it("defaults when absent or unreadable", () => {
    expect(clampLimit(null)).toBe(DEFAULT_LIMIT);
    expect(clampLimit("")).toBe(DEFAULT_LIMIT);
    expect(clampLimit("abc")).toBe(DEFAULT_LIMIT);
    expect(clampLimit("0")).toBe(DEFAULT_LIMIT);
    expect(clampLimit("-5")).toBe(DEFAULT_LIMIT);
  });

  // Clamped rather than rejected, as the planner clamps model output: a caller
  // asking for too much gets the most we will give, not an error.
  it("clamps rather than refusing", () => {
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit("100000")).toBe(MAX_LIMIT);
    expect(clampLimit("10.9")).toBe(10);
  });
});
