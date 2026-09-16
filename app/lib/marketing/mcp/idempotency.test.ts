import { describe, it, expect } from "vitest";
import { derivedKey, idempotencyKeyFor } from "./idempotency";

/**
 * The failure this prevents is nasty because the system behaves correctly
 * throughout: a model publishes once, loses the thread, reports again with a
 * fresh key, and gets 409 already_published. The post exists, the report is
 * truthful, and there is nothing the model can do to record it.
 */

describe("derivedKey", () => {
  it("is stable for the same piece and post", () => {
    expect(derivedKey("s1", "urn:li:share:7241")).toBe(derivedKey("s1", "urn:li:share:7241"));
  });

  // Two different pieces that somehow carried the same platform id must not
  // collide, or publishing the second would silently replay the first.
  it("differs across pieces", () => {
    expect(derivedKey("s1", "x")).not.toBe(derivedKey("s2", "x"));
  });

  /**
   * The case the conflict exists for: the same piece genuinely posted twice,
   * producing two platform ids. That must still reach 409 rather than replay.
   */
  it("differs across posts", () => {
    expect(derivedKey("s1", "post-a")).not.toBe(derivedKey("s1", "post-b"));
  });

  // The separator matters: without one, ("ab","c") and ("a","bc") would hash
  // to the same value.
  it("does not confuse a boundary between the two", () => {
    expect(derivedKey("ab", "c")).not.toBe(derivedKey("a", "bc"));
  });

  it("is a short hex string, not the raw inputs", () => {
    const key = derivedKey("s1", "urn:li:share:7241");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("s1");
  });
});

describe("idempotencyKeyFor", () => {
  it("derives one when the caller gave none", () => {
    expect(idempotencyKeyFor("s1", "x")).toBe(derivedKey("s1", "x"));
    expect(idempotencyKeyFor("s1", "x", null)).toBe(derivedKey("s1", "x"));
    expect(idempotencyKeyFor("s1", "x", "")).toBe(derivedKey("s1", "x"));
    expect(idempotencyKeyFor("s1", "x", "   ")).toBe(derivedKey("s1", "x"));
  });

  /**
   * A queue that tracks its own redeliveries knows more than we can infer, and
   * overriding it would break the REST contract where the message id is the
   * whole point.
   */
  it("prefers a supplied key over the derived one", () => {
    expect(idempotencyKeyFor("s1", "x", "queue-message-42")).toBe("queue-message-42");
  });

  it("trims a supplied key", () => {
    expect(idempotencyKeyFor("s1", "x", "  k  ")).toBe("k");
  });

  // The whole point, stated as one assertion: two identical reports agree
  // without having coordinated.
  it("makes two identical reports agree without coordination", () => {
    const first = idempotencyKeyFor("s1", "urn:li:share:7241");
    const retryMinutesLater = idempotencyKeyFor("s1", "urn:li:share:7241");
    expect(retryMinutesLater).toBe(first);
  });
});
