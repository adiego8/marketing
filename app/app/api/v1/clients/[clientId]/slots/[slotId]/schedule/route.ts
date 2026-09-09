import { NextResponse } from "next/server";
import { getSlot, listSlots, scheduleSlot } from "@/lib/marketing/slots";
import { quotaWarning, weekLoad } from "@/lib/marketing/planner/schedule";
import { getStrategy, type QuotaEntry } from "@/lib/marketing/strategy";
import { windowFor } from "@/lib/marketing/posting-windows";
import { toUtcInstant, weekKeyOf, zoneOrUTC } from "@/lib/marketing/planner/weeks";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; slotId: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{2}:\d{2}$/;

// PATCH /api/v1/clients/[clientId]/slots/[slotId]/schedule
//
// Gives an accepted piece a day, or moves one already scheduled. This is the
// only way a date enters the app from a person — the planner does not place
// dates and updateSlot refuses these fields.
//
// The quota WARNS and never refuses. Going over a weekly cap is a decision the
// operator is entitled to make and often has a reason for; a hard refusal only
// strands the piece. The warning rides back on the response.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId, slotId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const body = (await readBody(request)) as Record<string, unknown>;
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!ISO_DATE.test(date)) {
      return jsonError("A date is required, as YYYY-MM-DD.", 400);
    }

    const slot = await getSlot(clientId, slotId);
    if (!slot) return jsonError("Slot not found", 404);

    // The time is optional: a person picks a day, and the channel's own posting
    // window supplies the hour unless they say otherwise.
    const requested = typeof body.timeLocal === "string" ? body.timeLocal.trim() : "";
    if (requested && !LOCAL_TIME.test(requested)) {
      return jsonError("Time must be HH:MM.", 400);
    }
    const timeLocal =
      requested || slot.time_local || windowFor(slot.channel).times[0] || "09:00";

    const { zone } = zoneOrUTC(String(ctx.client.data.timezone || "UTC"));
    const weekKey = weekKeyOf(date, zone);
    const instant = toUtcInstant(date, timeLocal, zone);

    const others = await listSlots(clientId, { dated: "scheduled" });
    const warning = quotaWarning(
      weekKey,
      slot.type,
      weekLoad(
        others.map((s) => ({
          id: s.id,
          date: s.date,
          weekKey: s.week_key,
          type: s.type,
          status: s.status,
        })),
        weekKey,
        slot.type,
        slotId
      ),
      ((await getStrategy(clientId))?.content_quota?.weekly ?? {}) as Record<
        string,
        QuotaEntry
      >
    );

    const updated = await scheduleSlot(clientId, slotId, {
      date,
      timeLocal,
      weekKey,
      scheduledAt: instant ? instant.toISOString() : null,
    });
    if (!updated) return jsonError("Slot not found", 404);

    return NextResponse.json({ ...updated, quota_warning: warning });
  } catch (error) {
    return serverError("Schedule slot error", error);
  }
}
