import { FieldValue } from "firebase-admin/firestore";
import { db, COLLECTIONS, serializeLesson } from "../firestore";
import { lessonsFor, MAX_LESSON_CHARS } from "./lessons";
import type { Lesson, LessonScope } from "../types";

// Server-only reads and writes for what the agent has been taught. The rules
// themselves — filtering, ordering, the caps — are pure and live in lessons.ts.

export async function listLessons(clientId: string): Promise<Lesson[]> {
  const snap = await db()
    .collection(COLLECTIONS.lessons)
    .where("clientId", "==", clientId)
    .get();

  // Sorted in memory, like every other list here: no composite index to deploy.
  return snap.docs
    .map((doc) => serializeLesson(doc.id, doc.data()))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) as Lesson[];
}

export async function createLesson(
  clientId: string,
  input: { text: string; scope: LessonScope; evidence?: string[] }
): Promise<Lesson> {
  const ref = db().collection(COLLECTIONS.lessons).doc();
  await ref.set({
    clientId,
    text: input.text.trim().slice(0, MAX_LESSON_CHARS),
    scope: input.scope,
    source: "written",
    // See the note on Lesson.owner: written now, read later.
    owner: "client",
    evidence: input.evidence ?? [],
    evidenceCount: input.evidence?.length ?? 0,
    retiredAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  return serializeLesson(ref.id, snap.data() ?? {}) as Lesson;
}

/**
 * Retiring is not deleting.
 *
 * A retired lesson stops reaching prompts but stays on the page, because "the
 * agent used to believe this" is worth being able to see — especially when
 * positioning changes and you are working out why older pieces read the way
 * they do.
 */
export async function updateLesson(
  clientId: string,
  lessonId: string,
  patch: { text?: string; scope?: LessonScope; status?: "active" | "retired" }
): Promise<Lesson | null> {
  const ref = db().collection(COLLECTIONS.lessons).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.clientId !== clientId) return null;

  const update: Record<string, unknown> = {};
  if (patch.text !== undefined) update.text = patch.text.trim().slice(0, MAX_LESSON_CHARS);
  if (patch.scope !== undefined) update.scope = patch.scope;
  if (patch.status !== undefined) {
    update.retiredAt = patch.status === "retired" ? FieldValue.serverTimestamp() : null;
  }

  if (Object.keys(update).length > 0) await ref.update(update);
  const after = await ref.get();
  return serializeLesson(lessonId, after.data() ?? {}) as Lesson;
}

export async function deleteLesson(clientId: string, lessonId: string): Promise<boolean> {
  const ref = db().collection(COLLECTIONS.lessons).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.clientId !== clientId) return false;
  await ref.delete();
  return true;
}

/** The lessons for one generation, loaded and filtered. */
export async function lessonsForPrompt(
  clientId: string,
  scope: LessonScope
): Promise<string[]> {
  try {
    return lessonsFor(await listLessons(clientId), scope);
  } catch (error) {
    // A generation must not fail because guidance could not be loaded. Writing
    // without the lessons is worse than writing with them, and far better than
    // not writing at all.
    console.error("Could not load lessons", error);
    return [];
  }
}
