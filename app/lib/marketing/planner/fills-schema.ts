// The shape the planner model must answer in, as a schema the API enforces.
//
// Everything here was already asked for in prose and checked afterwards by
// parseFills. A schema moves the part a machine can guarantee to the far side
// of the call: with it attached, a response that is not this shape is not a
// response the API will return.
//
// That is the spec's own instruction — prefer moving a constraint into Tier A
// over writing a better prompt rule for it — applied to the plumbing rather
// than to the copy.
//
// It is built PER REQUEST rather than declared once, which is the whole point:
// gap_id becomes an enum of the ids this call actually asked about, so
// "Ignored a fill for an unknown gap" stops being a warning parseFills emits
// and starts being a thing that cannot happen.
//
// Pure. No model call to test it.

import { z } from "zod/v4";
import { CHANNELS } from "../posting-windows";
import type { Gap } from "./decide";

/**
 * What the model may answer for one gap.
 *
 * Every field is required and `additionalProperties` is closed, because strict
 * JSON-schema mode allows nothing else — an optional field has to be expressed
 * as a nullable one. `Fill` has no optionals, which is most of why decide is
 * the first call site to get this treatment and copy is not.
 *
 * `campaign_id` is nullable rather than absent for the same reason: a piece
 * planned from pillars rather than a campaign has to be able to say so.
 */
function fillSchema(gapIds: string[]) {
  return z.object({
    // The constraint that was previously a dropped row and a warning.
    gap_id: z.enum(gapIds as [string, ...string[]]),
    campaign_id: z.string().nullable(),
    // Global, not per-gap. allowed_channels varies by gap and a single array
    // schema cannot express that, so parseFills still checks membership — this
    // only rules out a channel the product has never heard of.
    channel: z.enum(CHANNELS),
    theme: z.string(),
    brief: z.string(),
    rationale: z.string(),
    body: z.array(z.string()),
    hook: z.string(),
    cta: z.string(),
  });
}

/**
 * The schema for one decide call, named for the gaps it is asking about.
 *
 * Lengths are deliberately NOT expressed here. Strict mode does not support
 * maxLength, and the caps in types.ts are a clamp rather than a rejection —
 * a theme four characters too long should be trimmed, not cost the whole
 * response. parseFills keeps doing that.
 */
export function fillsSchema(gaps: Gap[]) {
  return z.object({ fills: z.array(fillSchema(gaps.map((g) => g.gap_id))) });
}
