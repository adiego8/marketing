/**
 * Dry-run the research pipeline against a real client. Reads Firestore, calls
 * the model, WRITES NOTHING.
 *
 * Usage: npx tsx scripts/research-dry-run.ts <clientId>
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const clientId = process.argv[2];
  if (!clientId) throw new Error("Pass a clientId.");

  const { db, COLLECTIONS } = await import("../lib/firestore");
  const { researchClient } = await import("../lib/marketing/research/run");

  const snap = await db().collection(COLLECTIONS.clients).doc(clientId).get();
  if (!snap.exists) throw new Error(`No client ${clientId}`);
  const d = snap.data() ?? {};

  console.log(`Researching ${d.name} (${d.websiteUrl ?? "no website"})…\n`);
  const r = await researchClient({
    name: String(d.name ?? ""),
    website_url: d.websiteUrl ?? null,
    description: d.description ?? null,
  });

  console.log("status:      ", r.status);
  console.log("searches:    ", r.llm.searches, `(${Math.round(r.llm.duration_ms / 1000)}s, ${r.llm.model})`);
  console.log("sources:     ", r.sources.length);
  r.sources.forEach((s) => console.log("   ", s));
  console.log("\nwarnings:");
  r.warnings.forEach((w) => console.log("   -", w));
  console.log("\ncompany:     ", (r.dossier.company.description || "").slice(0, 160));
  console.log("competitors: ", r.dossier.competitors.map((c) => c.name).join(", ") || "(none)");
  console.log("gaps:        ", r.dossier.gaps.length);
  console.log("\nEVIDENCE (claim -> source):");
  r.dossier.evidence.forEach((e) => console.log(`   - ${e.claim}\n       ${e.source}`));
  const m = r.draft_strategy.messaging as Record<string, unknown>;
  const p = r.draft_strategy.positioning as Record<string, { statement?: string }>;
  console.log("\nDRAFT");
  console.log("  tagline:      ", m.tagline);
  console.log("  primary angle:", p.primary_angle?.statement);
  console.log("  proof points: ", JSON.stringify(m.proof_points));
  console.log("  pillars:      ", JSON.stringify((r.draft_strategy.content_strategy as Record<string, unknown>).content_pillars));
  console.log("  quota:        ", JSON.stringify(r.draft_strategy.content_quota.weekly));
  console.log("\nOPEN QUESTIONS:");
  r.open_questions.forEach((q) => console.log("   -", q));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
