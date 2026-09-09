import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260908090000_provider_identity_namespaces.sql",
  import.meta.url,
);
const migration = readFileSync(migrationUrl, "utf8");

test("namespace migration adds canonical triples and namespace-aware uniqueness", () => {
  assert.equal(
    migrationUrl.pathname.endsWith(
      "20260908090000_provider_identity_namespaces.sql",
    ),
    true,
  );
  assert.equal(
    (migration.match(/ADD COLUMN provider_entity_namespace text/g) ?? [])
      .length,
    3,
  );
  assert.match(migration, /ADD COLUMN parent_provider_entity_namespace text/);
  assert.match(
    migration,
    /stores_provider_entity_identity_check[\s\S]*provider IS NULL[\s\S]*provider_entity_namespace IS NULL[\s\S]*provider_entity_id IS NULL/,
  );
  assert.match(
    migration,
    /provider = 'impact' AND provider_entity_namespace IN \('campaign', 'legacy'\)/,
  );
  assert.match(
    migration,
    /provider = 'impact' AND provider_entity_namespace IN \('promotion', 'ad', 'legacy'\)/,
  );
  assert.equal(
    (migration.match(
      /ON public\.(?:stores|coupons) \(provider, provider_entity_namespace, provider_entity_id\)/g,
    ) ?? []).length,
    2,
  );
  assert.doesNotMatch(
    migration,
    /ON public\.(?:stores|coupons) \(provider, provider_entity_id\)/,
  );
});

test("backfill is deterministic and changes identity namespace only", () => {
  const preV2Rpc = migration.slice(
    0,
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2",
    ),
  );
  const guardIndex = preV2Rpc.indexOf("DO $provider_identity_backfill_guard$");
  const firstSchemaChange = preV2Rpc.indexOf("ALTER TABLE public.stores");
  assert.ok(guardIndex >= 0 && guardIndex < firstSchemaChange);
  assert.match(
    preV2Rpc,
    /RAISE EXCEPTION 'unexpected_existing_impact_store_identity'[\s\S]*USING ERRCODE = '23514'/,
  );
  for (const campaignId of ["15781", "17513", "18744", "25810"]) {
    assert.equal(
      (preV2Rpc.match(new RegExp(`'${campaignId}'`, "g")) ?? []).length,
      2,
    );
  }
  assert.match(
    preV2Rpc,
    /UPDATE public\.stores[\s\S]*SET provider_entity_namespace = 'campaign'[\s\S]*WHERE provider = 'impact'[\s\S]*provider_entity_id = ANY/,
  );
  assert.doesNotMatch(
    preV2Rpc,
    /WHEN provider = 'impact' THEN 'campaign'/,
  );
  assert.match(
    preV2Rpc,
    /UPDATE public\.stores[\s\S]*SET provider_entity_namespace = 'legacy'[\s\S]*provider <> 'impact'[\s\S]*provider_entity_id IS NOT NULL/,
  );
  assert.match(
    preV2Rpc,
    /UPDATE public\.coupons[\s\S]*SET provider_entity_namespace = 'legacy'[\s\S]*WHERE provider IS NOT NULL[\s\S]*provider_entity_id IS NOT NULL/,
  );
  for (
    const forbidden of [
      "SET name =",
      "SET slug =",
      "SET title =",
      "SET coupon_code =",
      "SET status =",
    ]
  ) {
    assert.equal(preV2Rpc.includes(forbidden), false);
  }
});

test("namespace cutover does not replace the frozen historical V1 RPC", () => {
  assert.doesNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.import_apply\s*\(/,
  );
  assert.doesNotMatch(
    migration,
    /(?:REVOKE|GRANT)[^;]*public\.import_apply\s*\(/,
  );
});

test("Promotions V2 contract and SQL use campaign/promotion namespaces exactly", () => {
  const v2 = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2",
    ),
  );
  assert.match(v2, /_persistence_contract_version IS DISTINCT FROM 'v2-a9b-2'/);
  assert.doesNotMatch(
    v2,
    /_persistence_contract_version IS DISTINCT FROM 'v2-a9b-1'/,
  );
  assert.match(v2, /providerEntityNamespace' IS DISTINCT FROM 'campaign'/);
  assert.match(v2, /providerEntityNamespace' IS DISTINCT FROM 'promotion'/);
  assert.match(
    v2,
    /parentProviderEntityNamespace'\s+IS DISTINCT FROM 'campaign'/,
  );
  assert.match(
    v2,
    /ON CONFLICT \(provider, provider_entity_namespace, provider_entity_id\)/,
  );
  assert.match(
    v2,
    /store\.provider_entity_namespace = v_provider_entity_namespace[\s\S]*store\.provider_entity_id = v_provider_entity_id/,
  );
  assert.match(
    v2,
    /offer\.provider_entity_namespace = v_provider_entity_namespace[\s\S]*offer\.provider_entity_id = v_provider_entity_id/,
  );
  assert.doesNotMatch(v2, /\bUPDATE public\.(?:stores|coupons)\b/);
  assert.doesNotMatch(v2, /\bDELETE FROM public\.(?:stores|coupons)\b/);
  assert.match(
    migration,
    /persistence_contract_version IN \('v2-a9b-1', 'v2-a9b-2'\)/,
  );
});

test("mutation evidence and security retain the namespace-aware closed contract", () => {
  assert.match(
    migration,
    /UNIQUE \(\s*run_id,\s*entity_kind,\s*provider,\s*provider_entity_namespace,\s*provider_entity_id\s*\)/,
  );
  assert.match(
    migration,
    /entity_kind = 'store'[\s\S]*provider_entity_namespace = 'campaign'[\s\S]*parent_provider_entity_namespace IS NULL/,
  );
  assert.match(
    migration,
    /entity_kind = 'offer'[\s\S]*provider_entity_namespace IN \('promotion', 'ad'\)[\s\S]*parent_provider_entity_namespace = 'campaign'/,
  );
  assert.match(
    migration,
    /'providerEntityNamespace', mutation\.provider_entity_namespace/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.apply_affiliate_persistence_plan_v2[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.apply_affiliate_persistence_plan_v2[\s\S]*TO service_role/,
  );
  assert.doesNotMatch(
    migration,
    /affiliate-sync-ads-preview-v2|DealDefaultPromoCode|AdId/,
  );
});
