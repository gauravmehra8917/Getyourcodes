import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrations = new URL("../../../migrations/", import.meta.url);
const FILE = "20260925120000_affiliate_sync_ads_v2_refresh_dispatch.sql";
const D4D1 = "20260923103000_affiliate_sync_ads_v2_refresh_compatibility.sql";
const D4D2 = "20260923120000_affiliate_sync_ads_v2_refresh_transaction.sql";
const read = (name: string) => readFileSync(new URL(name, migrations), "utf8");
const sql = read(FILE);
const args = [
  "_integration_id",
  "_provider",
  "_persistence_contract_version",
  "_plan_fingerprint_algorithm",
  "_plan_fingerprint",
  "_evaluation_timestamp",
  "_triggered_by",
  "_expected_counts",
  "_store_instructions",
  "_offer_instructions",
];

test("one forward dispatcher replacement delegates all ten Ads-2 arguments without transaction logic", () => {
  assert.ok(FILE > D4D2);
  assert.deepEqual(
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((
      match,
    ) => match[1]),
    ["apply_affiliate_persistence_plan_v2"],
  );
  const branches = [
    ...sql.matchAll(
      /IF _persistence_contract_version = '([^']+)' THEN\s+RETURN public\.(\w+)\(([\s\S]*?)\);\s+END IF;/g,
    ),
  ];
  assert.deepEqual(branches.map((match) => [match[1], match[2]]), [
    ["v2-a9b-2", "affiliate_sync_v2_apply_promotions_plan_internal"],
    ["v2-a11-ads-1", "affiliate_sync_v2_apply_ads_plan_internal"],
    ["v2-a11-ads-2", "affiliate_sync_v2_apply_ads_refresh_plan_internal"],
  ]);
  for (const branch of branches) {
    assert.deepEqual(branch[3]!.split(",").map((arg) => arg.trim()), args);
  }
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE|CREATE TABLE|CREATE INDEX)\b/i,
  );
});

test("historical dispatcher and unknown-version/error behavior are byte-preserved outside the new branch", () => {
  const historical = read(
    "20260909090000_affiliate_sync_ads_v2_persistence.sql",
  );
  const marker =
    "CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2(";
  const withoutAds2 = sql.slice(sql.indexOf(marker)).replace(
    /  IF _persistence_contract_version = 'v2-a11-ads-2'[\s\S]*?  END IF;\n\n/,
    "",
  );
  assert.equal(withoutAds2, historical.slice(historical.indexOf(marker)));
  assert.match(
    sql,
    /'status', 'blocked',\s+'stage', 'request_validation',\s+'reason', 'invalid_request'/,
  );
});

test("dispatcher ACL and definer search path remain fixed; private Ads-2 execution stays revoked", () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*?\) TO service_role;/,
  );
  assert.equal((sql.match(/\bGRANT\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    sql,
    /(?:GRANT|REVOKE).*affiliate_sync_v2_apply_ads_refresh_plan_internal/,
  );
  assert.match(
    read(D4D2),
    /REVOKE ALL ON FUNCTION public\.affiliate_sync_v2_apply_ads_refresh_plan_internal\([\s\S]*?\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
});

test("D4D1 and D4D2 remain byte-identical to verified private transaction checkpoints", () => {
  for (
    const [name, hash] of [
      [
        D4D1,
        "60e73483bd94652904b04bc9efc035400f48265ab02e1f065154f5401631bd94",
      ],
      [
        D4D2,
        "eaa2115693094bddb62ebb9e590c31abfbdd8db98f616f8ed18fa557f1e5213b",
      ],
    ]
  ) assert.equal(createHash("sha256").update(read(name!)).digest("hex"), hash);
});
