import { NextResponse } from "next/server";
import {
  isSlotStatus,
  updateSlot,
  setEventLock,
  type SlotPatch,
} from "@/lib/marketing/slots";
import {
  SLOT_STATUSES,
  MAX_THEME_CHARS,
  MAX_BRIEF_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_HOOK_CHARS,
  MAX_CTA_CHARS,
  MAX_BODY_ITEMS,
  MAX_BODY_ITEM_CHARS,
} from "@/lib/marketing/planner/types";
import {
  readCopy,
  mergeCopy,
  MAX_COPY_BLOCKS,
  MAX_BLOCK_CHARS,
  MAX_ONSCREEN_CHARS,
  MAX_NOTE_CHARS,
  MAX_LABEL_CHARS,
  MAX_HEADLINE_CHARS,
  MAX_CAPTION_CHARS,
  MAX_HASHTAGS,
  MAX_HASHTAG_CHARS,
  type AuthoredCopy,
  type CopyBlock,
} from "@/lib/marketing/copy";
import { getSlot } from "@/lib/marketing/slots";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

// The same caps the model is held to, so a hand edit cannot produce a slot the
// planner could not have produced.
const TEXT_LIMITS: Record<string, number> = {
  theme: MAX_THEME_CHARS,
  brief: MAX_BRIEF_CHARS,
  rationale: MAX_RATIONALE_CHARS,
  hook: MAX_HOOK_CHARS,
  cta: MAX_CTA_CHARS,
};

// PATCH /api/v1/clients/[clientId]/slots/[slotId]
//
// Status, pinning, and the piece itself. Scheduling — date, time, channel,
// format — stays the planner's; see updateSlot for why.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;

    // Taking an event's text back from Google. Its own write, not a SlotPatch
    // field: it clears the lock AND marks the slot stale so the next sync
    // actually pushes the app's text over the hand-edited event. Handled first
    // and alone, because pairing it with a content edit would push the two
    // writes into an order that is not worth reasoning about.
    if ("google_event_locked" in body) {
      if (typeof body.google_event_locked !== "boolean") {
        return jsonError("google_event_locked must be a boolean", 400);
      }
      const unlocked = await setEventLock(clientId, slotId, body.google_event_locked);
      if (!unlocked) return jsonError("Slot not found", 404);
      return NextResponse.json(unlocked);
    }

    const patch: SlotPatch = {};

    if ("status" in body) {
      // An unrecognised status would silently stop counting against quota, so
      // it is rejected rather than stored.
      if (!isSlotStatus(body.status)) {
        return jsonError(
          `status must be one of: ${SLOT_STATUSES.join(", ")}`,
          400
        );
      }
      patch.status = body.status;
    }
    if ("pinned" in body) {
      if (typeof body.pinned !== "boolean") {
        return jsonError("pinned must be a boolean", 400);
      }
      patch.pinned = body.pinned;
    }
    for (const [key, max] of Object.entries(TEXT_LIMITS)) {
      if (!(key in body)) continue;
      const value = body[key];
      if (typeof value !== "string") {
        return jsonError(`${key} must be a string`, 400);
      }
      if (value.length > max) {
        return jsonError(`${key} must be at most ${max} characters`, 400);
      }
      (patch as Record<string, unknown>)[key] = value;
    }

    if ("body" in body) {
      if (!Array.isArray(body.body) || body.body.some((x) => typeof x !== "string")) {
        return jsonError("body must be an array of strings", 400);
      }
      if (body.body.length > MAX_BODY_ITEMS) {
        return jsonError(`body must have at most ${MAX_BODY_ITEMS} entries`, 400);
      }
      if ((body.body as string[]).some((x) => x.length > MAX_BODY_ITEM_CHARS)) {
        return jsonError(
          `each body entry must be at most ${MAX_BODY_ITEM_CHARS} characters`,
          400
        );
      }
      patch.body = (body.body as string[]).map((x) => x.trim()).filter(Boolean);
    }

    if ("content" in body) {
      // null clears the copy, which is a legal and useful thing to do.
      if (body.content === null) {
        patch.content = null;
      } else if (!body.content || typeof body.content !== "object") {
        return jsonError("content must be an object or null", 400);
      } else {
        const authored = readAuthoredCopy(body.content as Record<string, unknown>);
        if ("error" in authored) return jsonError(authored.error, 400);

        // Provenance is carried, never accepted and never recomputed.
        //
        // Accepting sourceHash from the client would let a caller forge "not
        // stale" and hide that the brief has moved. Recomputing it would be
        // worse: hand-editing the COPY would silently re-base staleness
        // against a brief the copy was never written from. So the existing
        // record is read here and merged in.
        const existing = await getSlot(clientId, slotId);
        if (!existing) return jsonError("Slot not found", 404);
        patch.content = mergeCopy(
          readCopy(existing),
          authored.copy
        ) as unknown as Record<string, unknown>;
      }
    }

    if (Object.keys(patch).length === 0) {
      return jsonError(
        "Nothing to update. Send status, pinned, content, or any of theme, brief, rationale, hook, body, cta.",
        400
      );
    }

    const slot = await updateSlot(clientId, slotId, patch);
    if (!slot) return jsonError("Slot not found", 404);

    return NextResponse.json(slot);
  } catch (error) {
    return serverError("Update slot error", error);
  }
}

/**
 * Validate hand-edited copy, rebuilding it from a whitelist.
 *
 * Rebuilt rather than filtered because the editor sends the whole stored blob
 * back, provenance included, and failing on fields it did not author would be
 * gratuitous. Rejects rather than truncates: the planner clamps because a MODEL
 * wrote the text, and this route tells a person instead — the same split
 * TEXT_LIMITS already makes above.
 */
function readAuthoredCopy(
  raw: Record<string, unknown>
): { copy: AuthoredCopy } | { error: string } {
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    return { error: "content.blocks must be a non-empty array" };
  }
  if (raw.blocks.length > MAX_COPY_BLOCKS) {
    return { error: `content.blocks must have at most ${MAX_COPY_BLOCKS} entries` };
  }

  const blocks: CopyBlock[] = [];
  for (const [i, entry] of raw.blocks.entries()) {
    if (!entry || typeof entry !== "object") {
      return { error: `content.blocks[${i}] must be an object` };
    }
    const b = entry as Record<string, unknown>;
    for (const [key, max] of [
      ["label", MAX_LABEL_CHARS],
      ["text", MAX_BLOCK_CHARS],
    ] as const) {
      if (typeof b[key] !== "string") {
        return { error: `content.blocks[${i}].${key} must be a string` };
      }
      if ((b[key] as string).length > max) {
        return { error: `content.blocks[${i}].${key} must be at most ${max} characters` };
      }
    }
    for (const [key, max] of [
      ["onScreen", MAX_ONSCREEN_CHARS],
      ["note", MAX_NOTE_CHARS],
    ] as const) {
      if (b[key] === undefined || b[key] === null || b[key] === "") continue;
      if (typeof b[key] !== "string") {
        return { error: `content.blocks[${i}].${key} must be a string` };
      }
      if ((b[key] as string).length > max) {
        return { error: `content.blocks[${i}].${key} must be at most ${max} characters` };
      }
    }
    blocks.push({
      label: b.label as string,
      text: b.text as string,
      ...(b.onScreen ? { onScreen: b.onScreen as string } : {}),
      ...(b.note ? { note: b.note as string } : {}),
    });
  }

  for (const [key, max] of [
    ["headline", MAX_HEADLINE_CHARS],
    ["caption", MAX_CAPTION_CHARS],
  ] as const) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      return { error: `content.${key} must be a string or null` };
    }
    if (value.length > max) {
      return { error: `content.${key} must be at most ${max} characters` };
    }
  }

  if (raw.hashtags !== undefined && raw.hashtags !== null) {
    if (!Array.isArray(raw.hashtags) || raw.hashtags.some((h) => typeof h !== "string")) {
      return { error: "content.hashtags must be an array of strings" };
    }
    if (raw.hashtags.length > MAX_HASHTAGS) {
      return { error: `content.hashtags must have at most ${MAX_HASHTAGS} entries` };
    }
    if ((raw.hashtags as string[]).some((h) => h.length > MAX_HASHTAG_CHARS)) {
      return { error: `each hashtag must be at most ${MAX_HASHTAG_CHARS} characters` };
    }
  }

  return {
    copy: {
      headline: typeof raw.headline === "string" && raw.headline ? raw.headline : null,
      blocks,
      caption: typeof raw.caption === "string" && raw.caption ? raw.caption : null,
      hashtags: Array.isArray(raw.hashtags) ? (raw.hashtags as string[]) : [],
    },
  };
}
