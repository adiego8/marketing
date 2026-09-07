import { CHANNELS, type Channel } from "./posting-windows";

// The content formats a weekly quota can schedule.
//
// Quota keys are free-form — normalizeQuotaWeekly accepts any string, and an
// unrecognised one still plans correctly. This table is the vocabulary the UI
// offers and the channel affinity it suggests, not a constraint.
//
// The old list was post / post_alt / hook / cta, which mixed two different
// things: a post is something you publish, a hook and a CTA are parts of one.
// Scheduling "a CTA" for Tuesday 9am does not describe anything a person
// actually does. Publishable formats come first now; the components are kept,
// marked, and shown apart, so existing quotas keep working.

export interface ContentTypeSpec {
  key: string;
  label: string;
  /** Shown in the quota editor, and worth being concrete about. */
  description: string;
  /**
   * Channels this format can actually be published on. Used to preselect
   * channels when a type is added, and to flag a pairing that cannot happen —
   * a reel does not go out by email.
   */
  channels: Channel[];
  /**
   * A piece of a post rather than a post. Kept for quotas that already use
   * these, and for campaign breakdowns that count them as deliverables.
   */
  component?: boolean;
  /**
   * No longer offered. Every piece now carries its own hook and CTA, so
   * scheduling one on its own describes nothing. Existing quota rows keep
   * working and say why.
   */
  retired?: boolean;
}

export const CONTENT_TYPES: ContentTypeSpec[] = [
  {
    key: "post",
    label: "Post",
    description: "Text or single image. The default unit on every channel.",
    channels: ["linkedin", "instagram", "twitter"],
  },
  {
    key: "carousel",
    label: "Carousel",
    description: "Multi-slide. Carries a sequence — steps, myths, a breakdown.",
    channels: ["linkedin", "instagram"],
  },
  {
    key: "reel",
    label: "Reel",
    description: "Short vertical video. Needs a script and a shoot.",
    channels: ["instagram"],
  },
  {
    key: "story",
    label: "Story",
    description: "Vertical, disappears in 24h. Behind-the-scenes and prompts.",
    channels: ["instagram"],
  },
  {
    key: "thread",
    label: "Thread",
    description: "A sequence of posts making one argument.",
    channels: ["twitter"],
  },
  {
    key: "newsletter",
    label: "Newsletter",
    description: "Long-form to the list. Usually the week's best idea, expanded.",
    channels: ["email"],
  },
  {
    key: "post_alt",
    label: "Alt post",
    description: "A second angle on the same theme, for testing.",
    channels: ["linkedin", "instagram", "twitter"],
  },
  {
    key: "hook",
    label: "Hook",
    description: "Now part of every piece — see the hook on any slot.",
    channels: [...CHANNELS],
    component: true,
    retired: true,
  },
  {
    key: "cta",
    label: "CTA",
    description: "Now part of every piece — see the CTA on any slot.",
    channels: [...CHANNELS],
    component: true,
    retired: true,
  },
];

const BY_KEY = new Map(CONTENT_TYPES.map((t) => [t.key, t]));

export const CONTENT_TYPE_KEYS = CONTENT_TYPES.map((t) => t.key);

/** Publishable formats, in the order the quota editor should offer them. */
export const PUBLISHABLE_TYPES = CONTENT_TYPES.filter(
  (t) => !t.component && !t.retired
);
/** Still nameable, never offered. */
export const COMPONENT_TYPES = CONTENT_TYPES.filter(
  (t) => t.component && !t.retired
);

export function isRetiredType(key: string): boolean {
  return BY_KEY.get(key)?.retired === true;
}

export function contentType(key: string): ContentTypeSpec | undefined {
  return BY_KEY.get(key);
}

/** Title for an arbitrary quota key, including one this table has never seen. */
export function contentTypeLabel(key: string): string {
  return (
    BY_KEY.get(key)?.label ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** The channels to preselect when this type is added to a quota. */
export function defaultChannelsFor(key: string): Channel[] {
  return BY_KEY.get(key)?.channels ?? [];
}

/**
 * Channels chosen for this type that the format cannot be published on.
 *
 * A warning, never a block: the table encodes today's platforms, and a client
 * doing something unusual should not be stopped by it.
 */
export function implausibleChannels(key: string, chosen: string[]): string[] {
  const spec = BY_KEY.get(key);
  if (!spec) return [];
  return chosen.filter((c) => !(spec.channels as string[]).includes(c));
}
