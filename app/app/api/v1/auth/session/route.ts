import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  verifyToken,
  ensureMember,
  isAuthConfigured,
  AUTH_NOT_CONFIGURED,
} from "@/lib/auth";
import { jsonError, serverError } from "@/lib/marketing/route-helpers";

// POST /api/v1/auth/session
// Called by the browser on every ID-token change. Verifies the token and
// resolves marketing membership, bootstrapping the first user as agency admin.
//
// A valid Firebase token is not sufficient for access: the project is shared
// with numerico-website, so this returns 403 for a real numerico user who has
// no membership here.
export async function POST() {
  try {
    // This is the route the login screen surfaces errors from, so it is the
    // one place a missing service account most needs to name itself rather
    // than read as "your sign-in was rejected".
    if (!isAuthConfigured()) return jsonError(AUTH_NOT_CONFIGURED, 503);

    const headersList = await headers();
    const decoded = await verifyToken(headersList.get("authorization"));
    if (!decoded) return jsonError("Unauthorized", 401);

    const session = await ensureMember(decoded);
    if (!session) {
      return jsonError(
        "This account does not have access to the marketing agent.",
        403
      );
    }

    return NextResponse.json({
      user_email: session.email ?? "",
      agency_id: session.agencyId,
      role: session.role,
    });
  } catch (error) {
    return serverError("Auth session error", error);
  }
}
