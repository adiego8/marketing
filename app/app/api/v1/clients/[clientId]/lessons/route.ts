import { NextResponse } from "next/server";
import { createLesson, listLessons } from "@/lib/marketing/lessons-store";
import { MAX_LESSON_CHARS } from "@/lib/marketing/lessons";
import { LESSON_SCOPES, type LessonScope } from "@/lib/types";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/lessons
//
// Everything taught for this client, retired included — the Learned page shows
// retired rules too, because "the agent used to believe this" is worth seeing.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    return NextResponse.json(await listLessons(clientId));
  } catch (error) {
    return serverError("List lessons error", error);
  }
}

// POST /api/v1/clients/[clientId]/lessons — teach a rule by hand.
//
// No model call. A lesson is a sentence someone wrote, or (Phase 3) one an LLM
// proposed and someone accepted; nothing is ever learned without a person.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return jsonError("A lesson needs some text.", 400);
    if (text.length > MAX_LESSON_CHARS) {
      return jsonError(`Keep a lesson under ${MAX_LESSON_CHARS} characters.`, 400);
    }

    const scope = body.scope as LessonScope;
    if (!LESSON_SCOPES.includes(scope)) {
      return jsonError(`Scope must be one of: ${LESSON_SCOPES.join(", ")}.`, 400);
    }

    return NextResponse.json(await createLesson(clientId, { text, scope }));
  } catch (error) {
    return serverError("Create lesson error", error);
  }
}
