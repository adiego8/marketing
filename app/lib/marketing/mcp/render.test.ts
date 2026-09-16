import { describe, it, expect } from "vitest";
import { renderSlot, renderSlotList, renderBrand, renderClients } from "./render";
import type { AgentSlot } from "../../types";

/**
 * What the model actually reads. Two things are worth pinning:
 *
 *  - a piece that is not safe to publish must SAY so, in the first few lines,
 *    in words rather than a flag the model has to interpret;
 *  - production notes must never appear. The projection strips them, and this
 *    renders from the projection, so a note reaching the page would mean both
 *    layers failed — which is exactly why it is asserted twice.
 */

function slot(over: Partial<AgentSlot> = {}): AgentSlot {
  const base: AgentSlot = {
    id: "s1",
    date: "2026-09-16",
    time_local: "09:30",
    timezone: "Europe/Madrid",
    scheduled_at: "2026-09-16T07:30:00.000Z",
    channel: "linkedin",
    format: "carousel",
    format_label: "Carousel",
    status: "confirmed",
    publishable: true,
    campaign: { id: "camp1", title: "Q4 pipeline" },
    theme: "Why quarterly planning breaks",
    brief: {
      one_line: "Open with the deadline nobody tracks.",
      hook: "Nobody diarises the deadline.",
      body: ["Name the date.", "What it costs."],
      cta: "Book the check.",
      rationale: "Pillar: process",
    },
    copy: {
      state: "ready",
      headline: null,
      blocks: [
        { label: "Slide 1", text: "The deadline nobody tracks.", on_screen: null },
        { label: "Slide 2", text: "What it costs you.", on_screen: "€4,000" },
      ],
      caption: "The box you paste into.",
      hashtags: ["#tax"],
      authored_by: "agent",
      generated_at: "2026-09-10T09:00:00.000Z",
      edited_at: null,
    },
    published: null,
    updated_at: "2026-09-14T11:02:44.019Z",
  };
  return { ...base, ...over };
}

describe("renderSlot", () => {
  it("leads with what it is and when", () => {
    const out = renderSlot(slot());
    expect(out).toContain("Carousel · linkedin");
    expect(out).toContain("2026-09-16");
    expect(out).toContain("Europe/Madrid");
  });

  // The model should not have to infer readiness from three separate fields.
  it("says READY in words when it is", () => {
    expect(renderSlot(slot())).toContain("READY");
  });

  it("says why it is not ready, specifically", () => {
    expect(renderSlot(slot({ publishable: false, copy: { ...slot().copy, state: "missing" } })))
      .toContain("no copy has been written yet");
    expect(renderSlot(slot({ publishable: false, copy: { ...slot().copy, state: "stale" } })))
      .toContain("the brief changed after the copy was written");
    expect(renderSlot(slot({ publishable: false, status: "planned" })))
      .toContain("a human has not released it");
  });

  it("renders the copy a publisher would paste", () => {
    const out = renderSlot(slot());
    expect(out).toContain("Slide 1: The deadline nobody tracks.");
    expect(out).toContain("on screen: €4,000");
    expect(out).toContain("Caption: The box you paste into.");
    expect(out).toContain("#tax");
  });

  /**
   * Production direction is for whoever films it. The projection already
   * stripped it; this asserts the renderer cannot reintroduce it, since it
   * never sees a shape that carries one.
   */
  it("cannot emit a production note", () => {
    const withNote = slot();
    // @ts-expect-error — proving the projected shape has nowhere to put one.
    withNote.copy.blocks[0].note = "shot: cut to the whiteboard";
    expect(renderSlot(withNote)).not.toContain("whiteboard");
  });

  // Fresh copy says the same thing in finished words; printing both is noise.
  it("omits the brief when the copy is fresh", () => {
    expect(renderSlot(slot())).not.toContain("BRIEF");
  });

  // Stale copy is exactly when the mismatch is the point.
  it("shows the brief alongside stale copy", () => {
    const out = renderSlot(slot({ copy: { ...slot().copy, state: "stale" } }));
    expect(out).toContain("BRIEF");
    expect(out).toContain("Nobody diarises the deadline.");
  });

  it("shows the brief when there is no copy at all", () => {
    const out = renderSlot(slot({ copy: { ...slot().copy, state: "missing", blocks: [] } }));
    expect(out).toContain("BRIEF");
    expect(out).toContain("1. Name the date.");
  });

  it("warns loudly when it has already gone out", () => {
    const out = renderSlot(
      slot({
        published: {
          external_id: "urn:li:share:7241",
          external_url: "https://linkedin.com/feed/update/7241",
          published_at: "2026-09-16T07:31:04.000Z",
        },
      })
    );
    expect(out).toContain("ALREADY PUBLISHED");
    expect(out).toContain("https://linkedin.com/feed/update/7241");
  });

  it("carries the platform warnings it was given", () => {
    expect(renderSlot(slot(), ["Caption is 240 characters over the limit"])).toContain(
      "240 characters over"
    );
  });

  // The model needs it to call get_content or report_published afterwards.
  it("always states the id", () => {
    expect(renderSlot(slot())).toContain("id: s1");
  });

  it("renders an unscheduled piece without inventing a date", () => {
    const out = renderSlot(slot({ date: null, time_local: null }));
    expect(out).toContain("Not scheduled");
    expect(out).not.toContain("null");
  });
});

describe("renderSlotList", () => {
  const range = { from: "2026-09-14", to: "2026-09-20", timezone: "Europe/Madrid" };

  it("says plainly when there is nothing", () => {
    const out = renderSlotList(range, []);
    expect(out).toContain("Nothing scheduled");
    expect(out).toContain("2026-09-14");
  });

  // Every date below is client-local. A model that assumes UTC is a day out
  // for half the world, so the header says so before the first piece.
  it("states the timezone the dates are in", () => {
    expect(renderSlotList(range, [slot()])).toContain("Europe/Madrid");
    expect(renderSlotList(range, [slot()])).toContain("local calendar");
  });

  it("counts what it found", () => {
    expect(renderSlotList(range, [slot()])).toContain("1 piece ");
    expect(renderSlotList(range, [slot(), slot({ id: "s2" })])).toContain("2 pieces");
  });

  /**
   * Found against real data: a blank element added to the array for spacing
   * gets the separator applied to it like any other, so the list opened with
   * an empty divided block that read as a piece which had failed to load.
   */
  it("opens with a piece, not an empty block", () => {
    const blocks = renderSlotList(range, [slot(), slot({ id: "s2" })]).split("\n\n---\n\n");
    expect(blocks).toHaveLength(3); // header + two pieces, nothing between
    expect(blocks.every((b) => b.trim().length > 0)).toBe(true);
  });
});

describe("renderBrand", () => {
  const brand = {
    business_name: "Acme",
    voice: { tone: "direct", avoid: ["leverage", "unlock"] },
    positioning: { angle: "the enemy" },
    icp: {},
    messaging: {},
    visual: { colors: { primary: "#0d9488" } },
    lessons: ["Name the trade. Never 'unlock'."],
    logo: { url: "https://cdn.example/logo.png" },
  };

  it("renders nested free-form documents without assuming their shape", () => {
    const out = renderBrand(brand);
    expect(out).toContain("Acme");
    expect(out).toContain("tone: direct");
    expect(out).toContain("leverage; unlock");
    expect(out).toContain("#0d9488");
  });

  it("skips sections that are empty rather than printing headings for nothing", () => {
    const out = renderBrand(brand);
    expect(out).not.toContain("WHO THEY SELL TO");
    expect(out).not.toContain("MESSAGING");
  });

  /**
   * These are rules a human wrote after rejecting real work, so they have to
   * beat whatever the model thinks good copy looks like — and it has to be
   * told that, not left to infer it from a list.
   */
  it("presents the learned rules as overriding", () => {
    expect(renderBrand(brand)).toMatch(/override your instincts/i);
    expect(renderBrand(brand)).toContain("Name the trade.");
  });

  it("renders an empty brand without throwing", () => {
    expect(() =>
      renderBrand({
        business_name: "",
        voice: {},
        positioning: {},
        icp: {},
        messaging: {},
        visual: {},
        lessons: [],
        logo: { url: null },
      })
    ).not.toThrow();
  });
});

describe("renderClients", () => {
  const clients = [
    { id: "c1", name: "Acme", timezone: "Europe/Madrid", status: "active" },
    { id: "c2", name: "Globex", timezone: "UTC", status: "active" },
  ];

  // The model must learn whether client_id is required from its FIRST call,
  // rather than by getting a 400 on its second.
  it("tells an all-clients key that client_id is required", () => {
    const out = renderClients(clients, {
      name: "Desktop",
      scopes: ["schedule:read"],
      reachesAll: true,
    });
    expect(out).toContain("every client in the agency");
    expect(out).toContain("needs a client_id");
    expect(out).toContain("id: c1");
  });

  it("says how many a narrowed key reaches", () => {
    const out = renderClients(clients, {
      name: "Contractor",
      scopes: ["schedule:read"],
      reachesAll: false,
    });
    expect(out).toContain("2 clients");
    expect(out).toContain("needs a client_id");
  });

  it("lets a key with exactly one client omit the id", () => {
    const out = renderClients([clients[0]], {
      name: "Publisher",
      scopes: ["schedule:read"],
      reachesAll: false,
    });
    expect(out).toContain("1 client");
    expect(out).toContain("can omit client_id");
  });

  /**
   * An all-clients key that happens to reach one client today still needs the
   * id, because it will reach two tomorrow without being reconfigured.
   */
  it("still requires the id for an all-clients key with one client", () => {
    const out = renderClients([clients[0]], {
      name: "Desktop",
      scopes: ["schedule:read"],
      reachesAll: true,
    });
    expect(out).toContain("needs a client_id");
  });

  it("says plainly when a key reaches nothing", () => {
    const out = renderClients([], {
      name: "Stale",
      scopes: [],
      reachesAll: false,
    });
    expect(out).toContain("No clients are reachable");
  });
});
