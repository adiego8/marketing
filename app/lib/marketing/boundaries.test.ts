import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname, resolve, relative } from "path";

// Nothing the browser loads may reach firebase-admin.
//
// This is a real failure that happened rather than a hypothetical. Moving the
// OpenAI key out of env gave llm.ts a Firestore import; llm.ts was already
// reachable from a client page through copy.ts → planner/decide.ts, which
// copy.ts imported only for two four-line string helpers. The slot page
// therefore imported firebase-admin, firebase-admin wants child_process, and
// the production build failed with sixty module-not-found errors.
//
// Typecheck did not catch it and no unit test did either: every module was
// individually correct. The only thing that noticed was `next build`, which is
// slow and easy to skip. So the boundary is asserted here, where it costs a
// few milliseconds.

const ROOT = resolve(__dirname, "../..");
const SERVER_ONLY = ["lib/firebase-admin", "lib/firestore"];

/** Every file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** The local modules a file imports, resolved to real paths. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs = [...src.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/gm)].map(
    (m) => m[1]
  );
  const out: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith("@/")
      ? join(ROOT, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : null;
    if (!base) continue; // a package, not ours
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/** The first path from `file` to a server-only module, or null. */
function pathToServerOnly(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const rel = relative(ROOT, file).replace(/\.tsx?$/, "");
  if (SERVER_ONLY.includes(rel)) return [rel];
  for (const next of importsOf(file)) {
    const found = pathToServerOnly(next, seen);
    if (found) return [relative(ROOT, file), ...found];
  }
  return null;
}

const CLIENT_FILES = walk(join(ROOT, "app"))
  .concat(walk(join(ROOT, "components")))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
  .filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));

describe("the client bundle", () => {
  it("found some client components to check", () => {
    // A boundary test that silently checks nothing is worse than none.
    expect(CLIENT_FILES.length).toBeGreaterThan(5);
  });

  it("never reaches firebase-admin, however many hops away", () => {
    const offenders = CLIENT_FILES.map((f) => pathToServerOnly(f)).filter(Boolean) as string[][];
    // Printed as the whole chain, because the useful part of this failure is
    // never the endpoint — it is the one edge in the middle that should not
    // exist, the way copy.ts → planner/decide.ts should not have.
    expect(offenders.map((chain) => chain.join("\n  → "))).toEqual([]);
  });
});
