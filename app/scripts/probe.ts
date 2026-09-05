/**
 * Connectivity probe: proves the Admin SDK credentials, network path and
 * Firestore permissions actually work. Read-only.
 *
 *   npx tsx scripts/probe.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { adminAuth, adminDb, numericoDb } = await import("../lib/firebase-admin");
  console.log("adminAuth  :", adminAuth ? "initialised" : "UNDEFINED");
  console.log("adminDb    :", adminDb ? "initialised" : "UNDEFINED");
  console.log("numericoDb :", numericoDb ? "initialised" : "UNDEFINED");
  if (!adminDb || !numericoDb) return;

  // The instance's own databaseId, not the env var it was built from: this is
  // the only thing that distinguishes "reading the marketing database" from
  // "silently fell back to (default)".
  console.log("wanted     :", process.env.FIREBASE_DATABASE_ID || "(default)");
  console.log("adminDb  ->:", adminDb.databaseId);
  console.log("numericoDb>:", numericoDb.databaseId);
  console.log("separated  :", adminDb !== numericoDb ? "yes" : "NO - same instance");

  const { COLLECTIONS } = await import("../lib/firestore");
  for (const name of [COLLECTIONS.agencies, COLLECTIONS.members, COLLECTIONS.clients]) {
    const snap = await adminDb.collection(name).limit(1).get();
    console.log(`  ${name}: reachable, ${snap.size} doc(s)`);
  }

  // The website's own data, through the (default) handle the entitlement seam
  // will eventually read.
  const customers = await numericoDb.collection("customers").limit(1).get();
  console.log(`  customers (numerico-website): ${customers.size} doc(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
