/**
 * One status vocabulary for the whole app.
 *
 * Six near-identical colour maps used to live in six files and quietly
 * disagreed: yellow and amber both meant "warning", green appeared at three
 * different shade pairs, and the same word was styled differently depending on
 * which page you were looking at. These are the only definitions now.
 *
 * Shades follow Numerico's `100/700` pill idiom, including its universal
 * `bg-slate-100 text-slate-500` fallback for anything unrecognised.
 */

const NEUTRAL = "bg-slate-100 text-slate-500";

const STATUS_COLORS: Record<string, string> = {
  // Good — the thing happened, or is live.
  active: "bg-green-100 text-green-700",
  completed: "bg-green-100 text-green-700",
  accepted: "bg-green-100 text-green-700",

  // In flight.
  running: "bg-blue-100 text-blue-700",
  proposal: "bg-blue-100 text-blue-700",
  proposed: "bg-blue-100 text-blue-700",

  // Needs attention, but not broken. Amber is deliberately not the accent:
  // "degraded" is the planner's most common state when the model is
  // unreachable, and it must not read as a brand colour.
  paused: "bg-amber-100 text-amber-700",
  in_review: "bg-amber-100 text-amber-700",
  degraded: "bg-amber-100 text-amber-700",

  // Bad.
  failed: "bg-red-100 text-red-600",
  rejected: "bg-red-100 text-red-600",

  // Written to the calendar — the accent, because it is this app's success
  // state rather than a generic one.
  committed: "bg-teal-100 text-teal-700",

  // Inert.
  idea: NEUTRAL,
  draft: NEUTRAL,
  noop: NEUTRAL,
  archived: NEUTRAL,
};

/** Distinct hues per channel, restated in the same 100/700 idiom. */
const CHANNEL_COLORS: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-700",
  instagram: "bg-pink-100 text-pink-700",
  twitter: "bg-sky-100 text-sky-700",
  email: "bg-violet-100 text-violet-700",
};

/** The pill shape. Numerico uses rounded-full for anything customer-facing. */
export const PILL = "inline-flex items-center text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap";

/** A smaller pill, for dense rows and card corners. */
export const PILL_SM = "inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap uppercase tracking-wide";

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? NEUTRAL;
}

export function channelColor(channel: string): string {
  return CHANNEL_COLORS[channel] ?? NEUTRAL;
}

/** Full class string for a status pill. */
export function statusPill(status: string, small = false): string {
  return `${small ? PILL_SM : PILL} ${statusColor(status)}`;
}

/** Full class string for a channel pill. */
export function channelPill(channel: string, small = false): string {
  return `${small ? PILL_SM : PILL} ${channelColor(channel)}`;
}

/** `in_review` reads badly in a UI. */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
