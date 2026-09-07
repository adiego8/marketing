import { describe, it, expect } from "vitest";
import {
  classify,
  scheduleFromEvent,
  plannerWarnings,
  describeChange,
  deterministicEventId,
  hashBody,
  normalizeDescription,
  type RemoteEvent,
} from "./reconcile";
import { toUtcInstant } from "./planner/weeks";
import type { Slot } from "../types";

// Two of the three reconciliation rules destroy something — a cancelled slot
// frees its quota and gets replaced, a locked slot never takes another app
// edit. So most of what is tested here is the refusal to act, not the action.

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: "s1",
    client_id: "c1",
    campaign_id: "cam1",
    campaign_title: "Tax Season",
    plan_run_id: "r1",
    gap_id: "2026-W37::reel",
    date: "2026-09-08",
    time_local: "11:00",
    timezone: "America/New_York",
    scheduled_at: "2026-09-08T15:00:00.000Z",
    week_key: "2026-W37",
    type: "reel",
    channel: "instagram",
    theme: "Three signs your bookkeeping is asking for help",
    brief: "Turn the feeling into signals.",
    rationale: "Pillar: process",
    hook: "Your receipts are not the problem.",
    body: ["Open on the shoebox.", "Name the three signals."],
    cta: "Book a wellness check.",
    needs_theme: false,
    status: "planned",
    source: "agent",
    pinned: false,
    content: null,
    google_event_id: "ev1",
    google_sync_status: "synced",
    google_sync_error: null,
    google_event_title: "Instagram · Reel — Three signs",
    google_event_body_hash: hashBody("THEME\nThree signs"),
    google_event_locked: false,
    google_adopted_at: null,
    last_human_edit_at: null,
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

function remote(overrides: Partial<RemoteEvent> = {}): RemoteEvent {
  return {
    id: "ev1",
    status: "confirmed",
    summary: "Instagram · Reel — Three signs",
    description: "THEME\nThree signs",
    // 11:00 America/New_York on 2026-09-08 is 15:00Z — the slot's own time.
    start: { dateTime: "2026-09-08T11:00:00-04:00" },
    ...overrides,
  };
}

/** What the push pass would write right now, for the render-equality guard. */
function ctx(overrides: Partial<Parameters<typeof classify>[2]> = {}) {
  return {
    renderedTitle: "Instagram · Reel — Three signs",
    renderedBodyHash: hashBody("THEME\nThree signs"),
    recognisedAny: true,
    ...overrides,
  };
}

describe("classify — the guards that stop it destroying things", () => {
  it("does nothing when the listing recognised none of our events", () => {
    // A deleted calendar, a revoked scope or a stale googleCalendarId all make
    // EVERY event absent. Reading that as "deleted" would cancel a client's
    // whole schedule in one click, and cancelling frees the quota, so the next
    // plan run would refill the gaps with different content.
    expect(classify(slot(), undefined, ctx({ recognisedAny: false }))).toEqual({
      kind: "none",
      refreshFingerprint: false,
    });
  });

  it("does not cancel a slot it has never pushed under these rules", () => {
    // Found by dry-running against the real calendar: every event there was a
    // tombstone from deletions made long before reconciliation existed, so the
    // first sync would have cancelled the whole schedule — freeing every gap
    // for the next plan run to refill with different content. A null
    // fingerprint means we were not watching, so we do not get to act.
    const unmanaged = slot({ google_event_title: null, google_event_body_hash: null });
    expect(classify(unmanaged, remote({ status: "cancelled" }), ctx())).toEqual({
      kind: "none",
      refreshFingerprint: true,
    });
    expect(classify(unmanaged, undefined, ctx())).toEqual({
      kind: "none",
      refreshFingerprint: false,
    });
  });

  it("does cancel once a fingerprint proves we pushed it", () => {
    // The guard above costs exactly one sync, not the rule.
    expect(classify(slot(), remote({ status: "cancelled" }), ctx()).kind).toBe("deleted");
    expect(classify(slot(), undefined, ctx()).kind).toBe("missing");
  });

  it("leaves a repeating event completely alone", () => {
    // Pushing start/end to a series master rewrites every occurrence, and with
    // singleEvents:false the master is what comes back under our id.
    const d = classify(
      slot(),
      remote({ recurrence: ["RRULE:FREQ=WEEKLY;COUNT=6"] }),
      ctx()
    );
    expect(d.kind).toBe("recurring");
  });

  it("does not read a recurring event as moved, even when its start differs", () => {
    const d = classify(
      slot(),
      remote({
        recurrence: ["RRULE:FREQ=WEEKLY"],
        start: { dateTime: "2026-09-15T11:00:00-04:00" },
      }),
      ctx()
    );
    expect(d.kind).toBe("recurring");
  });

  it("treats a start that differs only in notation as unchanged", () => {
    // We write ...T11:00:00.000-04:00; Google answers ...T11:00:00-04:00. A
    // string compare would report every slot as moved on the first pass.
    const d = classify(
      slot(),
      remote({ start: { dateTime: "2026-09-08T15:00:00Z" } }),
      ctx()
    );
    expect(d.kind).toBe("none");
  });

  it("does not lock text that matches what we would write right now", () => {
    // events.patch succeeded and the Firestore write recording the fingerprint
    // did not. Without the render comparison this locks the slot forever.
    const d = classify(
      slot({ google_event_title: "an older title" }),
      remote(),
      ctx()
    );
    expect(d).toEqual({ kind: "none", refreshFingerprint: true });
  });

  it("never locks a slot whose fingerprint was never recorded", () => {
    // Every slot synced before this shipped. Falls out of the render guard
    // rather than needing a rule of its own.
    const d = classify(
      slot({ google_event_title: null, google_event_body_hash: null }),
      remote(),
      ctx()
    );
    expect(d).toEqual({ kind: "none", refreshFingerprint: true });
  });
});

describe("classify — detecting a real change", () => {
  it("says nothing changed when the event matches the slot", () => {
    expect(classify(slot(), remote(), ctx())).toEqual({
      kind: "none",
      refreshFingerprint: false,
    });
  });

  it("reports a move, with the schedule in the client's timezone", () => {
    const d = classify(
      slot(),
      remote({ start: { dateTime: "2026-09-10T09:30:00-04:00" } }),
      ctx()
    );
    expect(d.kind).toBe("moved");
    if (d.kind !== "moved") return;
    expect(d.schedule.date).toBe("2026-09-10");
    expect(d.schedule.timeLocal).toBe("09:30");
    expect(d.schedule.weekKey).toBe("2026-W37");
    expect(d.allDay).toBe(false);
  });

  it("resolves a move expressed in someone else's offset into the client's zone", () => {
    // Google returns the offset it stored, which need not be the client's.
    const d = classify(
      slot(),
      remote({ start: { dateTime: "2026-09-10T18:30:00+05:00" } }),
      ctx()
    );
    expect(d.kind).toBe("moved");
    if (d.kind !== "moved") return;
    expect(d.schedule.timeLocal).toBe("09:30"); // 13:30Z -> 09:30 New York
  });

  it("reads a tombstone as deleted", () => {
    expect(classify(slot(), remote({ status: "cancelled" }), ctx()).kind).toBe(
      "deleted"
    );
  });

  it("reads an absent event as missing once something else was recognised", () => {
    expect(classify(slot(), undefined, ctx()).kind).toBe("missing");
  });

  it("locks when the title differs from both the fingerprint and the render", () => {
    const d = classify(slot(), remote({ summary: "Reel — my own title" }), ctx());
    expect(d.kind).toBe("edited");
  });

  it("locks when the body was rewritten", () => {
    const d = classify(slot(), remote({ description: "I rewrote this myself" }), ctx());
    expect(d.kind).toBe("edited");
  });

  it("ignores a whitespace-only difference in the body", () => {
    // Google normalises line endings and trailing space. Without this every
    // slot would lock on the first pass.
    const d = classify(
      slot(),
      remote({ description: "THEME  \r\nThree signs\r\n\r\n" }),
      ctx()
    );
    expect(d.kind).toBe("none");
  });

  it("settles once the lock has recorded what the event says", () => {
    // The lock write stores the REMOTE text as the fingerprint, so the next
    // sync compares equal and stops re-reporting the same edit. It is also
    // what lets "take it back" survive the reconcile pass: the slot is
    // unlocked but no longer diverged, so nothing re-locks it before the push
    // overwrites the event.
    const locked = slot({
      google_event_locked: true,
      google_event_title: "MY OWN TITLE",
      google_event_body_hash: hashBody("my own notes"),
    });
    const theirs = remote({ summary: "MY OWN TITLE", description: "my own notes" });
    expect(classify(locked, theirs, ctx()).kind).toBe("none");
    expect(classify({ ...locked, google_event_locked: false }, theirs, ctx()).kind).toBe(
      "none"
    );
  });

  it("adopts a move on a locked slot without touching the lock", () => {
    // Timing stays ours even when the text is Google's.
    const d = classify(
      slot({ google_event_locked: true }),
      remote({
        summary: "their title",
        start: { dateTime: "2026-09-10T09:30:00-04:00" },
      }),
      ctx()
    );
    expect(d.kind).toBe("moved");
  });

  it("keeps the slot's time when the event is made all-day", () => {
    const d = classify(slot(), remote({ start: { date: "2026-09-15" } }), ctx());
    expect(d.kind).toBe("moved");
    if (d.kind !== "moved") return;
    expect(d.allDay).toBe(true);
    expect(d.schedule.date).toBe("2026-09-15");
    expect(d.schedule.timeLocal).toBe("11:00"); // the slot's own time, kept
  });

  it("does not move a slot for an all-day event on its own date", () => {
    const d = classify(slot(), remote({ start: { date: "2026-09-08" } }), ctx());
    expect(d.kind).toBe("none");
  });
});

describe("scheduleFromEvent", () => {
  it("derives scheduledAt from the same date and time it returns", () => {
    // If these disagree the next push nudges the event by a few seconds, which
    // bumps `updated`, which looks like another edit — forever.
    const out = scheduleFromEvent(
      { dateTime: "2026-09-10T09:30:47-04:00" },
      "America/New_York",
      "11:00"
    );
    expect(out).not.toBeNull();
    expect(out!.schedule.timeLocal).toBe("09:30"); // seconds truncated
    expect(out!.schedule.scheduledAt).toBe(
      toUtcInstant("2026-09-10", "09:30", "America/New_York")!.toISOString()
    );
  });

  it("moves the week key when the local date crosses a boundary", () => {
    const out = scheduleFromEvent(
      { dateTime: "2026-09-14T09:00:00-04:00" },
      "America/New_York",
      "11:00"
    );
    expect(out!.schedule.weekKey).toBe("2026-W38");
  });

  it("always yields a real local time from a timed event", () => {
    // An instant converted into a zone cannot land in a DST gap — 02:30-05:00
    // on the spring-forward day is 07:30Z, which is 03:30 EDT. So the timed
    // branch is always valid, and only the all-day branch below can fail.
    const out = scheduleFromEvent(
      { dateTime: "2026-03-08T02:30:00-05:00" },
      "America/New_York",
      "11:00"
    );
    expect(out!.valid).toBe(true);
    expect(out!.schedule.timeLocal).toBe("03:30");
  });

  it("reports an all-day adoption whose kept time does not exist that day", () => {
    // The one case that can go invalid: the date comes from Google, the time
    // from the slot, and 02:30 never happens in New York on 2026-03-08.
    // Reported rather than blocked — the instant is still recorded.
    const out = scheduleFromEvent({ date: "2026-03-08" }, "America/New_York", "02:30");
    expect(out!.allDay).toBe(true);
    expect(out!.valid).toBe(false);
    expect(out!.schedule.scheduledAt).toBeTruthy();
  });

  it("returns null for a start it cannot parse", () => {
    expect(scheduleFromEvent({}, "America/New_York", "11:00")).toBeNull();
    expect(
      scheduleFromEvent({ dateTime: "not a date" }, "America/New_York", "11:00")
    ).toBeNull();
  });
});

describe("plannerWarnings", () => {
  const schedule = {
    date: "2026-09-09",
    timeLocal: "12:30",
    weekKey: "2026-W37",
    scheduledAt: "2026-09-09T16:30:00.000Z",
  };

  it("says when the day is now over the planner's cap", () => {
    const siblings = [
      slot({ id: "a", date: "2026-09-09", time_local: "08:00", channel: "linkedin" }),
      slot({ id: "b", date: "2026-09-09", time_local: "18:00", channel: "twitter" }),
    ];
    const out = plannerWarnings(slot(), schedule, siblings);
    expect(out.join(" ")).toContain("3 pieces now on 2026-09-09");
  });

  it("says when two pieces on one channel are too close", () => {
    const siblings = [
      slot({ id: "a", date: "2026-09-09", time_local: "13:30", channel: "instagram" }),
    ];
    const out = plannerWarnings(slot(), schedule, siblings);
    expect(out.join(" ")).toContain("60 min from another instagram piece");
  });

  it("ignores a different channel at the same time", () => {
    const siblings = [
      slot({ id: "a", date: "2026-09-09", time_local: "12:30", channel: "twitter" }),
    ];
    expect(plannerWarnings(slot(), schedule, siblings)).toEqual([]);
  });

  it("ignores cancelled neighbours", () => {
    const siblings = [
      slot({ id: "a", date: "2026-09-09", time_local: "12:00", status: "cancelled" }),
      slot({ id: "b", date: "2026-09-09", time_local: "12:15", status: "skipped" }),
    ];
    expect(plannerWarnings(slot(), schedule, siblings)).toEqual([]);
  });

  it("says when a move lands outside the channel's posting days", () => {
    // LinkedIn is Tue-Thu; 2026-09-12 is a Saturday.
    const out = plannerWarnings(
      slot({ channel: "linkedin" }),
      { ...schedule, date: "2026-09-12" },
      []
    );
    expect(out.join(" ")).toContain("outside linkedin's posting days");
  });

  it("stays quiet when the new position is fine", () => {
    expect(plannerWarnings(slot(), schedule, [])).toEqual([]);
  });
});

describe("describeChange", () => {
  it("gives both sides of a move, so it can be undone in Google", () => {
    const line = describeChange(slot(), {
      kind: "moved",
      allDay: false,
      warnings: [],
      schedule: {
        date: "2026-09-15",
        timeLocal: "09:30",
        weekKey: "2026-W38",
        scheduledAt: "2026-09-15T13:30:00.000Z",
      },
    });
    expect(line).toContain("Tue 8 Sep 11:00");
    expect(line).toContain("Tue 15 Sep 09:30");
    expect(line).toContain("Instagram reel");
  });

  it("spells out that a cancel frees the gap", () => {
    // Otherwise the replacement the next plan run proposes looks like a bug.
    const line = describeChange(slot(), { kind: "deleted" });
    expect(line).toContain("quota is free again");
  });

  it("says timing still syncs when the text is handed over", () => {
    expect(describeChange(slot(), { kind: "edited" })).toContain("Timing still syncs");
  });

  it("does not repeat the channel for a legacy type that already names it", () => {
    const line = describeChange(slot({ type: "instagram_reel" }), { kind: "deleted" });
    expect(line).toContain("Instagram reel");
    expect(line).not.toContain("Instagram instagram");
  });

  it("has nothing to say when nothing changed", () => {
    expect(describeChange(slot(), { kind: "none", refreshFingerprint: true })).toBeNull();
  });
});

describe("fingerprints and ids", () => {
  it("hashes the same body to the same value across a line-ending round trip", () => {
    expect(hashBody("a\nb\n")).toBe(hashBody("a  \r\nb\r\n\r\n"));
  });

  it("hashes a real content change differently", () => {
    expect(hashBody("THEME\nOne")).not.toBe(hashBody("THEME\nTwo"));
  });

  it("strips trailing space per line and trims the whole", () => {
    expect(normalizeDescription("a  \r\n b \n\n")).toBe("a\n b");
  });

  it("mints a stable id inside Google's base32hex charset", () => {
    const id = deterministicEventId("c1__2026-09-08__reel__instagram__0");
    expect(id).toBe(deterministicEventId("c1__2026-09-08__reel__instagram__0"));
    expect(id).not.toBe(deterministicEventId("c1__2026-09-08__reel__instagram__1"));
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});
