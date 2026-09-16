import { NextResponse } from "next/server";
import { listSlots } from "@/lib/marketing/slots";
import { resolveRange } from "@/lib/marketing/agent/range";
import {
  projectSlot,
  publishable,
  clampLimit,
  decodeCursor,
  paginate,
  sortKeyOf,
} from "@/lib/marketing/agent/project";
import {
  requireApiKey,
  keyError,
  keyServerError,
} from "@/lib/marketing/agent/route-helpers";

// One Google-free Firestore read plus in-memory filtering. Nothing slow here.
export const maxDuration = 15;

// GET /api/agent/v1/schedule
//
// ?period=day|week|month&date=  — resolved in the CLIENT's timezone
// ?from=&to=                    — an explicit inclusive range, max 92 days
// ?channel=                     — repeatable
// ?ready_only=false             — include pieces that are not cleared to publish
// ?updated_since=               — an ISO instant, for polling
// ?cursor=&limit=               — paging, limit clamped to 200
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey("schedule:read");
    if ("response" in ctx) return ctx.response;

    const { searchParams } = new URL(request.url);
    const timezone = String(ctx.client.data.timezone || "UTC");

    const resolved = resolveRange(
      {
        period: searchParams.get("period"),
        date: searchParams.get("date"),
        from: searchParams.get("from"),
        to: searchParams.get("to"),
      },
      timezone
    );
    if ("error" in resolved) {
      return keyError("invalid_range", resolved.error, 422);
    }
    const { from, to } = resolved.range;

    // listSlots filters on clientId and narrows the range in memory — the
    // house pattern, and the reason this needs no composite index.
    const all = await listSlots(ctx.client.id, { start: from, end: to });

    const channels = searchParams
      .getAll("channel")
      .flatMap((c) => c.split(","))
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    /**
     * Ready-only DEFAULTS TO TRUE, and that is the single most important line
     * in this file.
     *
     * A human confirms a piece, someone then edits the hook, and the copy is
     * now written from a brief that no longer exists — while the status still
     * says confirmed, because nothing demotes it. An agent taking the default
     * gets only pieces that are confirmed AND whose copy matches their brief.
     * Seeing anything less finished has to be asked for.
     */
    const readyOnly = searchParams.get("ready_only") !== "false";
    const updatedSince = searchParams.get("updated_since")?.trim() || null;
    if (updatedSince && Number.isNaN(Date.parse(updatedSince))) {
      return keyError("invalid_range", "updated_since must be an ISO-8601 instant.", 422);
    }

    const matched = all
      .filter((s) => {
        if (s.status === "cancelled" || s.status === "skipped") return false;
        if (channels.length && !channels.includes(s.channel.toLowerCase())) return false;
        if (readyOnly && !publishable(s)) return false;
        // A slot with no updated_at predates the field. Included rather than
        // hidden: failing loud beats a piece that silently never appears.
        if (updatedSince && s.updated_at && s.updated_at <= updatedSince) return false;
        return true;
      })
      .sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)));

    const { items, nextCursor } = paginate(
      matched,
      decodeCursor(searchParams.get("cursor")),
      clampLimit(searchParams.get("limit"))
    );

    return NextResponse.json({
      range: { from, to, timezone },
      // Documented as at-least-once, not exactly-once: a calendar sync
      // re-stamps updatedAt on every slot it touches whether or not anything
      // changed, so a poller must dedupe on id rather than trust this filter.
      items: items.map(projectSlot),
      next_cursor: nextCursor,
    });
  } catch (error) {
    return keyServerError("Agent schedule error", error);
  }
}
