import { NextResponse } from "next/server";
import { deleteLesson, updateLesson } from "@/lib/marketing/lessons-store";
import { MAX_LESSON_CHARS } from "@/lib/marketing/lessons";
import { LESSON_SCOPES, type LessonScope } from "@/lib/types";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; lessonId: string }> };

// PATCH /api/v1/clients/[clientId]/lessons/[lessonId]
//
// Edit the text, move the scope, retire it or bring it back. Retiring is not
// deleting: a retired lesson stops reaching prompts and stays on the page.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, lessonId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const patch: { text?: string; scope?: LessonScope; status?: "active" | "retired" } = {};

    if (typeof body.text === "string") {
      const text = body.text.trim();
      if (!text) return jsonError("A lesson needs some text.", 400);
      if (text.length > MAX_LESSON_CHARS) {
        return jsonError(`Keep a lesson under ${MAX_LESSON_CHARS} characters.`, 400);
      }
      patch.text = text;
    }
    if (body.scope !== undefined) {
      if (!LESSON_SCOPES.includes(body.scope as LessonScope)) {
        return jsonError(`Scope must be one of: ${LESSON_SCOPES.join(", ")}.`, 400);
      }
      patch.scope = body.scope as LessonScope;
    }
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "retired") {
        return jsonError("Status must be active or retired.", 400);
      }
      patch.status = body.status;
    }

    const updated = await updateLesson(clientId, lessonId, patch);
    if (!updated) return jsonError("Lesson not found", 404);
    return NextResponse.json(updated);
  } catch (error) {
    return serverError("Update lesson error", error);
  }
}

// DELETE — for a rule typed by mistake. Retire, not delete, is the usual path.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId, lessonId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const removed = await deleteLesson(clientId, lessonId);
    if (!removed) return jsonError("Lesson not found", 404);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return serverError("Delete lesson error", error);
  }
}
