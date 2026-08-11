import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(process.cwd());
const ENTRY = join(ROOT, "supabase/functions/affiliate-sync-preview/import-boundary.ts");
const FORBIDDEN = [
  "ImportExecutor", "import_apply", "ImportLogger", "logo-sync", "affiliate_import_runs",
  "publishing_rotation_state", "logger.server", ".server", "client.server",
];

function resolveSource(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(ROOT, "src", specifier.slice(2)) : resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((candidate) => {
    try { return readFileSync(candidate, "utf8"), true; } catch { return false; }
  }) ?? null;
}

function importsOf(source: string): string[] {
  const matched = source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g);
  return [...matched].map((match) => match[1]);
}

test("Edge preview direct source graph excludes mutation and server-only dependencies", () => {
  const pending = [ENTRY];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of importsOf(source)) {
      for (const forbidden of FORBIDDEN) assert.equal(specifier.includes(forbidden), false, `${file} imports ${forbidden}`);
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const next = resolveSource(file, specifier);
      if (next) pending.push(next);
    }
  }
  assert.ok(visited.size > 10, "the test must traverse the shared preview graph");
});

test("Edge endpoint and read boundary contain no mutation call", () => {
  const source = [
    readFileSync(join(ROOT, "supabase/functions/affiliate-sync-preview/index.ts"), "utf8"),
    readFileSync(join(ROOT, "supabase/functions/affiliate-sync-preview/read-model.ts"), "utf8"),
  ].join("\n");
  for (const mutation of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert.equal(source.includes(mutation), false, `Edge preview contains ${mutation}`);
  }
});
