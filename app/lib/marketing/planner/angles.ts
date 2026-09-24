// What each piece argues, decided in code before the model is asked.
//
// The repetition complaint is structural, not a wording problem. expandGapIds
// turns one demand row into N gaps and up to forty of them go to the model in a
// SINGLE call, with nothing separating piece 3 from piece 4 but an integer. The
// only pressure toward variety was prose — "make those pieces genuinely
// different from each other" — and a model asked for eight pieces about one key
// message will converge on it. There is not even a randomness knob to fall back
// on: the graded temperatures are inert on gpt-5.5 (llm.ts:23-36), so decide's
// 0.4 is dropped before the call.
//
// So the variety is built here instead. Each gap is handed a distinct angle, a
// pillar and a concrete thing to argue from, and eight pieces then have eight
// different arguments to make because a pure function said so.
//
// Deterministic, with no PRNG and no shuffle — the repo has neither, and its
// stated stance (slot-id.ts) is that allocation is derived from inputs rather
// than randomised. Plain index rotation, following defaultChannelFor in
// observe.ts, which is the house idiom for exactly this.

import {
  POSITIONING_ANGLES,
  angleFor,
  anglesOf,
  type Angle,
} from "../brand";

export interface Allocation {
  angle: Angle;
  /** The recurring theme this piece sits under. Null when the brand has none. */
  pillar: string | null;
  /** A concrete thing to argue from: a pain, an objection, a proof. */
  entryPoint: string | null;
}

export interface AllocationSource {
  angles: Angle[];
  pillars: string[];
  entryPoints: string[];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

/**
 * Everything the allocator draws on, pulled out of the strategy.
 *
 * Built here rather than read from PlannerInputs.business, which carries only
 * `{ name, icp, voice, positioning, goals }` — messaging is not in it, and
 * proof points and value props are among the best things a piece can argue
 * from. previewPlan holds the whole strategy, so it builds this and passes it
 * down the way it already passes pillars.
 *
 * `campaignAngle` is the campaign's own `strategy.positioning_angle`, free text
 * the campaign model wrote. Where it names a real angle it goes first, so the
 * allocation serves the campaign rather than competing with it.
 */
export function allocationSourceOf(
  strategy: unknown,
  campaignAngle?: unknown
): AllocationSource {
  const s = asObject(strategy);
  const icp = asObject(s.icp);
  const messaging = asObject(s.messaging);

  const leading = angleFor(campaignAngle);
  const brand = anglesOf(strategy);
  const angles = leading
    ? [leading, ...brand.filter((a) => a.type !== leading.type)]
    : brand;

  return {
    angles,
    pillars: strings(asObject(s.content_strategy).content_pillars),
    // Fixed order, so the same strategy always allocates the same way. Pains
    // and objections first because they are what a reader recognises; proof
    // and value props last because they are what convinces once they do.
    entryPoints: [
      ...strings(icp.pain_points),
      ...strings(icp.objections),
      ...strings(icp.trigger_events),
      ...strings(messaging.proof_points),
      ...strings(messaging.value_props),
    ],
  };
}

/**
 * The order angles are handed out in: the brand's own, then the rest.
 *
 * Always exactly the eight, permuted — the brand's angles are a subset of the
 * canonical list, so putting them first and appending what is left is a
 * reordering and never a truncation. That is what guarantees eight gaps get
 * eight different angles no matter how thin the strategy is.
 */
export function angleSequence(brandAngles: Angle[]): Angle[] {
  const chosen = brandAngles.filter((a) => angleFor(a.type));
  const rest = POSITIONING_ANGLES.filter(
    (a) => !chosen.some((c) => c.type === a.type)
  );
  return [...chosen, ...rest];
}

/**
 * One allocation per gap, in the order the gaps were expanded.
 *
 * Across the WHOLE run rather than per content type. A campaign owing three
 * posts, two carousels and two reels is seven pieces, and restarting the
 * rotation at each type would give post 1 and carousel 1 the same angle —
 * leaving the set as repetitive as it is now, only in a tidier arrangement.
 *
 * Never fails on a thin strategy. Angles alone carry the guarantee; missing
 * pillars and entry points become nulls and a warning, because a strategy with
 * nothing to argue from is a real finding about that strategy and the operator
 * should see it rather than receive eight quietly similar pieces.
 */
export function allocate(
  gapIds: string[],
  source: AllocationSource
): { allocations: Map<string, Allocation>; warnings: string[] } {
  const sequence = angleSequence(source.angles);
  const warnings: string[] = [];
  const allocations = new Map<string, Allocation>();

  gapIds.forEach((gapId, index) => {
    allocations.set(gapId, {
      angle: sequence[index % sequence.length],
      pillar: source.pillars.length
        ? source.pillars[index % source.pillars.length]
        : null,
      entryPoint: source.entryPoints.length
        ? source.entryPoints[index % source.entryPoints.length]
        : null,
    });
  });

  if (gapIds.length === 0) return { allocations, warnings };

  if (source.pillars.length === 0) {
    warnings.push(
      "This client's strategy lists no content pillars, so nothing anchors these pieces to a recurring theme."
    );
  }

  if (source.entryPoints.length === 0) {
    warnings.push(
      "This client's strategy lists no pain points, objections, trigger events or proof points, so every piece has to find its own way in. Filling those in is the single best thing you can do for what gets written."
    );
  } else if (source.entryPoints.length < gapIds.length) {
    warnings.push(
      `${gapIds.length} pieces are sharing ${source.entryPoints.length} things to argue from, so some of them start from the same place.`
    );
  }

  if (gapIds.length > sequence.length) {
    warnings.push(
      `${gapIds.length} pieces in one run is more than the ${sequence.length} positioning angles available, so angles repeat. Fewer pieces at a time would give each one a distinct argument.`
    );
  }

  return { allocations, warnings };
}
