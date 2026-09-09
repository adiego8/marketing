import { describe, expect, it } from "vitest";
import { mintSlotId, slotId, slugSegment } from "./slot-id";

describe("slugSegment", () => {
  it("makes a free-form type key safe as a document id", () => {
    expect(slugSegment("Post / Alt")).toBe("post-alt");
  });

  it("never returns empty, which Firestore would reject", () => {
    expect(slugSegment("///")).toBe("x");
  });
});

describe("slotId", () => {
  // The property the old (date, channel) id could not have: the same demand
  // produces the same id on every run, so committing a piece twice fails on
  // create() instead of doubling a campaign's delivery.
  it("is stable across runs for the same campaign and type", () => {
    expect(slotId("cli", "camp1", "post", 0)).toBe(slotId("cli", "camp1", "post", 0));
  });

  it("separates campaigns, types and positions", () => {
    const ids = new Set([
      slotId("cli", "camp1", "post", 0),
      slotId("cli", "camp2", "post", 0),
      slotId("cli", "camp1", "reel", 0),
      slotId("cli", "camp1", "post", 1),
    ]);
    expect(ids.size).toBe(4);
  });
});

describe("mintSlotId", () => {
  it("advances past ids already taken by delivered pieces", () => {
    const taken = new Set([slotId("cli", "camp1", "post", 0)]);
    expect(mintSlotId(taken, "cli", "camp1", "post")).toBe(slotId("cli", "camp1", "post", 1));
  });

  it("keeps advancing within one run", () => {
    const taken = new Set<string>();
    const a = mintSlotId(taken, "cli", "camp1", "post");
    const b = mintSlotId(taken, "cli", "camp1", "post");
    expect(a).not.toBe(b);
  });

  it("does not collide across campaigns", () => {
    const taken = new Set<string>();
    const a = mintSlotId(taken, "cli", "camp1", "post");
    const b = mintSlotId(taken, "cli", "camp2", "post");
    expect(a).not.toBe(b);
    expect(a.endsWith("__0")).toBe(true);
    expect(b.endsWith("__0")).toBe(true);
  });
});
