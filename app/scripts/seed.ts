/**
 * Seeds one agency, one client, and a usable strategy.
 *
 * Usage:
 *   npm run seed -- --email you@example.com [--uid <firebase-uid>]
 *
 * Pass --uid to bind an existing Firebase account as the agency admin. Without
 * it the agency is created but has no members, and the first person to sign in
 * claims it (see ensureMember in lib/auth.ts).
 *
 * It writes a populated content quota, which now paces SCHEDULING rather than
 * generation — an empty one is workable. What the planner actually needs is an
 * active campaign with a content plan: with none it refuses to run, because a
 * campaign's plan is the demand.
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf("--email");
  const uidIdx = args.indexOf("--uid");
  const email = emailIdx >= 0 ? args[emailIdx + 1] : null;
  const uid = uidIdx >= 0 ? args[uidIdx + 1] : null;

  // Imported after dotenv so the Admin SDK sees the credentials.
  const { db, COLLECTIONS, FieldValue } = await import("../lib/firestore");

  // Attach to the agency that already exists rather than refusing. The common
  // case is seeding AFTER signing in, when sign-in has already created the
  // agency and made you its admin — refusing there would mean the seed could
  // never add test data.
  const existing = await db().collection(COLLECTIONS.agencies).limit(1).get();
  let agencyId: string;

  if (!existing.empty) {
    agencyId = existing.docs[0].id;
    console.log(`Agency:  ${agencyId} (existing)`);
  } else {
    const agencyRef = db().collection(COLLECTIONS.agencies).doc();
    await agencyRef.set({
      name: email ? `${email.split("@")[0]}'s agency` : "My agency",
      createdAt: FieldValue.serverTimestamp(),
    });
    agencyId = agencyRef.id;
    console.log(`Agency:  ${agencyId} (created)`);
  }

  if (uid) {
    await db().collection(COLLECTIONS.members).doc(uid).set({
      agencyId,
      email: email ?? null,
      name: null,
      role: "admin",
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`Member:  ${uid} (admin)`);
  } else {
    const members = await db().collection(COLLECTIONS.members).limit(1).get();
    console.log(
      members.empty
        ? "Member:  none yet — the first user to sign in claims this agency as admin."
        : "Member:  left as is."
    );
  }

  const clientRef = db().collection(COLLECTIONS.clients).doc();
  await clientRef.set({
    agencyId,
    name: "Example Client",
    websiteUrl: null,
    logoUrl: null,
    description: "Seeded client. Edit or delete.",
    contactEmail: null,
    contactPhone: null,
    timezone: "America/New_York",
    branding: null,
    status: "active",
    googleCalendarId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Client:  ${clientRef.id}`);

  await db().collection(COLLECTIONS.strategies).doc(clientRef.id).set({
    clientId: clientRef.id,
    businessName: "Example Client",
    icp: {
      description: "Define your ideal customer profile",
      // Every key DEMOGRAPHIC_FIELDS renders, so the ICP tab opens with a form
      // rather than a blank grid the operator has to guess the shape of.
      demographics: {
        customer_type: "",
        industry: "",
        role: "",
        location: "",
        age_range: "",
        language: "",
        company_size: "",
        income_or_revenue: "",
      },
      pain_points: [],
      desired_outcomes: [],
      objections: [],
      trigger_events: [],
    },
    voice: {
      personality: "Define your brand personality",
      traits: [],
      tone: "conversational, direct, practical",
      communication_style: "",
      words_to_use: [],
      words_to_avoid: [
        "revolutionary",
        "game-changing",
        "crushing it",
        "leverage",
        "synergy",
        "unlock your potential",
      ],
    },
    // primary_angle / secondary_angles, NOT the `angles` this used to seed —
    // nothing has ever read `angles`, so the seeded positioning was invisible
    // in the editor.
    positioning: {
      primary_angle: { type: "", statement: "", why: "" },
      secondary_angles: [],
      anti_positioning: "",
      differentiation: "",
    },
    messaging: { tagline: "", value_props: [], key_messages: [], proof_points: [] },
    goals: { primary: "awareness", secondary: "leads", focus_90_days: "", metrics: [] },
    contentStrategy: { platforms: [], content_pillars: [] },
    // Publishable formats only. This used to seed `hook` and `cta`, which are
    // retired (see content-types.ts) — the quota table flags them and tells you
    // to delete the row, so the seed was writing rows to be undone.
    contentQuota: {
      weekly: {
        post: { count: 3, channels: ["linkedin"] },
        carousel: { count: 1, channels: ["linkedin", "instagram"] },
        newsletter: { count: 1, channels: ["email"] },
      },
      rationale: "Seeded default. Adjust in Strategy > Content Quota.",
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log("Strategy: seeded with a populated weekly quota.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
