// Posting windows, extracted from the SYSTEM_PROMPT at
// app/services/pipeline/steps/schedule_suggest.py:38-43.
//
// These were instructions to an LLM. They are constants. Paying tokens for a
// model to reproduce a fixed table -- non-deterministically, and with no way to
// unit-test the result -- is strictly worse than a lookup. The LLM keeps the
// judgment calls (which campaign, what theme, which channel fits); code owns
// every date and time decision.
//
// Weekdays use luxon's convention: 1 = Monday ... 7 = Sunday.

export const CHANNELS = ["linkedin", "instagram", "twitter", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface PostingWindow {
  /** ISO weekdays this channel should post on, in preference order. */
  weekdays: number[];
  /** Preferred local start times, "HH:mm", in preference order. */
  times: string[];
  label: string;
}

export const POSTING_WINDOWS: Record<Channel, PostingWindow> = {
  // "LinkedIn: Tue-Thu 8-11am local"
  linkedin: {
    weekdays: [2, 3, 4],
    times: ["09:00", "08:00", "10:00"],
    label: "Tue-Thu, 8-11am",
  },
  // "Instagram: daily 10am-2pm or 7-9pm local"
  instagram: {
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ["11:00", "13:00", "19:30"],
    label: "Daily, 10am-2pm or 7-9pm",
  },
  // "Twitter/X: weekdays 9am or 5pm local"
  twitter: {
    weekdays: [1, 2, 3, 4, 5],
    times: ["09:00", "17:00"],
    label: "Weekdays, 9am or 5pm",
  },
  // Not in the original prompt; standard B2B newsletter timing.
  email: {
    weekdays: [2, 3, 4],
    times: ["09:30", "10:30"],
    label: "Tue-Thu, 9-11am",
  },
};

/** Fallback for an unrecognised channel: the prompt's "mid-morning or early-afternoon". */
export const DEFAULT_WINDOW: PostingWindow = {
  weekdays: [1, 2, 3, 4, 5],
  times: ["10:00", "13:00"],
  label: "Weekdays, mid-morning",
};

export function windowFor(channel: string): PostingWindow {
  return POSTING_WINDOWS[channel as Channel] ?? DEFAULT_WINDOW;
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

/** Cap per calendar day across all channels and types, so a weekly quota cannot stack on one day. */
export const MAX_SLOTS_PER_DAY = 2;

/** Minimum spacing between two slots on the same channel on the same day. */
export const MIN_GAP_MINUTES = 120;

/**
 * What each platform will actually accept.
 *
 * New in Phase 6, and the same argument as the posting windows above: these are
 * facts about the platforms, not judgement calls, so a language model should
 * not be asked to remember them. The MAX_* caps in planner/types.ts are a
 * different thing entirely — those defend the 1 MiB Firestore document limit
 * and are explicitly justified that way. These are the real limits a piece has
 * to clear before it can be posted, and they are reported, never enforced:
 * truncating a tweet at 280 mid-word produces something silently wrong that
 * then gets pasted.
 *
 * `body` is measured against the caption where the format has one, and against
 * the blocks joined otherwise — which is right for both a carousel (the caption
 * is the box you paste into) and a post (the blocks ARE the post), with no
 * per-format branch. `perBlock` is what a thread needs.
 */
export interface PlatformLimits {
  body: number | null;
  perBlock: number | null;
}

export const PLATFORM_LIMITS: Record<Channel, PlatformLimits> = {
  // 280 is a rejection, not a style note.
  twitter: { body: 280, perBlock: 280 },
  linkedin: { body: 3000, perBlock: null },
  instagram: { body: 2200, perBlock: null },
  // Subject lines get truncated by the client, but there is no ceiling worth
  // failing a draft over.
  email: { body: null, perBlock: null },
};

export function limitsFor(channel: string): PlatformLimits {
  return PLATFORM_LIMITS[channel as Channel] ?? { body: null, perBlock: null };
}
