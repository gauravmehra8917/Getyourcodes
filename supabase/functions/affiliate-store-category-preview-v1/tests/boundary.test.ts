import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BASE = "199498695fd7edbd05fb10b875f0a0a7aaad023c";
const CHECKPOINT = "fd6bb87715184c043868b1d340ac9bcd853e9b8c";
const ENTRY = resolve(ROOT, "supabase/functions/affiliate-store-category-preview-v1/index.ts");
const MIGRATION = "supabase/migrations/20261002120000_affiliate_store_category_mappings.sql";

function closure() {
  const files = new Map<string, string>();
  const pending = [ENTRY];
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
      if (path.startsWith("https://")) continue;
      assert.ok(path.startsWith(".") && path.endsWith(".ts"), path);
      pending.push(resolve(dirname(file), path));
    }
  }
  return files;
}

test("entire preview runtime closure has no database write/RPC or legacy persistence path", () => {
  for (const [file, source] of closure()) {
    assert.equal(/\.\s*(insert|update|upsert|delete|rpc)\s*\(/.test(source), false, file);
    assert.equal(
      /\[\s*["'](?:insert|update|upsert|delete|rpc)["']\s*\]\s*\(/.test(source),
      false,
      file,
    );
    assert.equal(/\bimport\s*\(/.test(source), false, file);
    for (const forbidden of [
      "import_apply",
      "ImportExecutor",
      "affiliate-sync-v2-ads-persistence",
      "affiliate-sync-ads-apply-v2",
      "affiliate_import_runs",
      "affiliate_import_run_mutations",
      'from("coupons")',
      "node:",
      "console.",
    ]) {
      assert.equal(source.includes(forbidden), false, `${file}: ${forbidden}`);
    }
  }
});

test("pure category subsystem has no host, database, secret or network capability", () => {
  for (const file of ["taxonomy.ts", "planner.ts"]) {
    const source = readFileSync(
      resolve(ROOT, "supabase/functions/_shared/affiliate-store-category-v1", file),
      "utf8",
    );
    for (const forbidden of [
      "fetch(",
      "Deno.",
      "supabase",
      "credential",
      ".from(",
      ".rpc(",
      "coupon",
    ])
      assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("migration creates only mapping schema with RLS, restricted category deletion and unique active keys", () => {
  const sql = readFileSync(resolve(ROOT, MIGRATION), "utf8");
  assert.match(
    sql,
    /category_id uuid NOT NULL REFERENCES public\.categories\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX[\s\S]*\(provider, normalized_provider_category_key\)[\s\S]*WHERE enabled;/,
  );
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /USING \(public\.is_admin\(auth\.uid\(\)\)\)/);
  assert.match(sql, /WITH CHECK \(public\.is_admin\(auth\.uid\(\)\)\)/);
  assert.match(sql, /GRANT SELECT ON TABLE[\s\S]*TO service_role/);
  assert.equal(/GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*TO service_role/i.test(sql), false);
  assert.equal(
    /\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+public\.(?:stores|coupons|categories)\b/i.test(
      sql,
    ),
    false,
  );
  assert.equal(/\bON\s+public\.stores\b/i.test(sql), false);
  assert.equal(/import_apply|backfill|schedule|cron/i.test(sql), false);
  assert.equal(/INSERT INTO/i.test(sql), false);
});

test("protected refresh/Ads source and every historical migration remain byte-preserved", () => {
  const paths = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      BASE,
      "supabase/functions/_shared/affiliate-sync-v2",
      "supabase/functions/_shared/affiliate-sync-v2-ads",
      "supabase/functions/_shared/affiliate-sync-v2-ads-persistence",
      "supabase/functions/affiliate-sync-ads-apply-v2",
      "supabase/functions/affiliate-sync-ads-preview-v2",
      "supabase/migrations",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of paths) {
    const expected = execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT });
    assert.deepEqual(readFileSync(resolve(ROOT, path)), expected, path);
  }
  assert.deepEqual(
    readFileSync(resolve(ROOT, MIGRATION)),
    execFileSync("git", ["show", `${CHECKPOINT}:${MIGRATION}`], { cwd: ROOT }),
    "Hardening must preserve the reviewed category mapping migration",
  );
  const names = execFileSync("git", ["diff", "--name-only", BASE], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of names)
    assert.ok(
      path === MIGRATION ||
        path === "supabase/config.toml" ||
        path.startsWith("supabase/functions/_shared/affiliate-store-category-v1/") ||
        path.startsWith("supabase/functions/affiliate-store-category-preview-v1/") ||
        path.startsWith("docs/checkpoints/"),
      path,
    );
});

test("new preview config explicitly delegates JWT verification to the authenticated admin host", () => {
  const config = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
  assert.match(
    config,
    /\[functions\.affiliate-store-category-preview-v1\]\s*\n#[^\n]*\nverify_jwt = false/,
  );
  const source = readFileSync(ENTRY, "utf8");
  assert.match(source, /auth\.getUser\(jwt\)/);
  assert.equal(
    closure().has(resolve(ROOT, "supabase/functions/affiliate-sync-ads-preview-v2/handler.ts")),
    false,
  );
});
