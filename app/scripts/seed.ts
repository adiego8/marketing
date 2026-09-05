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
 * Unlike the Python seed, this writes a POPULATED content quota. An empty quota
 * makes the planner produce nothing, which reads as a broken planner rather
 * than as missing configuration.
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

  const existing = await db().collection(COLLECTIONS.agencies).limit(1).get();
  if (!existing.empty) {
    console.log(`Agency already exists (${existing.docs[0].id}). Nothing to do.`);
    return;
  }

  const agencyRef = db().collection(COLLECTIONS.agencies).doc();
  await agencyRef.set({
    name: email ? `${email.split("@")[0]}'s agency` : "My agency",
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`Agency:  ${agencyRef.id}`);

  if (uid) {
    await db().collection(COLLECTIONS.members).doc(uid).set({
      agencyId: agencyRef.id,
      email: email ?? null,
      name: null,
      role: "admin",
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`Member:  ${uid} (admin)`);
  } else {
    console.log("Member:  none — the first user to sign in claims this agency.");
  }

  const clientRef = db().collection(COLLECTIONS.clients).doc();
  await clientRef.set({
    agencyId: agencyRef.id,
    name: "Example Client",
    websiteUrl: null,
    logoUrl: null,
    description: "Seeded client. Edit or delete.",
    contactEmail: null,
    contactPhone: null,
    timezone: "America/New_York",
    branding: null,
    status: "active",
    researchStatus: null,
    research: null,
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
      demographics: {},
      pain_points: [],
      goals: [],
    },
    voice: {
      personality: "Define your brand personality",
      traits: [],
      words_to_use: [],
      words_to_avoid: [
        "revolutionary",
        "game-changing",
        "crushing it",
        "leverage",
        "synergy",
        "unlock your potential",
      ],
      tone: "conversational, direct, practical",
    },
    positioning: { angles: [], anti_positioning: "" },
    messaging: { value_props: [], key_messages: [], tagline: "" },
    goals: { primary: "awareness", secondary: "leads", metrics: [] },
    contentStrategy: { platforms: [], content_pillars: [] },
    contentQuota: {
      weekly: {
        post: { count: 3, channels: ["linkedin"] },
        hook: { count: 2, channels: ["linkedin", "twitter"] },
        cta: { count: 1, channels: ["linkedin"] },
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
