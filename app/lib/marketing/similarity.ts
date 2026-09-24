// How much two pieces of text are saying the same thing.
//
// The repo had nothing like this. Every anti-repetition mechanism in it was a
// prompt instruction ("make those pieces genuinely different", "do not repeat
// anything in recent_themes") plus one lowercase exact-string comparison, so
// two near-identical themes differing by a synonym passed every check there
// was.
//
// Pure, no dependency, no model call. Two consumers, deliberately one
// primitive: the caption check here in Phase 3, and theme collision detection
// in Phase 2.
//
// NOT embeddings, and not because embeddings would be worse at this. They cost
// a model call per comparison, which is the thing this codebase most needs to
// stop doing casually, and they cannot be unit-tested in a repo that mocks
// nothing. Word overlap is enough to catch a caption that restates its own
// slides, which is the actual complaint.

import { isStopword } from "./language";

/** Words that carry meaning: normalized, function words and noise dropped. */
export function contentTokens(text: string): Set<string> {
  if (typeof text !== "string") return new Set();
  return new Set(
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !isStopword(t))
  );
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Symmetric overlap, 0-1. For "are these two the same idea?".
 *
 * Penalises length difference, which is what you want when comparing two
 * themes of roughly equal size and NOT what you want when comparing a caption
 * against the slides it sits under — see overlap.
 */
export function jaccard(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = intersectionSize(left, right);
  return shared / (left.size + right.size - shared);
}

/**
 * Containment, 0-1. For "is this one just restating that one?".
 *
 * Divides by the SMALLER set, so a long caption that swallows every word of a
 * short slide scores 1 — which jaccard would score low purely because the
 * caption is longer. Restatement is the asymmetric relation, so it needs the
 * asymmetric measure.
 */
export function overlap(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  return intersectionSize(left, right) / Math.min(left.size, right.size);
}
