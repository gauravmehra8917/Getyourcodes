import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";

const CORE_ROOT = resolve(import.meta.dirname ?? ".", "..");
const SHARED_ROOT = resolve(CORE_ROOT, "..");
const ENTRY = resolve(CORE_ROOT, "index.ts");
const GENERIC_URL_SAFETY = resolve(
  SHARED_ROOT,
  "affiliate-sync-v2/impact-url-safety.ts",
);

function runtimeImportsOf(source: string): string[] {
  const imports: string[] = [];
  for (
    const match of source.matchAll(
      /(?:^|\n)\s*((?:import|export)\s+[^;]*?\s+from\s+|import\s*)["']([^"']+)["']\s*;/g,
    )
  ) {
    if (/^\s*import\s+type\b/.test(match[0])) continue;
    imports.push(match[2]!);
  }
  return imports;
}

function productionClosure(): Map<string, string> {
  const pending = [ENTRY];
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    assert.equal(
      file.startsWith(`${CORE_ROOT}${sep}`) || file === GENERIC_URL_SAFETY,
      true,
      `Ads core import escaped its approved runtime boundary: ${file}`,
    );
    const source = readFileSync(file, "utf8");
    visited.set(file, source);
    for (const specifier of runtimeImportsOf(source)) {
      assert.equal(specifier.startsWith("."), true, specifier);
      assert.equal(specifier.endsWith(".ts"), true, specifier);
      const next = resolve(dirname(file), specifier);
      assert.equal(statSync(next).isFile(), true, `missing module: ${next}`);
      pending.push(next);
    }
  }
  return visited;
}

test("Ads core runtime closure is neutral, Deno-safe, and provider-only", () => {
  const closure = productionClosure();
  assert.equal(closure.has(ENTRY), true);
  assert.equal(closure.has(GENERIC_URL_SAFETY), true);
  const combined = [...closure.values()].join("\n");

  for (const [file, source] of closure) {
    assert.equal(source.includes("node:"), false, `${file} imports Node`);
    assert.equal(/\bprocess\b/.test(source), false, `${file} uses process`);
    assert.equal(/\bBuffer\b/.test(source), false, `${file} uses Buffer`);
    assert.equal(/\bDeno\b/.test(source), false, `${file} uses Deno host APIs`);
    assert.equal(
      /\bimport\s*\(/.test(source),
      false,
      `${file} imports dynamically`,
    );
    assert.equal(
      source.includes("@supabase"),
      false,
      `${file} imports Supabase`,
    );
    assert.equal(
      source.includes("createClient"),
      false,
      `${file} creates a client`,
    );
    assert.equal(
      source.includes("globalThis.fetch"),
      false,
      `${file} uses global fetch`,
    );
    assert.equal(
      source.includes("globalThis.crypto"),
      false,
      `${file} uses crypto`,
    );
  }

  for (
    const prohibited of [
      ".from(",
      "PersistencePlannerV2",
      "apply_affiliate_persistence_plan_v2",
      "ImportExecutor",
      "affiliate-sync-source-audit-v2",
      "affiliate-sync-preview-v2",
      "affiliate-sync-apply-v2",
      "affiliate-sync-core",
      "src/",
      "@/",
    ]
  ) assert.equal(combined.includes(prohibited), false, prohibited);
  for (
    const mutation of [
      /\.\s*(?:insert|update|upsert|delete|rpc)\s*\(/,
      /\[\s*["'](?:insert|update|upsert|delete|rpc)["']\s*\]\s*\(/,
    ]
  ) assert.equal(mutation.test(combined), false, String(mutation));
});
