// Everything wrong with one finished piece, in one list.
//
// Four checks answer four different questions — platform limits, language,
// the ask, and whether it reads like a person wrote it — and every caller
// wants all four. They were spelled out three times: twice in write-copy.ts
// and once on the slot page. The copies had already drifted (the page read
// slot.cta, write-copy read the brief's), and languageOf was being called
// three times per list to build it.
//
// Reported, never repaired. Nothing here rewrites anything; the operator
// reads the list and decides. That is the same line the rest of this feature
// draws, and this module is only where the four sit together.
//
// Pure, like the four functions it calls, so it is tested the way the repo
// tests everything: real inputs, no mocks.

import { copyWarnings, type HasFormat, type SlotCopy } from "./copy";
import { ctaWarnings, languageOf, wordsToAvoidOf } from "./brand";
import { languageWarnings } from "./language";
import { humanizeWarnings } from "./humanize";

/**
 * What the checks need to know about the piece itself.
 *
 * Fields rather than a Slot, matching CopyBrief's reasoning: both a committed
 * Slot and the brief copy was written from satisfy this, which is what lets
 * the generation path and the read path share one function.
 */
export type HasPiece = HasFormat & { cta: string };

/**
 * Every warning that belongs on one piece, in a stable order.
 *
 * Platform limits first because they are the only ones that are simply facts
 * about the platform; then language, then the ask, then voice — roughly the
 * order in which a person would notice them.
 *
 * `strategy` is deliberately `unknown`, matching languageOf, wordsToAvoidOf
 * and every other accessor in brand.ts. The stored document is hand-editable
 * JSON with `Record<string, unknown>` sections, and each accessor degrades on
 * a missing or malformed one — so a client with no strategy at all gets
 * platform limits and silence rather than an exception, and a caller holding
 * its own narrower Strategy type does not have to cast on the way in.
 */
export function pieceWarnings(
  copy: SlotCopy | null,
  piece: HasPiece,
  strategy: unknown
): string[] {
  const language = languageOf(strategy);
  return [
    ...(copy ? copyWarnings(copy, piece) : []),
    ...languageWarnings(copy, language),
    ...ctaWarnings(piece.cta, language),
    ...humanizeWarnings(copy, { language, wordsToAvoid: wordsToAvoidOf(strategy) }),
  ];
}
