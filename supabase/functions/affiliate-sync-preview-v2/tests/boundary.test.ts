import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const SUPABASE_ROOT = resolve(ROOT, "supabase");
const ENTRY = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-preview-v2/index.ts",
);
const HOST_ROOT = resolve(ROOT, "supabase/functions/affiliate-sync-preview-v2");

function importsOf(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ]
    .map((match) => match[1]!);
}

test("deployable V2 host local import closure stays under supabase and fully resolves", () => {
  const pending = [ENTRY];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    assert.equal(
      file.startsWith(`${SUPABASE_ROOT}${sep}`),
      true,
      `outside supabase: ${file}`,
    );
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("src/"), false, `${file} imports src/`);
    assert.equal(source.includes("@/"), false, `${file} imports @/`);
    assert.equal(source.includes(".server"), false, `${file} imports .server`);
    assert.equal(source.includes("node:"), false, `${file} imports Node`);
    for (const specifier of importsOf(source)) {
      if (specifier.startsWith("https://")) continue;
      assert.equal(
        specifier.startsWith("."),
        true,
        `${file} has unsupported import ${specifier}`,
      );
      assert.equal(
        specifier.endsWith(".ts"),
        true,
        `${file} lacks explicit .ts: ${specifier}`,
      );
      const next = resolve(dirname(file), specifier);
      readFileSync(next, "utf8");
      pending.push(next);
    }
  }
  assert.equal(
    visited.has(
      resolve(
        ROOT,
        "supabase/functions/_shared/affiliate-sync-v2/PreviewPlanner.ts",
      ),
    ),
    true,
  );
  assert.equal(
    visited.has(resolve(ROOT, "supabase/functions/_shared/edge-supabase.ts")),
    true,
  );
  assert.ok(
    visited.size > 15,
    "closure audit must traverse the V2 core and host security boundary",
  );
});

test("V2 host invocation closure contains no write path", () => {
  const files = [
    "index.ts",
    "handler.ts",
    "supabase-read-boundary.ts",
    "catalog-snapshot.ts",
    "impact-configuration.ts",
    "ImpactTransportHost.ts",
    "types.ts",
  ];
  const source = files.map((file) =>
    readFileSync(resolve(HOST_ROOT, file), "utf8")
  ).join("\n");
  for (
    const prohibited of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      "ImportExecutor",
      "import_apply",
      "affiliate_import_runs",
      "publishing_rotation_state",
      "request_log",
      "lifecycle_managed",
    ]
  ) {
    assert.equal(
      source.includes(prohibited),
      false,
      `host contains prohibited ${prohibited}`,
    );
  }
  for (
    const allowedTable of [
      "user_roles",
      "affiliate_integrations",
      "affiliate_integration_credentials",
      "publishing_policies",
      "stores",
      "coupons",
    ]
  ) assert.equal(source.includes(`.from(\"${allowedTable}\")`), true);
});

test("V2 host is isolated from V1 functions and production source", () => {
  const source = readFileSync(ENTRY, "utf8");
  assert.equal(source.includes("affiliate-sync-preview/"), false);
  assert.equal(source.includes("affiliate-sync-preflight"), false);
  assert.equal(source.includes("affiliate-sync-core"), false);
  assert.equal(
    source.includes("../_shared/affiliate-sync-v2/"),
    false,
    "entry delegates through isolated host modules",
  );
  const handler = readFileSync(resolve(HOST_ROOT, "handler.ts"), "utf8");
  assert.equal(handler.includes("../_shared/affiliate-sync-v2/index.ts"), true);
});
