import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const ENTRY = resolve(ROOT, "index.ts");

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
      file === ENTRY || file.startsWith(`${ROOT}${sep}`),
      true,
      `presentation import escaped its runtime boundary: ${file}`,
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

test("presentation runtime closure is Edge-neutral, deterministic, and read-only", () => {
  const closure = productionClosure();
  assert.equal(closure.has(ENTRY), true);
  const combined = [...closure.values()].join("\n");

  for (const [file, source] of closure) {
    for (
      const prohibited of [
        "node:",
        "process",
        "Buffer",
        "Deno",
        "@supabase",
        "createClient",
        "globalThis.fetch",
        "globalThis.crypto",
        "Date.now",
        "Math.random",
        "randomUUID",
        "affiliate-sync-core",
        "src/",
        "@/",
      ]
    ) {
      assert.equal(
        source.includes(prohibited),
        false,
        `${file}: ${prohibited}`,
      );
    }
    assert.equal(
      /\bimport\s*\(/.test(source),
      false,
      `${file}: dynamic import`,
    );
    assert.equal(
      /\.\s*(?:from|insert|update|upsert|delete|rpc)\s*\(/.test(source),
      false,
      `${file}: persistence operation`,
    );
  }
  assert.equal(/\bfetch\s*\(/.test(combined), false);
  assert.equal(/\bcrypto\b/.test(combined), false);
  assert.equal(
    /authorization|service[_-]?role|database/i.test(combined),
    false,
  );
});
