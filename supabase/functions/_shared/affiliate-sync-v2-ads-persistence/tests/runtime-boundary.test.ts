import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";

const PERSISTENCE_ROOT = resolve(import.meta.dirname ?? ".", "..");
const SHARED_ROOT = resolve(PERSISTENCE_ROOT, "..");
const ADS_ROOT = resolve(SHARED_ROOT, "affiliate-sync-v2-ads");
const PRESENTATION_ROOT = resolve(SHARED_ROOT, "affiliate-presentation-v2");
const URL_SAFETY = resolve(
  SHARED_ROOT,
  "affiliate-sync-v2/impact-url-safety.ts",
);
const ENTRY = resolve(PERSISTENCE_ROOT, "index.ts");

function runtimeImports(source: string): string[] {
  const result: string[] = [];
  for (
    const match of source.matchAll(
      /(?:^|\n)\s*((?:import|export)\s+[^;]*?\s+from\s+|import\s*)["']([^"']+)["']\s*;/g,
    )
  ) {
    if (/^\s*import\s+type\b/.test(match[0])) continue;
    result.push(match[2]!);
  }
  return result;
}

function allowed(file: string): boolean {
  return file.startsWith(`${PERSISTENCE_ROOT}${sep}`) ||
    file.startsWith(`${ADS_ROOT}${sep}`) ||
    file.startsWith(`${PRESENTATION_ROOT}${sep}`) || file === URL_SAFETY;
}

function closure(): Map<string, string> {
  const pending = [ENTRY];
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    assert.equal(
      allowed(file),
      true,
      `runtime import escaped boundary: ${file}`,
    );
    const source = readFileSync(file, "utf8");
    visited.set(file, source);
    for (const specifier of runtimeImports(source)) {
      assert.equal(specifier.startsWith("."), true, specifier);
      assert.equal(specifier.endsWith(".ts"), true, specifier);
      const next = resolve(dirname(file), specifier);
      assert.equal(statSync(next).isFile(), true, next);
      pending.push(next);
    }
  }
  return visited;
}

test("Ads persistence planner closure is pure, Edge-safe, and V1-independent", () => {
  const files = closure();
  const combined = [...files.values()].join("\n");
  for (const [file, source] of files) {
    assert.equal(source.includes("node:"), false, file);
    assert.equal(/\bprocess\b/.test(source), false, file);
    assert.equal(/\bBuffer\b/.test(source), false, file);
    assert.equal(/\bDeno\b/.test(source), false, file);
    assert.equal(source.includes("@supabase"), false, file);
    assert.equal(source.includes("createClient"), false, file);
    assert.equal(source.includes("globalThis.fetch"), false, file);
    assert.equal(source.includes("globalThis.crypto"), false, file);
  }
  for (
    const prohibited of [
      "src/",
      "@/",
      "affiliate-sync-core",
      "runProviderSync",
      "ImportPipeline",
      "ImportExecutor",
      "public.import_apply",
      "affiliate-sync-preview",
      "affiliate-sync-apply-v2",
      ".from(",
    ]
  ) assert.equal(combined.includes(prohibited), false, prohibited);
  assert.equal(
    /\.\s*(?:insert|update|upsert|delete|rpc)\s*\(/.test(combined),
    false,
  );
});
