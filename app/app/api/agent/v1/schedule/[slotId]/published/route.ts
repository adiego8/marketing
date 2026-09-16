import { NextResponse } from "next/server";
import { markSlotPublished } from "@/lib/marketing/slots";
import { parsePublishBody } from "@/lib/marketing/agent/publish";
import { projectSlot } from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyError,
  keyServerError,
  readAgentBody,
} from "@/lib/marketing/agent/route-helpers";

type Params = { params: Promise<{ slotId: string }> };

// POST /api/agent/v1/schedule/[slotId]/published
//
// The half that closes the loop. Without it every piece sits on "drafted"
// forever, nobody can tell what actually went out, and a queue retry posts to
// the client's feed twice.
//
// Body: { external_id, external_url?, published_at?, idempotency_key }
export async function POST(request: Request, { params }: Params) {
  try {
    const body = await readAgentBody(request);
    const ctx = await requireApiKey(
      "schedule:publish",
      typeof body.client_id === "string" ? body.client_id : null
    );
    if ("response" in ctx) return ctx.response;

    const { slotId } = await params;
    const parsed = parsePublishBody(body);
    if ("error" in parsed) {
      return keyError("invalid_body", parsed.error, 400);
    }

    const outcome = await markSlotPublished(
      ctx.client.id,
      slotId,
      parsed.value,
      // The prefix, never the key. A verifier does not belong in a data
      // document, and the prefix is enough to answer "which key was that".
      ctx.key.prefix
    );

    if (!outcome) {
      return keyError("not_found", "No such piece.", 404);
    }

    if ("rejected" in outcome) {
      // 404, not 400: this piece was never served as publishable, so a report
      // about it is indistinguishable from someone probing for slot ids. Same
      // reasoning that makes another agency's client read as missing.
      return keyError("not_found", outcome.rejected, 404);
    }

    if ("conflict" in outcome) {
      const existing = outcome.slot.publication;
      return NextResponse.json(
        {
          error:
            "This piece has already been published, under a different idempotency key.",
          code: "already_published",
          // Handed back so the caller can reconcile rather than guess.
          published: existing
            ? {
                external_id: existing.external_id,
                external_url: existing.external_url,
                published_at: existing.published_at,
              }
            : null,
        },
        { status: 409 }
      );
    }

    // A replay answers exactly as the first call did. That is what makes a
    // retried queue message safe: same request, same answer, no second post.
    return NextResponse.json({
      ...projectSlot(outcome.slot),
      replayed: outcome.replayed,
    });
  } catch (error) {
    return keyServerError("Agent publish error", error);
  }
}
