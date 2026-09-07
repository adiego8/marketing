import { NextResponse } from "next/server";
import { listSlots } from "@/lib/marketing/slots";
import { renderPlanPdf } from "@/lib/marketing/export/plan-pdf";
import { planFilename } from "@/lib/marketing/export/plan-markdown";
import { requireClient, serverError } from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// Rendering a PDF is CPU-bound and grows with the horizon.
export const maxDuration = 60;

// GET /api/v1/clients/[clientId]/plan/export?start=&end=
//
// The content plan as a PDF. Rendered server-side because @react-pdf/renderer
// is far too heavy to ship to the browser for one button — the Markdown export
// stays client-side for exactly the opposite reason.
export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const url = new URL(request.url);
    const start = url.searchParams.get("start") ?? undefined;
    const end = url.searchParams.get("end") ?? undefined;

    const slots = await listSlots(clientId, { start, end });
    const clientName = String(ctx.client.data.name ?? "Client");

    // With no range given, the plan covers whatever is actually there. Both
    // the document and its filename say so, rather than reading "start-to-end".
    const from = start ?? slots[0]?.date ?? "";
    const to = end ?? slots[slots.length - 1]?.date ?? "";

    const pdf = await renderPlanPdf(slots, {
      clientName,
      timezone: String(ctx.client.data.timezone ?? "UTC"),
      start: from,
      end: to,
    });

    const filename = planFilename(clientName, from, to).replace(/\.md$/, ".pdf");

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // The plan is client-confidential; never let a proxy hold a copy.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return serverError("Plan PDF error", error);
  }
}
