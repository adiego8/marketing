import { NextResponse } from "next/server";
import { getCampaign, updateCampaign } from "@/lib/marketing/campaigns";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string; campaignId: string }> };

/** Next Monday in the client's timezone, as YYYY-MM-DD. */
function nextMonday(timezone: string): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const daysUntilMonday = (8 - local.getDay()) % 7 || 7;
  local.setDate(local.getDate() + daysUntilMonday);
  return local.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// POST .../accept — the campaign becomes active, and only active campaigns feed
// the planner.
//
// Beyond flipping the status (all the Python did), this derives a start/end
// window when one is not already set: the planner needs a window to place
// slots inside, and nothing else in the UI sets these dates. Weeks come from
// content_plan.timeline, defaulting to 4. An explicitly supplied window wins.
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId, campaignId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const campaign = await getCampaign(clientId, campaignId);
    if (!campaign) return jsonError("Campaign not found", 404);

    const body = (await readBody(request)) as Record<string, unknown>;
    const timezone = String(ctx.client.data.timezone || "UTC");

    const startDate =
      (typeof body.start_date === "string" ? body.start_date : null) ??
      campaign.start_date ??
      nextMonday(timezone);

    const plan = campaign.content_plan as { timeline?: unknown[] };
    const weeks = Array.isArray(plan?.timeline) && plan.timeline.length > 0
      ? plan.timeline.length
      : 4;

    const endDate =
      (typeof body.end_date === "string" ? body.end_date : null) ??
      campaign.end_date ??
      addDays(startDate, weeks * 7 - 1);

    const updated = await updateCampaign(campaignId, {
      status: "active",
      startDate,
      endDate,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return serverError("Accept campaign error", error);
  }
}
