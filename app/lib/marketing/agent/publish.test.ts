import { describe, it, expect } from "vitest";
import { sourceHash } from "../copy";
import { parsePublishBody, parseFailedBody, publishDecision } from "./publish";
import type { Publication, Slot } from "../../types";

/**
 * Every rule here has the same consequence when it is wrong: a post goes out
 * twice, or a post that went out is never recorded. Neither shows up in the
 * app — the first is visible only on the client's feed, the second only as a
 * piece that sits on "confirmed" forever while the world has already seen it.
 */

const NOW = new Date("2026-09-16T08:00:00.000Z");

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
    type: "post",
    channel: "linkedin",
    theme: "Why quarterly planning breaks",
    brief: "Open with the deadline.",
    rationale: "Pillar: process",
    hook: "Nobody diarises it.",
    body: ["Name the date."],
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
  const merged = { ...base, ...over };
  // Copy written from whatever brief the test ended up with, unless the test
  // set content itself — so "ready" is the default and staleness is opt-in.
  if (over.content === undefined) {
    merged.content = {
      headline: null,
      blocks: [{ label: "Post", text: "The deadline nobody tracks." }],
      caption: null,
      hashtags: [],
      sourceHash: sourceHash(merged),
      generatedAt: "2026-09-10T09:00:00.000Z",
      model: "gpt-5.5",
      editedAt: null,
    };
  }
  return merged;
}

const REPORT = {
  externalId: "urn:li:share:7241",
  externalUrl: "https://linkedin.com/feed/update/7241",
  publishedAt: "2026-09-16T07:31:04.000Z",
  idempotencyKey: "slot_s1:attempt_1",
};

function published(over: Partial<Publication> = {}): Publication {
  return {
    external_id: "urn:li:share:7241",
    external_url: "https://linkedin.com/feed/update/7241",
    published_at: "2026-09-16T07:31:04.000Z",
    reported_at: "2026-09-16T07:31:10.000Z",
    idempotency_key: "slot_s1:attempt_1",
    key_prefix: "mk_live_7fQ2",
    ...over,
  };
}

describe("parsePublishBody", () => {
  function ok(raw: Record<string, unknown>) {
    const parsed = parsePublishBody(raw, NOW);
    if ("error" in parsed) throw new Error(`expected a value, got: ${parsed.error}`);
    return parsed.value;
  }
  function err(raw: Record<string, unknown>) {
    const parsed = parsePublishBody(raw, NOW);
    if (!("error" in parsed)) throw new Error("expected an error");
    return parsed.error;
  }

  it("reads a complete report", () => {
    expect(
      ok({
        external_id: "urn:li:share:7241",
        external_url: "https://linkedin.com/feed/update/7241",
        published_at: "2026-09-16T07:31:04.000Z",
        idempotency_key: "slot_s1:attempt_1",
      })
    ).toEqual(REPORT);
  });

  it("requires the platform's id", () => {
    expect(err({ idempotency_key: "k" })).toMatch(/external_id/);
    expect(err({ external_id: "   ", idempotency_key: "k" })).toMatch(/external_id/);
  });

  // Without it, a retried queue message is indistinguishable from a second
  // publish, and the 409 that should protect the client never fires.
  it("requires an idempotency key", () => {
    expect(err({ external_id: "x" })).toMatch(/idempotency_key/);
  });

  it("refuses absurdly long fields", () => {
    expect(err({ external_id: "x".repeat(300), idempotency_key: "k" })).toMatch(/256/);
    expect(err({ external_id: "x", idempotency_key: "k".repeat(300) })).toMatch(/256/);
  });

  it("defaults the time to now when the platform gave none", () => {
    expect(ok({ external_id: "x", idempotency_key: "k" }).publishedAt).toBe(
      NOW.toISOString()
    );
  });

  it("refuses a time it cannot read", () => {
    expect(
      err({ external_id: "x", idempotency_key: "k", published_at: "last tuesday" })
    ).toMatch(/ISO-8601/);
  });

  /**
   * The mistake this really catches: a unix-millis integer sent as a string,
   * which Date.parse happily turns into a date tens of thousands of years out
   * and which would then sort above every real piece forever.
   */
  it("refuses a time far in the future", () => {
    expect(
      err({ external_id: "x", idempotency_key: "k", published_at: "2099-01-01T00:00:00Z" })
    ).toMatch(/future/);
  });

  it("allows a little clock skew", () => {
    const soon = new Date(NOW.getTime() + 60_000).toISOString();
    expect(ok({ external_id: "x", idempotency_key: "k", published_at: soon }).publishedAt).toBe(
      soon
    );
  });

  it("accepts a past time, which is the normal case", () => {
    expect(
      ok({ external_id: "x", idempotency_key: "k", published_at: "2026-09-16T07:00:00.000Z" })
        .publishedAt
    ).toBe("2026-09-16T07:00:00.000Z");
  });

  it("treats the url as optional but refuses a bad one", () => {
    expect(ok({ external_id: "x", idempotency_key: "k" }).externalUrl).toBeNull();
    expect(
      err({ external_id: "x", idempotency_key: "k", external_url: "javascript:alert(1)" })
    ).toMatch(/http/);
    expect(
      err({ external_id: "x", idempotency_key: "k", external_url: "not a url" })
    ).toMatch(/http/);
  });

  it("refuses a body of the wrong types rather than throwing", () => {
    expect(() => parsePublishBody({ external_id: 42, idempotency_key: null }, NOW)).not.toThrow();
    expect(err({ external_id: 42, idempotency_key: null })).toMatch(/external_id/);
  });
});

describe("parseFailedBody", () => {
  it("requires a reason", () => {
    const parsed = parseFailedBody({});
    expect("error" in parsed && parsed.error).toMatch(/reason/);
  });

  it("truncates rather than refusing a long one", () => {
    const parsed = parseFailedBody({ reason: "x".repeat(5000) });
    expect("value" in parsed && parsed.value.length).toBe(1000);
  });
});

describe("publishDecision", () => {
  it("writes the first report for a released piece", () => {
    expect(publishDecision(slot(), REPORT)).toEqual({ action: "write" });
  });

  /**
   * The case the whole design exists for. The agent's HTTP client timed out,
   * retried, and must see the same answer — not a second post.
   */
  it("replays an identical retry", () => {
    const decision = publishDecision(slot({ status: "posted", publication: published() }), REPORT);
    expect(decision.action).toBe("replay");
    expect(decision).toHaveProperty("publication.external_id", "urn:li:share:7241");
  });

  it("answers the replay with what is stored, not what arrived", () => {
    const stored = published({ external_id: "urn:li:share:ORIGINAL" });
    const decision = publishDecision(slot({ status: "posted", publication: stored }), {
      ...REPORT,
      externalId: "urn:li:share:DIFFERENT",
    });
    expect(decision.action).toBe("replay");
    expect(decision).toHaveProperty("publication.external_id", "urn:li:share:ORIGINAL");
  });

  it("refuses a second, different publish", () => {
    const decision = publishDecision(slot({ status: "posted", publication: published() }), {
      ...REPORT,
      idempotencyKey: "slot_s1:attempt_2",
    });
    expect(decision.action).toBe("conflict");
    expect(decision).toHaveProperty("publication.external_url");
  });

  /**
   * A published slot has status "posted", which is not publishable. Asking the
   * gate before the publication check would turn every legitimate retry into a
   * rejection — the exact opposite of what idempotency is for.
   */
  it("checks the publication before the gate", () => {
    const decision = publishDecision(
      slot({ status: "posted", content: null, publication: published() }),
      REPORT
    );
    expect(decision.action).toBe("replay");
  });

  it("rejects a piece a human never released", () => {
    for (const status of ["planned", "drafted", "skipped", "cancelled"]) {
      expect(publishDecision(slot({ status }), REPORT).action, status).toBe("reject");
    }
  });

  it("rejects a released piece with no copy", () => {
    expect(publishDecision(slot({ content: null }), REPORT).action).toBe("reject");
  });

  /**
   * Somebody confirms a piece, then fixes a typo in the hook. The copy is now
   * written from a brief that no longer exists, and nothing demotes the status.
   * Publishing it would put the old thinking on a client's feed.
   */
  it("rejects a released piece whose copy went stale", () => {
    const s = slot();
    expect(publishDecision({ ...s, hook: "A different opening." }, REPORT).action).toBe(
      "reject"
    );
  });
});
