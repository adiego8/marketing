// Did the model write the same piece twice?
//
// The last line of defence behind the allocation. Angles, pillars and entry
// points are assigned in code so the set CANNOT start from one place, but
// nothing stops a model handed eight different starting points from walking
// all eight back to the campaign's key message. This is the check that says
// when it did.
//
// Reported, never repaired. With the allocation in place a collision means the
// allocation needs tuning or the strategy is too thin to carry this many pieces
// — both things a person should see, not something to paper over with another
// billed model call.
//
// Pure, and the second consumer similarity.ts was written for.

import { jaccard } from "../similarity";
import type { Fill } from "./types";

/**
 * How alike two themes have to be before they count as the same argument.
 *
 * Measured on content words with function words already dropped, so two pieces
 * about the same subject do not trip it on their shared vocabulary — it takes
 * two themes making the same claim.
 *
 * Tuned toward silence: a warning the operator learns to ignore is worse than
 * no warning, and the allocation is what actually prevents the problem.
 */
export const THEME_COLLISION_THRESHOLD = 0.5;

/** Shortened for a warning line, on a word boundary where there is one. */
function short(theme: string, max = 60): string {
  if (theme.length <= max) return theme;
  const cut = theme.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * One warning per pair of pieces making the same argument.
 *
 * Compares every written theme against every other in the run, and against
 * what this client has already published. Themes are comparable in length, so
 * `jaccard` is the right measure — `overlap` would flag any short theme whose
 * words all appear in a longer one, which is a different question.
 *
 * Pieces with no theme are skipped: they already have their own warning, and
 * two empty strings are not a collision.
 */
export function themeCollisions(
  fills: Fill[],
  recentThemes: { theme: string }[] = []
): string[] {
  const written = fills.filter((f) => f.theme.trim().length > 0);
  const warnings: string[] = [];

  for (let i = 0; i < written.length; i++) {
    for (let j = i + 1; j < written.length; j++) {
      if (jaccard(written[i].theme, written[j].theme) >= THEME_COLLISION_THRESHOLD) {
        warnings.push(
          `Two of these pieces are making the same argument: "${short(written[i].theme)}" and "${short(written[j].theme)}". Turn one of them down to get a different angle.`
        );
      }
    }
  }

  for (const fill of written) {
    const echoed = recentThemes.find(
      (r) =>
        typeof r?.theme === "string" &&
        jaccard(fill.theme, r.theme) >= THEME_COLLISION_THRESHOLD
    );
    if (echoed) {
      warnings.push(
        `"${short(fill.theme)}" repeats something this client has already had: "${short(echoed.theme)}".`
      );
    }
  }

  return warnings;
}
