import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const CORE = resolve(process.cwd(), "supabase/functions/_shared/affiliate-sync-v2");
const FORBIDDEN = [
  "supabase", "ImportExecutor", "node:", "process", "Buffer", "client.server",
  "decrypt", "crypto", "fs", "database", "affiliate-sync-core",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

test("V2 core is isolated, relative-only, and has no persistence boundary", () => {
  for (const file of sourceFiles(CORE)) {
    const source = readFileSync(file, "utf8");
    for (const term of FORBIDDEN) {
      assert.equal(source.toLowerCase().includes(term.toLowerCase()), false, `${file} contains ${term}`);
    }
    for (const specifier of importsOf(source)) {
      assert.equal(specifier.startsWith("."), true, `${file} has non-relative import ${specifier}`);
      assert.equal(specifier.endsWith(".ts"), true, `${file} omits .ts from ${specifier}`);
    }
    assert.equal(/\bimport\s*\(/.test(source), false, `${file} has a dynamic dependency`);
    assert.equal(/\bfetch\s*\(/.test(source), false, `${file} makes a network request`);
    assert.equal(/authorization|basic\s+auth|service[_-]?role/i.test(source), false, `${file} handles host secrets`);
    assert.equal(/\.(?:from|insert|update|upsert|delete|rpc)\s*\(/i.test(source), false, `${file} has a data mutation path`);
    assert.equal(dirname(file).startsWith(CORE), true, `${file} escaped V2 core`);
  }
});

test("pure preview planning has no provider-request boundary", () => {
  const source = readFileSync(join(CORE, "PreviewPlanner.ts"), "utf8");
  for (const term of ["ImpactClientV2", "ImpactTransport", "ImpactFetchOrchestrator", ".execute(", ".wait("]) {
    assert.equal(source.includes(term), false, `PreviewPlanner.ts contains ${term}`);
  }
});

test("A9B persistence planning has no host, V1, clock, random, or hashing boundary", () => {
  const source = readFileSync(join(CORE, "PersistencePlannerV2.ts"), "utf8");
  for (const term of [
    "EntityMatcher",
    "DuplicateResolver",
    "ImportPlanner",
    "StoreLifecyclePlanner",
    "affiliate-sync-core",
    "Date.now",
    "Math.random",
    "randomUUID",
    "subtle.digest",
    "createHash",
    ".server",
  ]) {
    assert.equal(source.includes(term), false, `PersistencePlannerV2.ts contains ${term}`);
  }
  assert.deepEqual(importsOf(source).every((specifier) =>
    specifier.startsWith(".") && specifier.endsWith(".ts")), true);
});
