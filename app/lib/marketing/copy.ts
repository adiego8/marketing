// The finished copy: what actually gets posted.
//
// A slot's theme, hook, beats and cta are a BRIEF — the thinking, done. They
// are not something anyone can paste into Instagram: "slide 2: name the three
// signals" is an instruction to a writer, not words on a slide. This module is
// the shape of the words themselves, and every decision about them. Nothing
// here touches Firestore or the model, for the same reason as reconcile.ts:
// this repo mocks nothing, so logic that reaches for the network never gets a
// test.
//
// ONE SHAPE FOR EVERY FORMAT, and not because a discriminated union would be
// expensive — once copySections() exists it would cost one switch, not one per
// render surface. The reasons that actually hold:
//
//  - The rest of the repo keeps the format vocabulary OPEN. content-types.ts
//    says so outright: quota keys are free-form and "an unrecognised one still
//    plans correctly". A union closes the storage shape over a vocabulary
//    nothing else closes.
//  - This field round-trips through PATCH as user-supplied JSON. Validating one
//    shape at that boundary is a route branch; validating seven is a module.
//
// What the format legitimately decides is the default LABELS, which is a lookup
// rather than a type.

import { createHash } from "node:crypto";
import { clamp, clampList } from "./planner/decide";
import { limitsFor } from "./posting-windows";
import type { Slot } from "../types";

/**
 * One unit of the piece: a slide, a shot, a tweet, or the whole post.
 *
 * `text` and `onScreen` are both PUBLISHED words. `note` is direction and is
 * never published. Keeping those separate is what lets one shape serve a reel,
 * where the voiceover, the on-screen text and the camera direction are three
 * different things — folding the last two together would make `note` mean
 * "visuals" on a reel and nothing at all on a post.
 */
export interface CopyBlock {
  /** "Slide 3", "Shot 2", "Tweet 1". Names the unit for a reader. */
  label: string;
  /** The words this block publishes: spoken, or written. */
  text: string;
  /** Words burned on screen, where they differ from `text`. Reel and story. */
  onScreen?: string;
  /** Production direction — camera, art, framing. Never published. */
  note?: string;
}

export interface SlotCopy {
  /** The line above the piece: an email subject. Null for most formats. */
  headline: string | null;
  /** The piece itself, in order. */
  blocks: CopyBlock[];
  /**
   * The accompanying text, where the piece is not itself text.
   *
   * A carousel, reel or story has one — it is the box you paste into. A post,
   * thread or newsletter does not: there the blocks ARE the words. That
   * distinction is what makes the platform limit computable without a
   * per-format branch; see copyWarnings.
   */
  caption: string | null;
  hashtags: string[];
  /**
   * The brief this was written from. Editing the brief afterwards does not
   * silently delete the copy — it marks it. See isCopyStale.
   */
  sourceHash: string;
  generatedAt: string;
  /** null when a person wrote it by hand rather than the agent. */
  model: string | null;
  editedAt?: string | null;
}

/* ---------------------------------------------------------------- caps --- */

/**
 * Structural caps: what a document can hold, in the spirit of
 * planner/types.ts. Distinct from PLATFORM_LIMITS, which is what a platform
 * will accept. These truncate silently because the model wrote the text; the
 * PATCH route rejects instead, because there a person did.
 *
 * Worst case here is roughly 24 KB against a 1 MiB limit. Copy is written after
 * commit, so plan-run documents — the thing the planner's caps were actually
 * defending — never carry any of it.
 */
export const MAX_COPY_BLOCKS = 12; // a thread runs past the planner's 8 beats
export const MAX_BLOCK_CHARS = 1200;
export const MAX_ONSCREEN_CHARS = 200;
export const MAX_NOTE_CHARS = 300;
export const MAX_LABEL_CHARS = 40;
export const MAX_HEADLINE_CHARS = 200;
/** Above every platform limit, so this never truncates legal copy. */
export const MAX_CAPTION_CHARS = 3000;
export const MAX_HASHTAGS = 30;
export const MAX_HASHTAG_CHARS = 60;

/* ------------------------------------------------------------- formats --- */

const KNOWN_FORMATS = [
  "post",
  "post_alt",
  "carousel",
  "reel",
  "story",
  "thread",
  "newsletter",
] as const;

export type CopyFormat = (typeof KNOWN_FORMATS)[number];

/**
 * The format the prompt's table should be read against.
 *
 * Both planner prompts end with "if a type is not listed, treat it as post",
 * which is a sane fallback and would have made this feature useless in
 * practice. The only client with real data carries these, verified in
 * Firestore:
 *
 *     "instagram carousel"   "instagram reel"
 *     "instagram story"      "instagram CTA post"
 *
 * Space-separated, mixed case, channel-prefixed — a vocabulary that predates
 * the current post/carousel/reel set and appears nowhere in code, because quota
 * and campaign keys are deliberately free-form. Without this, every one of them
 * falls through the fallback and gets written as a plain post. That is not a
 * hypothetical: the first live run produced exactly that.
 *
 * So separators are normalised before the channel prefix is stripped. Anything
 * still unrecognised is a post, which is the honest answer for "CTA post".
 */
export function normalizeFormat(type: string, channel: string): CopyFormat {
  const raw = (type || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const prefix = `${(channel || "").toLowerCase().replace(/[\s-]+/g, "_")}_`;
  const stripped = prefix.length > 1 && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  for (const candidate of [stripped, raw]) {
    if ((KNOWN_FORMATS as readonly string[]).includes(candidate)) {
      return candidate as CopyFormat;
    }
  }
  return "post";
}

interface FormatShape {
  /** Singular name of one block: "slide", "shot", "tweet". */
  unit: string;
  /** Does the piece sit inside an accompanying caption box? */
  hasCaption: boolean;
}

const FORMAT_SHAPES: Record<CopyFormat, FormatShape> = {
  post: { unit: "post", hasCaption: false },
  post_alt: { unit: "post", hasCaption: false },
  carousel: { unit: "slide", hasCaption: true },
  reel: { unit: "shot", hasCaption: true },
  story: { unit: "frame", hasCaption: true },
  thread: { unit: "tweet", hasCaption: false },
  newsletter: { unit: "section", hasCaption: false },
};

export function formatShape(slot: Slot): FormatShape {
  return FORMAT_SHAPES[normalizeFormat(slot.type, slot.channel)];
}

/** What one block is called for this format, 0-indexed. */
export function blockLabelFor(format: CopyFormat, index: number): string {
  if (format === "newsletter") return index === 0 ? "Preheader" : `Section ${index}`;
  const { unit } = FORMAT_SHAPES[format];
  const name = unit.charAt(0).toUpperCase() + unit.slice(1);
  return format === "post" || format === "post_alt" ? name : `${name} ${index + 1}`;
}

/* --------------------------------------------------------------- guard --- */

/**
 * The copy on this slot, or null.
 *
 * `slot.content` is typed Record<string, unknown> | null and serializeSlot
 * passes it through unvalidated, so this is the single narrowing point. It has
 * to be defensive rather than a cast: the field is hand-editable JSON and will
 * eventually hold a shape written by an older version of this file.
 */
export function readCopy(slot: Slot): SlotCopy | null {
  const value = slot.content;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.blocks) || v.blocks.length === 0) return null;
  const blocks = v.blocks.filter(
    (b): b is CopyBlock =>
      !!b &&
      typeof b === "object" &&
      typeof (b as CopyBlock).text === "string" &&
      typeof (b as CopyBlock).label === "string"
  );
  if (blocks.length === 0) return null;

  return {
    headline: typeof v.headline === "string" ? v.headline : null,
    blocks,
    caption: typeof v.caption === "string" ? v.caption : null,
    hashtags: Array.isArray(v.hashtags)
      ? v.hashtags.filter((h): h is string => typeof h === "string")
      : [],
    sourceHash: typeof v.sourceHash === "string" ? v.sourceHash : "",
    generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : "",
    model: typeof v.model === "string" ? v.model : null,
    editedAt: typeof v.editedAt === "string" ? v.editedAt : null,
  };
}

/* ---------------------------------------------------------- staleness --- */

/**
 * A fingerprint of what the copy was written FROM.
 *
 * Theme, hook, beats and cta — not `brief` or `rationale`, which are notes
 * about the piece rather than the piece. Fixing a typo in the rationale must
 * not flag a hand-polished caption as out of date.
 *
 * Deleting the copy when the brief changes would be the obvious alternative and
 * it is wrong twice over: it destroys real work on a button people press to
 * compare, and handleSaveEdit sends all six brief fields on every save, so
 * correcting one word would silently delete the copy.
 */
export function sourceHash(slot: Slot): string {
  return createHash("sha256")
    .update(JSON.stringify([slot.theme, slot.hook, slot.body ?? [], slot.cta]))
    .digest("hex")
    .slice(0, 32);
}

/** Was this copy written from an older version of the brief? */
export function isCopyStale(slot: Slot): boolean {
  const copy = readCopy(slot);
  if (!copy) return false;
  return copy.sourceHash !== sourceHash(slot);
}

/* ------------------------------------------------------------ parsing --- */

export type AuthoredCopy = Pick<
  SlotCopy,
  "headline" | "blocks" | "caption" | "hashtags"
>;

/**
 * Validate the model's answer and clamp it.
 *
 * Reuses clamp/clampList from the planner so all three generation paths enforce
 * their structural limits through the same code. Platform limits are NOT
 * applied here — see copyWarnings.
 *
 * Returns null when there is nothing usable, which is the guarantee writeCopy
 * relies on to refuse the write. Same rule as regenerate.ts: overwriting a
 * working piece with an empty one because the model was unreachable is strictly
 * worse than leaving it alone.
 */
export function parseCopy(raw: unknown, slot: Slot): AuthoredCopy | null {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const format = normalizeFormat(slot.type, slot.channel);

  const rawBlocks = Array.isArray(root.blocks) ? root.blocks : [];
  const blocks: CopyBlock[] = [];

  for (const entry of rawBlocks.slice(0, MAX_COPY_BLOCKS)) {
    // A model that answers with a bare string where an object was asked for is
    // a common enough slip to absorb — the same reasoning as clampList.
    const obj =
      typeof entry === "string"
        ? { text: entry }
        : entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : null;
    if (!obj) continue;

    const text = clamp(obj.text, MAX_BLOCK_CHARS);
    if (!text) continue;

    const onScreen = clamp(obj.onScreen, MAX_ONSCREEN_CHARS);
    const note = clamp(obj.note, MAX_NOTE_CHARS);
    blocks.push({
      label: clamp(obj.label, MAX_LABEL_CHARS) || blockLabelFor(format, blocks.length),
      text,
      // Absent rather than undefined: Firestore is configured to ignore
      // undefined, so this keeps the stored shape and the in-memory one equal.
      ...(onScreen ? { onScreen } : {}),
      ...(note ? { note } : {}),
    });
  }

  if (blocks.length === 0) return null;

  return {
    headline: clamp(root.headline, MAX_HEADLINE_CHARS) || null,
    blocks,
    caption: clamp(root.caption, MAX_CAPTION_CHARS) || null,
    hashtags: clampList(root.hashtags, MAX_HASHTAGS, MAX_HASHTAG_CHARS).map((h) =>
      h.startsWith("#") ? h : `#${h}`
    ),
  };
}

/**
 * Carry provenance across a hand edit.
 *
 * sourceHash, generatedAt and model record who wrote this and from what. They
 * must never come from the client: accepting sourceHash lets a caller forge
 * "not stale", and RECOMPUTING it would be worse — a hand edit to the copy
 * would silently re-base staleness against a brief the copy was not written
 * from. So they are carried, not accepted and not derived.
 *
 * With no existing copy the result reads honestly as hand-written.
 */
export function mergeCopy(
  existing: SlotCopy | null,
  authored: AuthoredCopy,
  now = new Date().toISOString()
): SlotCopy {
  return {
    ...authored,
    sourceHash: existing?.sourceHash ?? "",
    generatedAt: existing?.generatedAt ?? now,
    model: existing?.model ?? null,
    editedAt: now,
  };
}

/* ---------------------------------------------------------- rendering --- */

export interface CopySection {
  label: string;
  text: string;
  note?: string;
}

/**
 * The copy as an ordered, neutral list.
 *
 * Deliberately not a string: the PDF styles the label and the text separately
 * (plan-pdf.tsx:194-215), so flattening here would collapse the one distinction
 * that surface needs. What the four render surfaces share is selection and
 * ordering, not formatting.
 */
export function copySections(copy: SlotCopy): CopySection[] {
  const sections: CopySection[] = [];

  if (copy.headline) sections.push({ label: "Subject", text: copy.headline });

  for (const block of copy.blocks) {
    const notes = [
      block.onScreen ? `on screen: ${block.onScreen}` : null,
      block.note,
    ].filter(Boolean);
    sections.push({
      label: block.label,
      text: block.text,
      ...(notes.length > 0 ? { note: notes.join(" · ") } : {}),
    });
  }

  if (copy.caption) sections.push({ label: "Caption", text: copy.caption });
  if (copy.hashtags.length > 0) {
    sections.push({ label: "Hashtags", text: copy.hashtags.join(" ") });
  }

  return sections;
}

/** The line-based rendering, for the Markdown export and the calendar body. */
export function copyToLines(copy: SlotCopy): string[] {
  const lines: string[] = [];
  for (const section of copySections(copy)) {
    lines.push(section.label.toUpperCase());
    lines.push(section.text);
    if (section.note) lines.push(`(${section.note})`);
    lines.push("");
  }
  return lines;
}

/* ------------------------------------------------------------ warnings --- */

/**
 * What would stop this being posted as it stands.
 *
 * Computed at read time, never stored: a stored warning goes stale the moment
 * someone hand-edits the copy through PATCH, and would then be reporting a
 * problem that no longer exists.
 */
export function copyWarnings(copy: SlotCopy, slot: Slot): string[] {
  const limits = limitsFor(slot.channel);
  const warnings: string[] = [];

  if (limits.perBlock !== null) {
    for (const block of copy.blocks) {
      if (block.text.length > limits.perBlock) {
        warnings.push(
          `${block.label} is ${block.text.length} characters — ${slot.channel} allows ${limits.perBlock}.`
        );
      }
    }
  }

  if (limits.body !== null) {
    // The caption where the format has one, the blocks joined where it does
    // not — which is the right measurement for a carousel and for a post
    // alike, with no per-format branch.
    const body = copy.caption ?? copy.blocks.map((b) => b.text).join("\n\n");
    if (body.length > limits.body) {
      const what = copy.caption ? "The caption" : "The post";
      warnings.push(
        `${what} is ${body.length} characters — ${slot.channel} allows ${limits.body}.`
      );
    }
  }

  return warnings;
}
