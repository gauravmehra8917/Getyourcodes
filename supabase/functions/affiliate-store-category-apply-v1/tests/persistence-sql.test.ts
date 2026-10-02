import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../migrations/20261002130000_affiliate_store_category_canary_apply.sql",
    import.meta.url,
  ),
  "utf8",
);
const executable = sql.replace(/--[^\n]*/g, "");
function before(first: string, second: string) {
  assert.ok(executable.includes(first), first);
  assert.ok(
    executable.indexOf(first) < executable.indexOf(second),
    `${first} must precede ${second}`,
  );
}

test("RPC is a new typed SECURITY DEFINER function with a fixed search path", () => {
  assert.match(
    executable,
    /CREATE FUNCTION public\.apply_affiliate_store_category_canary_v1\(\s*p_store_id uuid,\s*p_campaign_id text,\s*p_category_id uuid,\s*p_provider_category_keys text\[\]\s*\)/,
  );
  assert.match(
    executable,
    /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/,
  );
  assert.doesNotMatch(executable, /CREATE OR REPLACE|DEFAULT|EXECUTE\s+['"]|format\(/i);
});

test("only service_role receives EXECUTE and public/anon/authenticated are revoked", () => {
  const signature = "public.apply_affiliate_store_category_canary_v1(uuid, text, uuid, text[])";
  assert.ok(
    executable.includes(`REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated;`),
  );
  assert.ok(executable.includes(`GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`));
  assert.equal((executable.match(/\bGRANT\b/g) ?? []).length, 1);
  assert.doesNotMatch(executable, /GRANT[^;]*TO\s+(?:authenticated|anon|PUBLIC)\b/i);
});

test("request evidence is bounded to one UUID target and 1-32 unique non-null bounded keys", () => {
  for (const fragment of [
    "p_store_id IS NULL",
    "p_category_id IS NULL",
    "char_length(p_campaign_id) NOT BETWEEN 1 AND 1024",
    "octet_length(p_campaign_id) > 4096",
    "array_ndims(p_provider_category_keys) IS DISTINCT FROM 1",
    "array_lower(p_provider_category_keys, 1) IS DISTINCT FROM 1",
    "cardinality(p_provider_category_keys) NOT BETWEEN 1 AND 32",
    "key IS NULL",
    "char_length(key) NOT BETWEEN 1 AND 320",
    'count(DISTINCT key COLLATE "C")',
    "v_key_count <> cardinality(p_provider_category_keys)",
  ])
    assert.ok(executable.includes(fragment), fragment);
  before("'invalid_request'", "FOR UPDATE");
});

test("locks exactly one store by primary key and independently verifies exact Impact Campaign identity", () => {
  assert.match(executable, /INTO v_store FROM public\.stores WHERE id = p_store_id FOR UPDATE;/);
  assert.equal((executable.match(/FOR UPDATE/g) ?? []).length, 1);
  assert.match(
    executable,
    /IF NOT FOUND THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'store_identity_mismatch'\)/,
  );
  assert.match(executable, /v_store\.provider IS DISTINCT FROM 'impact'/);
  assert.match(executable, /v_store\.provider_entity_namespace IS DISTINCT FROM 'campaign'/);
  assert.match(
    executable,
    /\(v_store\.provider_entity_id COLLATE "C"\) IS DISTINCT FROM \(p_campaign_id COLLATE "C"\)/,
  );
  before("'store_identity_mismatch'", "IF v_store.category_id IS NOT NULL");
  assert.doesNotMatch(executable, /AdvertiserId|affiliate_url|slug|domain|metadata|name\s*=/i);
});

test("manual category exits with zero updates immediately after identity lock", () => {
  assert.match(
    executable,
    /IF v_store\.category_id IS NOT NULL THEN\s+RETURN jsonb_build_object\('status', 'noop_existing_category', 'outcome', 'noop_existing_category'\);\s+END IF;/,
  );
  before(
    "IF v_store.category_id IS NOT NULL",
    "LOCK TABLE public.affiliate_store_category_mappings",
  );
  before("'noop_existing_category'", "UPDATE public.stores");
});

test("mapping revalidation stabilizes edits/phantoms and locks existing requested category", () => {
  assert.match(executable, /LOCK TABLE public\.affiliate_store_category_mappings IN SHARE MODE;/);
  assert.match(
    executable,
    /PERFORM id FROM public\.categories WHERE id = p_category_id FOR KEY SHARE;/,
  );
  assert.match(
    executable,
    /IF NOT FOUND THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'category_not_found'\)/,
  );
  before("IN SHARE MODE;", "SELECT min(priority)");
  before("'category_not_found'", "SELECT min(priority)");
});

test("SQL recomputes lower-is-stronger enabled Impact mapping winner using every supplied key", () => {
  assert.match(executable, /SELECT min\(priority\) INTO v_best_priority/);
  assert.equal((executable.match(/WHERE provider = 'impact' AND enabled = true/g) ?? []).length, 2);
  assert.equal(
    (
      executable.match(
        /\(normalized_provider_category_key COLLATE "C"\) = ANY\(p_provider_category_keys\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(executable, /AND priority = v_best_priority/);
  assert.match(executable, /count\(DISTINCT category_id\)/);
  assert.match(
    executable,
    /IF v_best_priority IS NULL THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'mapping_unmapped'\)/,
  );
});

test("ambiguous strongest and stale requested target exit before the only store update", () => {
  assert.match(
    executable,
    /IF v_target_count <> 1 THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'mapping_ambiguous'\)/,
  );
  assert.match(
    executable,
    /IF v_target IS DISTINCT FROM p_category_id THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'mapping_stale'\)/,
  );
  before("'mapping_unmapped'", "UPDATE public.stores");
  before("'mapping_ambiguous'", "UPDATE public.stores");
  before("'mapping_stale'", "UPDATE public.stores");
});

test("only category_id can mutate and guarded primary-key UPDATE affects at most one row", () => {
  const updates = [...executable.matchAll(/UPDATE\s+public\.(\w+)\s+SET\s+([\s\S]*?);/g)];
  assert.equal(updates.length, 1);
  assert.equal(updates[0]![1], "stores");
  assert.equal(updates[0]![2]!.split(/\s+WHERE\s+/)[0], "category_id = v_target");
  assert.match(
    updates[0]![0],
    /WHERE id = p_store_id AND provider = 'impact'\s+AND provider_entity_namespace = 'campaign'\s+AND \(provider_entity_id COLLATE "C"\) = \(p_campaign_id COLLATE "C"\)\s+AND category_id IS NULL;/,
  );
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT|DELETE|MERGE|TRUNCATE|CREATE TRIGGER|ALTER TABLE)\b/i,
  );
  assert.doesNotMatch(
    executable,
    /\b(?:coupons|affiliate_import_runs|affiliate_import_run_mutations|import_apply|provider_managed|fingerprint)\b/i,
  );
});

test("requires one affected row; zero safely rechecks without retry; exceptions roll back", () => {
  assert.match(executable, /GET DIAGNOSTICS v_affected = ROW_COUNT;/);
  assert.match(
    executable,
    /IF v_affected = 1 THEN\s+RETURN jsonb_build_object\('status', 'assigned', 'outcome', 'assigned'\)/,
  );
  assert.match(executable, /IF v_affected <> 0 THEN\s+RAISE EXCEPTION 'category_canary_row_count'/);
  assert.match(executable, /INTO v_store FROM public\.stores WHERE id = p_store_id;/);
  assert.match(
    executable,
    /EXCEPTION WHEN OTHERS THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'outcome', 'internal_failure'\)/,
  );
  assert.doesNotMatch(executable, /SQLERRM|SQLSTATE|RAISE NOTICE|RETURNING\s+\*/i);
});

test("every returned result is exactly bounded status/outcome without database identifiers", () => {
  const results = [...executable.matchAll(/RETURN jsonb_build_object\(([^;]*)\);/g)];
  assert.ok(results.length > 10);
  for (const result of results)
    assert.match(
      result[1]!,
      /^'status', '(?:assigned|noop_existing_category|blocked)', 'outcome', '(?:assigned|noop_existing_category|invalid_request|store_identity_mismatch|category_not_found|mapping_unmapped|mapping_ambiguous|mapping_stale|internal_failure)'$/,
    );
});
