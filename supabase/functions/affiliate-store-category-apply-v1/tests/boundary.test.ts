import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SOURCE = "da43e96cbc4275e519458b205414004ddc766339";
const DIRECTORY = "supabase/functions/affiliate-store-category-apply-v1/";
const ADAPTER = resolve(ROOT, DIRECTORY, "supabase-canary-boundary.ts");
function closure() {
  const files = new Map<string, string>();
  const pending = [resolve(ROOT, DIRECTORY, "index.ts")];
  while (pending.length) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    assert.ok(file.startsWith(resolve(ROOT, "supabase/functions") + "/"));
    const source = readFileSync(file, "utf8");
    files.set(file, source);
    for (const match of source.matchAll(
      /(?:^|\n)\s*((?:import|export)\s+[^;]*?\s+from\s+|import\s*)["']([^"']+)["']\s*;/g,
    )) {
      if (/^\s*import\s+type\b/.test(match[0])) continue;
      const path = match[2]!;
      if (path.startsWith("https://")) {
        assert.equal(path, "https://esm.sh/@supabase/supabase-js@2.45.4");
        continue;
      }
      assert.ok(path.startsWith(".") && path.endsWith(".ts"), path);
      pending.push(resolve(dirname(file), path));
    }
  }
  return files;
}

test("entire canary runtime closure has exactly one named RPC site and no direct mutation", () => {
  let rpcSites = 0;
  for (const [file, source] of closure()) {
    assert.doesNotMatch(source, /\.\s*(insert|update|upsert|delete)\s*\(/, file);
    assert.doesNotMatch(source, /\[\s*["'](?:insert|update|upsert|delete|rpc)["']\s*\]\s*\(/, file);
    assert.doesNotMatch(source, /\bimport\s*\(/, file);
    const rpcs = source.match(/\.\s*rpc\s*\(/g) ?? [];
    rpcSites += rpcs.length;
    if (rpcs.length) {
      assert.equal(file, ADAPTER);
      assert.equal(rpcs.length, 1);
      assert.match(source, /\.rpc\("apply_affiliate_store_category_canary_v1",/);
    }
    for (const forbidden of [
      "import_apply",
      "ImportExecutor",
      "affiliate-sync-v2-ads-persistence",
      "affiliate-sync-ads-apply-v2",
      "affiliate_import_runs",
      "affiliate_import_run_mutations",
      "provider-managed-state",
      "node:",
      "console.",
    ])
      assert.equal(source.includes(forbidden), false, `${file}: ${forbidden}`);
    assert.doesNotMatch(source, /\bfrom\s*\(\s*["']coupons["']/i, file);
  }
  assert.equal(rpcSites, 1);
});

test("closure reads only the six permitted tables through bounded category reader", () => {
  const reader = resolve(
    ROOT,
    "supabase/functions/affiliate-store-category-preview-v1/supabase-read-boundary.ts",
  );
  const files = closure();
  assert.ok(files.has(reader));
  const source = files.get(reader)!;
  const literalTables = [...source.matchAll(/\.from\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(literalTables.sort(), [
    "affiliate_integration_credentials",
    "affiliate_integrations",
    "user_roles",
  ]);
  assert.match(source, /table: "stores" \| "categories" \| "affiliate_store_category_mappings"/);
  for (const [file, text] of files) {
    for (const match of text.matchAll(/([\w.]+)\.from\(/g)) {
      if (["Array", "Uint8Array"].includes(match[1]!)) continue;
      assert.equal(file, reader, file);
      assert.equal(match[1], "this.db");
    }
  }
  assert.doesNotMatch(
    files.get(resolve(ROOT, DIRECTORY, "handler.ts"))!,
    /EdgeClient|createPrivilegedEdgeClient|\.rpc\(|\.from\(/,
  );
});

test("canary selector remains pure with existing planner and identity normalization only", () => {
  const source = readFileSync(resolve(ROOT, DIRECTORY, "canary-selection.ts"), "utf8");
  assert.match(source, /planStoreCategories\(input\)/);
  for (const forbidden of [
    "fetch(",
    "Deno.",
    "supabase",
    "credential",
    ".from(",
    ".rpc(",
    "coupon",
    "AdvertiserId",
    "localeCompare",
  ])
    assert.equal(source.includes(forbidden), false, forbidden);
  const files = closure();
  assert.ok(
    files.has(resolve(ROOT, "supabase/functions/_shared/affiliate-sync-v2-ads/ad-models.ts")),
  );
  assert.equal(
    files.has(resolve(ROOT, "supabase/functions/affiliate-sync-ads-preview-v2/handler.ts")),
    false,
  );
  assert.equal(
    files.has(resolve(ROOT, "supabase/functions/affiliate-store-category-preview-v1/handler.ts")),
    false,
  );
});

test("A1.1 category foundation and preview runtime are byte-identical to approved source", () => {
  const paths = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      SOURCE,
      "supabase/functions/_shared/affiliate-store-category-v1",
      "supabase/functions/affiliate-store-category-preview-v1",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of paths) {
    if (path.endsWith("affiliate-store-category-preview-v1/tests/boundary.test.ts")) continue;
    assert.deepEqual(
      readFileSync(resolve(ROOT, path)),
      execFileSync("git", ["show", `${SOURCE}:${path}`], { cwd: ROOT }),
      path,
    );
  }
  const path = "supabase/functions/affiliate-store-category-preview-v1/tests/boundary.test.ts";
  const original = execFileSync("git", ["show", `${SOURCE}:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const now = readFileSync(resolve(ROOT, path), "utf8")
    .replace(
      '        path === "supabase/migrations/20261002130000_affiliate_store_category_canary_apply.sql" ||\n',
      "",
    )
    .replace(
      '        path.startsWith("supabase/functions/affiliate-store-category-apply-v1/") ||\n',
      "",
    );
  assert.equal(now, original, "Only the explicitly authorized allowlist extension may change");
});

test("new function config authenticates via Supabase Auth; all existing config stays unchanged", () => {
  const path = "supabase/config.toml";
  const original = execFileSync("git", ["show", `${SOURCE}:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const config = readFileSync(resolve(ROOT, path), "utf8");
  assert.match(
    config,
    /\[functions\.affiliate-store-category-apply-v1\]\s*\n#[^\n]*\nverify_jwt = false/,
  );
  assert.equal(
    config.replace(
      /\n\[functions\.affiliate-store-category-apply-v1\]\n#[^\n]*\nverify_jwt = false\n/,
      "",
    ),
    original,
  );
  const index = readFileSync(resolve(ROOT, DIRECTORY, "index.ts"), "utf8");
  assert.match(index, /auth\.getUser\(jwt\)/);
});

test("diff from exact source is restricted to A2 and authorized regression allowlist", () => {
  const paths = execFileSync("git", ["diff", "--name-only", SOURCE], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of paths)
    assert.ok(
      path.startsWith(DIRECTORY) ||
        path === "supabase/config.toml" ||
        path === "supabase/migrations/20261002130000_affiliate_store_category_canary_apply.sql" ||
        path === "supabase/functions/affiliate-store-category-preview-v1/tests/boundary.test.ts" ||
        path === "docs/checkpoints/p1c-a2-category-canary-apply.md",
      path,
    );
});
