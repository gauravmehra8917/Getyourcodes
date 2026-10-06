import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261005120000_public_catalog_visibility_rls.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/--[^\n]*/g, "");
const statements = migration
  .split(";")
  .map((sql) => sql.trim())
  .filter(Boolean);
const expectedPolicies = [
  ["stores public read", "stores", "SELECT"],
  ["coupons public read", "coupons", "SELECT"],
  ["clicks anyone insert", "coupon_clicks", "INSERT"],
];

function policy(name: string): string {
  const sql = statements.find((statement) => statement.startsWith(`CREATE POLICY "${name}"`));
  assert.ok(sql);
  return sql;
}

function assertStoreVisibility(sql: string, prefix = ""): void {
  const escaped = prefix.replace(".", "\\.");
  assert.match(
    sql,
    new RegExp(
      `NOT\\s*\\(\\s*COALESCE\\(${escaped}lifecycle_managed, false\\)\\s*AND\\s*COALESCE\\(${escaped}lifecycle_hidden, false\\)\\s*\\)`,
      "i",
    ),
  );
}

function assertOfferWindow(sql: string, prefix = ""): void {
  const escaped = prefix.replace(".", "\\.");
  const utcDate = "\\(now\\(\\) AT TIME ZONE 'UTC'\\)::date";
  assert.match(sql, new RegExp(`${escaped}status = 'active'`, "i"));
  for (const [column, operator] of [
    ["start_date", "<="],
    ["expiry_date", ">="],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `AND\\s*\\(${escaped}${column} IS NULL OR ${escaped}${column} ${operator} ${utcDate}\\)`,
        "i",
      ),
    );
  }
}

test("visibility migration contains only the three public policy replacements in a transaction", () => {
  assert.equal(statements.length, 8);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "COMMIT");
  expectedPolicies.forEach(([name, table, operation], index) => {
    assert.equal(statements[1 + index * 2], `DROP POLICY "${name}" ON public.${table}`);
    assert.match(
      policy(name),
      new RegExp(
        `^CREATE POLICY "${name}"\\s+ON public\\.${table}\\s+FOR ${operation}\\s+TO anon, authenticated\\s+(USING|WITH CHECK)\\s*\\(`,
      ),
    );
  });
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b|\b(?:CREATE|DROP)\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bINSERT\s+INTO\b|\bUPDATE\s+\w|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /(?:CREATE|DROP|ALTER)\s+POLICY\s+"[^"]*admin/i);
});

test("store policy uses the exact null-safe canonical lifecycle rule", () => {
  assertStoreVisibility(policy("stores public read"));
});

test("coupon policy enforces active UTC date windows and the parent store rule", () => {
  const sql = policy("coupons public read");
  assertOfferWindow(sql);
  assert.match(
    sql,
    /AND EXISTS\s*\(\s*SELECT 1 FROM public\.stores s\s+WHERE s\.id = coupons\.store_id/i,
  );
  assertStoreVisibility(sql, "s.");
});

test("click policy preserves user ownership and repeats the full public offer predicate", () => {
  const sql = policy("clicks anyone insert");
  assert.match(sql, /\(user_id IS NULL OR user_id = auth\.uid\(\)\)\s+AND EXISTS/i);
  assert.match(sql, /FROM public\.coupons c\s+JOIN public\.stores s ON s\.id = c\.store_id/i);
  assert.match(sql, /WHERE c\.id = coupon_clicks\.coupon_id/i);
  assertOfferWindow(sql, "c.");
  assertStoreVisibility(sql, "s.");
});
