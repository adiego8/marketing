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

/** Default planning horizon. Kept short: a 4-week horizon at 9 slots/week is 36 LLM fills in one response. */
export const DEFAULT_HORIZON_WEEKS = 2;
