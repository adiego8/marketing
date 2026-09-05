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
  console.log("database   :", process.env.FIREBASE_DATABASE_ID || "(default)");
  if (!adminDb || !numericoDb) return;

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
