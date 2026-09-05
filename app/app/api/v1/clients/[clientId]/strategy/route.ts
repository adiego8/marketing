import { NextResponse } from "next/server";
import { getStrategy, upsertStrategy, parseStrategyInput } from "@/lib/marketing/strategy";
import {
  requireClient,
  jsonError,
  serverError,
  readBody,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

// GET /api/v1/clients/[clientId]/strategy
// 404 with this exact message when unset — the onboarding UI branches on it.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const strategy = await getStrategy(clientId);
    if (!strategy) return jsonError("No strategy configured", 404);

    return NextResponse.json(strategy);
  } catch (error) {
    return serverError("Get strategy error", error);
  }
}

// PUT /api/v1/clients/[clientId]/strategy
// An upsert that merges: absent keys are left untouched. Returns 200 for both
// create and update, matching the Python.
export async function PUT(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const existing = await getStrategy(clientId);
    const parsed = parseStrategyInput(await readBody(request), existing === null);
    if ("error" in parsed) return jsonError(parsed.error, 400);

    return NextResponse.json(await upsertStrategy(clientId, parsed.data));
  } catch (error) {
    return serverError("Update strategy error", error);
  }
}
