import { describe, it, expect } from "vitest";
import {
  slotGoogleReset,
  clientGoogleReset,
  needsGoogleReset,
} from "./google-reset";

/**
 * Two failure directions, both silent.
 *
 * Miss a field and the stale Google state survives a reset — the 404s the reset
 * was meant to cure simply continue, and the write reports success. Spell a
 * field the way it is NOT spelled on disk and the same thing happens, except
 * now there is a plausible-looking key in Firestore that nothing reads. That
 * second one has already happened once in this repo (calendarEventId vs
 * googleEventId), which is why firestore.test.ts exists.
 *
 * So the payloads are pinned against the names serializeSlot actually reads.
 */

/** Every google* field serializeSlot reads off a slot document. */
const GOOGLE_FIELDS_SERIALIZER_READS = [
  "googleEventId",
  "googleSyncStatus",
  "googleSyncError",
  "googleEventTitle",
  "googleEventBodyHash",
  "googleEventLocked",
  "googleAdoptedAt",
] as const;

describe("slotGoogleReset", () => {
  const doc = slotGoogleReset();

  it("clears every Google field serializeSlot reads", () => {
    for (const key of GOOGLE_FIELDS_SERIALIZER_READS) {
      expect(doc, `missing ${key} — the stale value survives the reset`)
        .toHaveProperty(key);
    }
  });

  it("spells the event id the way the rest of the app does", () => {
    // The exact drift firestore.test.ts was written for.
    expect(doc).toHaveProperty("googleEventId");
    expect(doc).not.toHaveProperty("calendarEventId");
  });

  /**
   * The load-bearing one. While googleEventId is set, syncSlots patches that id
   * and only inserts when the patch 404s — so leaving it would send every
   * future sync down the recreate path against a calendar that is gone.
   */
  it("drops the event id", () => {
    expect(doc.googleEventId).toBeNull();
  });

  /**
   * "removed" would claim we deleted the event from Google. We did not — it is
   * still in the old account. We stopped tracking it, which is "pending".
   */
  it("reads as never-synced, not as deleted", () => {
    expect(doc.googleSyncStatus).toBe("pending");
    expect(doc.googleSyncStatus).not.toBe("removed");
  });

  /**
   * The lock says "a human edited THIS event, stop rewriting it". Carried onto
   * a fresh event it would suppress the first title we ever write.
   */
  it("releases the lock", () => {
    expect(doc.googleEventLocked).toBe(false);
  });

  it("clears a previous sync error rather than leaving it to haunt the UI", () => {
    expect(doc.googleSyncError).toBeNull();
  });

  it("touches updatedAt", () => {
    expect(doc).toHaveProperty("updatedAt");
    expect(doc.updatedAt).toBeDefined();
  });
});

describe("clientGoogleReset", () => {
  const doc = clientGoogleReset();

  /**
   * The single switch that turns a permanent 404 back into a working calendar:
   * ensureClientCalendar only creates one when this field is empty.
   */
  it("clears the calendar id", () => {
    expect(doc.googleCalendarId).toBeNull();
  });

  it("clears the synced-at stamp, which described the old calendar", () => {
    expect(doc.googleSyncedAt).toBeNull();
  });
});

describe("needsGoogleReset", () => {
  it("skips a slot that never reached Google", () => {
    expect(needsGoogleReset({})).toBe(false);
    expect(needsGoogleReset({ googleSyncStatus: "pending" })).toBe(false);
    expect(needsGoogleReset({ googleEventId: null, googleEventLocked: false })).toBe(
      false
    );
  });

  it("catches the obvious case", () => {
    expect(needsGoogleReset({ googleEventId: "evt_1" })).toBe(true);
  });

  /**
   * A lock with no event id is reachable: reconcile can lock a slot whose event
   * is later cleared. Left behind, it silently suppresses the title on the
   * client's next calendar.
   */
  it("catches a lock left on its own", () => {
    expect(needsGoogleReset({ googleEventLocked: true })).toBe(true);
  });

  it("catches the fingerprint fields reconcile compares against", () => {
    expect(needsGoogleReset({ googleEventTitle: "Old title" })).toBe(true);
    expect(needsGoogleReset({ googleEventBodyHash: "abc123" })).toBe(true);
  });

  it("catches an adopted-at stamp and a stale error", () => {
    expect(needsGoogleReset({ googleAdoptedAt: "2026-09-01T00:00:00Z" })).toBe(true);
    expect(needsGoogleReset({ googleSyncError: "Not Found" })).toBe(true);
  });

  it("catches any sync status other than the never-synced default", () => {
    for (const status of ["synced", "stale", "locked", "removed", "error"]) {
      expect(needsGoogleReset({ googleSyncStatus: status }), status).toBe(true);
    }
  });
});
