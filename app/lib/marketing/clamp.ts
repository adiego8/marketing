// Coercing whatever the model said into a string of bounded length.
//
// These lived in planner/decide.ts, next to their first caller, and copy.ts and
// brand.ts imported them from there. That import was the only thing connecting
// those two modules to the planner — and through it to llm.ts, and through THAT
// to Firestore once the OpenAI key moved out of env.
//
// Which broke the build, because copy.ts is read by client components: a slot
// page ended up importing firebase-admin, and firebase-admin wants child_process.
// The edge had been there all along and cost nothing until llm.ts gained a
// database. Two functions with no dependencies do not belong at the bottom of a
// module that calls a model.

/** A model string, trimmed and capped. Anything that is not a string is "". */
export function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The array sibling of clamp, capped on both axes.
 *
 * A model that returns a single string instead of an array is a common enough
 * slip to be worth absorbing rather than discarding — one beat is better than
 * none. Anything else becomes an empty list.
 */
export function clampList(value: unknown, maxItems: number, maxChars: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw
    .map((entry) => clamp(entry, maxChars))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
}
