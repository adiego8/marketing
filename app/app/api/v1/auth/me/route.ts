import { NextResponse } from "next/server";
import { db, COLLECTIONS } from "@/lib/firestore";
import { requireSession, jsonError, serverError } from "@/lib/marketing/route-helpers";
import { isAgencyOwner } from "@/lib/auth";

// GET /api/v1/auth/me
// Keeps the response shape the frontend already reads, but google_connected now
// reports ONLY whether Google Calendar is linked. It no longer gates sign-in —
// the Python version fused the two, so a signed-in user without a Calendar
// grant was bounced to /login.
export async function GET() {
  try {
    const auth = await requireSession();
    if ("response" in auth) return auth.response;

    const agencySnap = await db()
      .collection(COLLECTIONS.agencies)
      .doc(auth.session.agencyId)
      .get();
    if (!agencySnap.exists) return jsonError("Agency not found", 404);
    // This document was already being fetched and its data thrown away, so the
    // owner flag costs nothing. It decides whether the install-wide Model card
    // renders; requireOwner on the route is the gate that actually holds.
    const owner = isAgencyOwner(agencySnap.data(), auth.session.uid);

    const credSnap = await db()
      .collection(COLLECTIONS.googleCredentials)
      .doc(auth.session.uid)
      .get();

    return NextResponse.json({
      user_email: auth.session.email ?? "",
      agency_id: auth.session.agencyId,
      role: auth.session.role,
      owner,
      google_connected: credSnap.exists,
    });
  } catch (error) {
    return serverError("Auth me error", error);
  }
}
