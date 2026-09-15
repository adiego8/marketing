import type { BriefSnapshot, Lesson, LessonScope } from "../types";

/**
 * What the agent has been taught about one client.
 *
 * A lesson is a single imperative rule — "Open with the cost of the status quo,
 * not the product" — that rides in the payload of every generation it applies
 * to. Rules, not transcripts: a model obeys a rule and ignores a paragraph, and
 * a short list can be read, argued with and retired, which a growing pile of
 * past feedback cannot.
 *
 * Pure, with no Firestore import, for two reasons: "the right lessons reach the
 * right prompt" becomes a unit test with nothing mocked, and the Learned page
 * can import the limits without dragging firebase-admin into the browser. The
 * store lives in lessons-store.ts — the same split as planner/drop.ts against
 * planner/plan-runs.ts.
 */

/** Long enough for a real rule, short enough that twelve of them still fit. */
export const MAX_LESSON_CHARS = 200;

/**
 * How many reach any one prompt.
 *
 * A cap rather than everything, because the failure mode of this whole feature
 * is a prompt that grows until the actual task is buried. Twelve rules is more
 * guidance than most briefs carry.
 */
export const MAX_LESSONS_PER_PROMPT = 12;

/**
 * The lessons that apply to one generation, in the order they should be read.
 *
 * Strongest first: a rule five rejections justify outranks one someone typed on
 * a whim, and if the cap bites it is the weakly-evidenced ones that fall off.
 * Ties break on recency, so a fresh rule beats a stale one of equal weight.
 */
export function lessonsFor(
  lessons: Lesson[],
  scope: LessonScope,
  cap = MAX_LESSONS_PER_PROMPT
): string[] {
  return lessons
    .filter((l) => l.status === "active" && l.scope === scope && l.text.trim())
    .sort(
      (a, b) =>
        b.evidence_count - a.evidence_count ||
        (b.created_at ?? "").localeCompare(a.created_at ?? "")
    )
    .slice(0, Math.max(0, cap))
    .map((l) => l.text.trim());
}

/** The fields of a piece a person can disagree with. */
const BRIEF_KEYS = ["theme", "hook", "body", "cta"] as const;

/** Read a snapshot off anything slot-shaped, tolerating missing fields. */
export function snapshotOf(slot: Partial<BriefSnapshot> | null | undefined): BriefSnapshot {
  return {
    theme: slot?.theme ?? "",
    hook: slot?.hook ?? "",
    body: Array.isArray(slot?.body) ? [...slot.body] : [],
    cta: slot?.cta ?? "",
  };
}

/**
 * Which fields a person actually changed.
 *
 * Empty means nothing moved, and the caller records no signal — saving a form
 * without touching it is not feedback, and counting it as a rejection would
 * quietly inflate the evidence behind every rule.
 *
 * `body` is compared by value: it is a fresh array on every read, so identity
 * would report a change on every save.
 */
export function diffBrief(before: BriefSnapshot, after: BriefSnapshot): string[] {
  return BRIEF_KEYS.filter((key) => {
    if (key === "body") {
      return (
        before.body.length !== after.body.length ||
        before.body.some((beat, i) => beat !== after.body[i])
      );
    }
    return before[key] !== after[key];
  });
}
