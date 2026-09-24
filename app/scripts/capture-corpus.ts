/**
 * Freeze real generated copy into a fixture the scorers can be measured over.
 *
 * Reads Firestore, WRITES NOTHING to it, and makes NO model call — everything
 * here has already been generated and paid for once. Same shape as
 * research-dry-run.ts: dotenv first, app modules imported dynamically after.
 *
 *   npx tsx scripts/capture-corpus.ts [--client <id>] [--limit <n>]
 *
 * The output is committed. It is real client copy, so every piece carries its
 * client_id and slot_id: a client who should not be in here can be filtered
 * out later by id rather than found by eye.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";

config({ path: resolve(process.cwd(), ".env.local") });

/** Only what the checks actually read. A whole Slot would be noise in a diff. */
interface CorpusPiece {
  slot_id: string;
  client_id: string;
  type: string;
  channel: string;
  cta: string;
  content: Record<string, unknown>;
}

/** The three sections brand.ts reads, stored once per client rather than per piece. */
interface CorpusClient {
  content_strategy: Record<string, unknown>;
  voice: Record<string, unknown>;
  messaging: Record<string, unknown>;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const clientFilter = flag("client");
  const limit = Number(flag("limit") ?? 40);
  // No orderBy: combined with the client filter it would want a composite
  // index, and this is a one-off capture rather than a query path.
  const scan = Math.max(limit * 5, 200);

  const { db, COLLECTIONS, serializeSlot, serializeStrategy } = await import("../lib/firestore");

  let query = db().collection(COLLECTIONS.slots).limit(scan);
  if (clientFilter) query = query.where("clientId", "==", clientFilter) as typeof query;

  const snap = await query.get();
  console.log(`Scanned ${snap.size} slot(s)${clientFilter ? ` for ${clientFilter}` : ""}.`);

  const pieces: CorpusPiece[] = [];
  for (const doc of snap.docs) {
    const slot = serializeSlot(doc.id, doc.data());
    // Written copy only. A planned slot has a brief and nothing to score.
    if (!slot.content || !slot.client_id) continue;
    pieces.push({
      slot_id: slot.id,
      client_id: slot.client_id,
      type: slot.type,
      channel: slot.channel,
      cta: slot.cta,
      content: slot.content as Record<string, unknown>,
    });
    if (pieces.length >= limit) break;
  }

  const clients: Record<string, CorpusClient> = {};
  for (const clientId of new Set(pieces.map((p) => p.client_id))) {
    const doc = await db().collection(COLLECTIONS.strategies).doc(clientId).get();
    const s = serializeStrategy(clientId, doc.data() ?? {});
    clients[clientId] = {
      content_strategy: s.content_strategy as Record<string, unknown>,
      voice: s.voice as Record<string, unknown>,
      messaging: s.messaging as Record<string, unknown>,
    };
  }

  const out = resolve(process.cwd(), "lib/marketing/__fixtures__");
  mkdirSync(out, { recursive: true });
  const file = resolve(out, "corpus.json");
  writeFileSync(
    file,
    // Sorted by id so a re-capture that finds the same pieces produces the same
    // file, and a diff shows what changed rather than what moved.
    `${JSON.stringify(
      {
        captured_at: new Date().toISOString().slice(0, 10),
        clients,
        pieces: pieces.sort((a, b) => a.slot_id.localeCompare(b.slot_id)),
      },
      null,
      2
    )}\n`
  );

  console.log(`Captured ${pieces.length} written piece(s) from ${Object.keys(clients).length} client(s).`);
  for (const [id, c] of Object.entries(clients)) {
    const language = (c.content_strategy?.language as { name?: string } | undefined)?.name;
    const n = pieces.filter((p) => p.client_id === id).length;
    console.log(`   ${id}: ${n} piece(s), language ${language ?? "(unset)"}`);
  }
  console.log(`\nWrote ${file}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
