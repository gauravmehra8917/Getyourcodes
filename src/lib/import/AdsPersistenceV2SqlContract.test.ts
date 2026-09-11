import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const namespaceMigrationUrl = new URL(
  "../../../supabase/migrations/20260908090000_provider_identity_namespaces.sql",
  import.meta.url,
);
const adsMigrationUrl = new URL(
  "../../../supabase/migrations/20260909090000_affiliate_sync_ads_v2_persistence.sql",
  import.meta.url,
);
const persistenceFoundationUrl = new URL(
  "../../../supabase/migrations/20260819090000_affiliate_sync_v2_persistence.sql",
  import.meta.url,
);
const namespaceMigration = readFileSync(namespaceMigrationUrl, "utf8");
const migration = readFileSync(adsMigrationUrl, "utf8");
const persistenceFoundation = readFileSync(persistenceFoundationUrl, "utf8");
const executableSql = migration
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing SQL marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing SQL marker: ${end}`);
  return migration.slice(startIndex, endIndex);
}

const adsFunction = between(
  "CREATE OR REPLACE FUNCTION public.affiliate_sync_v2_apply_ads_plan_internal(",
  "REVOKE ALL ON FUNCTION public.affiliate_sync_v2_apply_ads_plan_internal(",
);
const dispatcher = between(
  "CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2(",
  "REVOKE ALL ON FUNCTION public.apply_affiliate_persistence_plan_v2(",
);

test("A11-S4-I2 leaves I1 byte-identical and uses one later forward migration", () => {
  assert.equal(
    createHash("sha256").update(namespaceMigration).digest("hex"),
    "f75771181921c0b77aaf476807d53c28226a5fa7f81606b4ab7718c361d9b126",
  );
  assert.ok(adsMigrationUrl.pathname > namespaceMigrationUrl.pathname);
  assert.doesNotMatch(executableSql, /\bpublic\.import_apply\s*\(/i);
});

test("A11-S4-I2 extends run coherence without invalidating settled contracts", () => {
  assert.match(
    migration,
    /persistence_contract_version IN \([\s\S]*'v2-a9b-1',[\s\S]*'v2-a9b-2',[\s\S]*'v2-a11-ads-1'[\s\S]*\)/,
  );
  assert.match(
    migration,
    /DROP CONSTRAINT affiliate_import_runs_v2_persistence_coherence_check,[\s\S]*ADD CONSTRAINT affiliate_import_runs_v2_persistence_coherence_check/,
  );
  assert.match(
    migration,
    /public\.affiliate_sync_v2_valid_persistence_counts\(persistence_counts\)/,
  );
});

test("A11-S4-I2 preserves Promotions behind a closed dispatcher", () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*\) RENAME TO affiliate_sync_v2_apply_promotions_plan_internal/,
  );
  assert.match(dispatcher, /IF _persistence_contract_version = 'v2-a9b-2'/);
  assert.match(
    dispatcher,
    /RETURN public\.affiliate_sync_v2_apply_promotions_plan_internal\(/,
  );
  assert.match(dispatcher, /IF _persistence_contract_version = 'v2-a11-ads-1'/);
  assert.match(
    dispatcher,
    /RETURN public\.affiliate_sync_v2_apply_ads_plan_internal\(/,
  );
  assert.match(dispatcher, /'reason', 'invalid_request'/);
});

test("A11-S4-I2 Ads contract is exact campaign/ad/campaign and coupon-only", () => {
  assert.match(
    adsFunction,
    /_persistence_contract_version IS DISTINCT FROM 'v2-a11-ads-1'/,
  );
  assert.match(
    adsFunction,
    /v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'campaign'/,
  );
  assert.match(
    adsFunction,
    /v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'ad'/,
  );
  assert.match(
    adsFunction,
    /v_instruction->>'parentProviderEntityNamespace'[\s\S]*IS DISTINCT FROM 'campaign'/,
  );
  assert.match(adsFunction, /v_kind IS DISTINCT FROM 'coupon'/);
  assert.doesNotMatch(adsFunction, /v_kind\s*=\s*'deal'/);
  assert.doesNotMatch(
    adsFunction,
    /providerEntityNamespace' IS DISTINCT FROM 'promotion'/,
  );
});

test("A11-S4-I2 rejects missing, null, and non-string actions before dispatch", () => {
  assert.equal(
    adsFunction.match(
      /jsonb_typeof\(v_instruction->'action'\) IS DISTINCT FROM 'string'/g,
    )?.length,
    2,
  );
  assert.equal(
    adsFunction.match(/v_action NOT IN \('create', 'noop_existing'\)/g)?.length,
    2,
  );
});

test("A11-S4-I2 keeps the settled expected-count shape unchanged", () => {
  for (
    const key of [
      "blockedAmbiguous",
      "noopUnmatched",
      "noopHeld",
      "noopUnresolved",
      "writableStores",
      "writableOffers",
      "writableEntities",
    ]
  ) {
    assert.match(persistenceFoundation, new RegExp(`'${key}'`));
  }
  assert.match(
    adsFunction,
    /affiliate_sync_v2_valid_expected_counts\(_expected_counts\)/,
  );
  assert.match(
    adsFunction,
    /affiliate_sync_v2_valid_persistence_counts\(v_persistence_counts\)/,
  );
});

test("A11-S4-I2 closes and persists the exact Campaign store projection", () => {
  for (
    const key of [
      "advertiserId",
      "campaignId",
      "campaignName",
      "destinationUrl",
      "trackingUrl",
    ]
  ) {
    assert.match(adsFunction, new RegExp(`'${key}'`));
  }
  assert.match(
    adsFunction,
    /v_projection#>>'\{metadata,campaignId\}' IS DISTINCT FROM v_provider_entity_id/,
  );
  assert.match(
    adsFunction,
    /v_projection->'affiliateUrl' IS DISTINCT FROM[\s\S]*v_projection->'destinationUrl'/,
  );
  assert.match(
    adsFunction,
    /metadata,trackingUrl[\s\S]*IS DISTINCT FROM 'string'[\s\S]*\^https\?\:\/\/\[\^\[:space:\]\]\+\$/,
  );
  assert.doesNotMatch(
    adsFunction,
    /metadata,trackingUrl[^;]*IS DISTINCT FROM[^;]*affiliateUrl/,
  );
  assert.match(
    adsFunction,
    /INSERT INTO public\.stores \([\s\S]*seo_title,[\s\S]*seo_description,[\s\S]*seo_canonical_url[\s\S]*v_projection->>'seoTitle',[\s\S]*v_projection->>'seoDescription',[\s\S]*v_projection->>'seoCanonicalUrl'/,
  );
  assert.match(adsFunction, /v_projection->'metadata'/);
});

test("A11-S4-I2 closes coded Ad projection and persists useful bounded fields", () => {
  for (
    const key of [
      "adId",
      "campaignId",
      "advertiserId",
      "dealId",
      "campaignName",
      "adName",
      "dealStartDate",
      "dealEndDate",
      "startDate",
      "endDate",
    ]
  ) {
    assert.match(adsFunction, new RegExp(`'${key}'`));
  }
  assert.match(
    adsFunction,
    /v_projection#>>'\{metadata,adId\}' IS DISTINCT FROM v_provider_entity_id/,
  );
  assert.match(
    adsFunction,
    /v_projection#>>'\{metadata,campaignId\}' IS DISTINCT FROM[\s\S]*v_parent_provider_entity_id/,
  );
  assert.match(
    adsFunction,
    /v_projection->>'couponType' IS DISTINCT FROM 'code'/,
  );
  assert.match(
    adsFunction,
    /lower\(v_projection->>'couponCode'\) IN \([\s\S]*'n\/a'[\s\S]*'no code'[\s\S]*'undefined'/,
  );
  assert.match(
    adsFunction,
    /INSERT INTO public\.coupons \([\s\S]*landing_page_url,[\s\S]*structured_terms,[\s\S]*metadata,[\s\S]*seo_title,[\s\S]*seo_description,[\s\S]*seo_canonical_url/,
  );
  assert.match(adsFunction, /v_projection->>'landingPageUrl'/);
  assert.match(
    adsFunction,
    /nullif\(v_projection->'structuredTerms', 'null'::jsonb\)/,
  );
  assert.match(
    adsFunction,
    /v_projection->>'status' NOT IN \('active', 'expired', 'draft'\)/,
  );
  assert.match(
    adsFunction,
    /\(v_projection->>'status'\)::public\.coupon_status/,
  );
});

test("A11-S4-I2 closes discount and structured-term numeric semantics", () => {
  assert.match(
    adsFunction,
    /v_projection->>'discountType' NOT IN \('percentage', 'fixed'\)/,
  );
  assert.match(
    adsFunction,
    /\(v_projection->'discountType' = 'null'::jsonb\) <>[\s\S]*\(v_projection->'discountValue' = 'null'::jsonb\)/,
  );
  assert.match(
    adsFunction,
    /\(v_projection->>'discountValue'\)::numeric < 0/,
  );
  assert.match(
    adsFunction,
    /structuredTerms,purchaseLimit[\s\S]*::numeric <= 0/,
  );
  assert.match(
    adsFunction,
    /structuredTerms,minimumPurchase[\s\S]*structuredTerms,maximumSavings[\s\S]*structuredTerms,purchaseLimit[\s\S]*::numeric < 0/,
  );
});

test("A11-S4-I2 treats exact Ads legacy identities and slugs only as blockers", () => {
  assert.ok(
    (adsFunction.match(/provider_entity_namespace = 'legacy'/g)?.length ?? 0) >=
      4,
  );
  assert.ok(
    (adsFunction.match(/legacy_identity_collision/g)?.length ?? 0) >= 4,
  );
  assert.match(
    adsFunction,
    /WHERE store\.slug = v_slug[\s\S]*store_slug_collision/,
  );
  assert.doesNotMatch(
    adsFunction,
    /provider_entity_namespace = 'promotion'[\s\S]*legacy_identity_collision/,
  );
  assert.doesNotMatch(
    adsFunction,
    /WHERE[^;]*(?:store|offer)\.(?:name|affiliate_url|metadata)\s*=/i,
  );
  assert.doesNotMatch(
    adsFunction,
    /WHERE[^;]*provider_entity_id[^;]*\bOR\b[^;]*slug\s*=/i,
  );
});

test("A11-S4-I2 serializes legacy collisions for every catalog writer", () => {
  assert.match(
    migration,
    /DO \$impact_legacy_namespace_guard\$[\s\S]*existing_impact_store_legacy_namespace_collision[\s\S]*existing_impact_offer_legacy_namespace_collision/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX stores_impact_campaign_legacy_identity_uidx[\s\S]*ON public\.stores \(provider, provider_entity_id\)[\s\S]*provider_entity_namespace IN \('campaign', 'legacy'\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX coupons_impact_ad_legacy_identity_uidx[\s\S]*ON public\.coupons \(provider, provider_entity_id\)[\s\S]*provider_entity_namespace IN \('ad', 'legacy'\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX coupons_impact_promotion_legacy_identity_uidx[\s\S]*ON public\.coupons \(provider, provider_entity_id\)[\s\S]*provider_entity_namespace IN \('promotion', 'legacy'\)/,
  );
  assert.match(
    adsFunction,
    /stores_impact_campaign_legacy_identity_uidx[\s\S]*legacy_identity_collision/,
  );
  assert.match(
    adsFunction,
    /coupons_impact_ad_legacy_identity_uidx[\s\S]*legacy_identity_collision/,
  );
});

test("A11-S4-I2 is create/no-op only with exact contention revalidation", () => {
  assert.match(
    adsFunction,
    /ON CONFLICT \(provider, provider_entity_namespace, provider_entity_id\)[\s\S]*DO NOTHING[\s\S]*RETURNING id INTO v_entity_id/,
  );
  assert.ok(
    (adsFunction.match(/RETURNING id INTO v_entity_id/g)?.length ?? 0) >= 2,
  );
  assert.match(adsFunction, /offer_kind_conflict/);
  assert.match(adsFunction, /parent_store_mismatch/);
  assert.doesNotMatch(adsFunction, /UPDATE\s+public\.(?:stores|coupons)\b/i);
  assert.doesNotMatch(
    adsFunction,
    /DELETE\s+FROM\s+public\.(?:stores|coupons)\b/i,
  );
  assert.doesNotMatch(adsFunction, /ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i);
});

test("A11-S4-I2 keeps replay, run, and namespace-aware ledger atomic", () => {
  const integrationLock = adsFunction.indexOf("FOR UPDATE;");
  const replayLookup = adsFunction.indexOf(
    "FROM public.affiliate_import_runs AS run",
    integrationLock,
  );
  const storeInsert = adsFunction.indexOf(
    "INSERT INTO public.stores",
    replayLookup,
  );
  assert.ok(integrationLock > 0);
  assert.ok(replayLookup > integrationLock);
  assert.ok(storeInsert > replayLookup);
  assert.match(adsFunction, /'status', 'replayed_existing'/);
  assert.match(adsFunction, /INSERT INTO public\.affiliate_import_runs/);
  assert.match(
    adsFunction,
    /INSERT INTO public\.affiliate_import_run_mutations_v2/,
  );
  assert.match(
    adsFunction,
    /'providerEntityNamespace', v_provider_entity_namespace/,
  );
  assert.match(
    adsFunction,
    /'parentProviderEntityNamespace',[\s\S]*v_parent_provider_entity_namespace/,
  );
  assert.match(
    adsFunction,
    /EXCEPTION WHEN OTHERS THEN[\s\S]*'reason', 'internal_failure'/,
  );
});

test("A11-S4-I2 exposes only the dispatcher to service_role", () => {
  for (
    const internalName of [
      "affiliate_sync_v2_apply_promotions_plan_internal",
      "affiliate_sync_v2_apply_ads_plan_internal",
    ]
  ) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${internalName}\\([\\s\\S]*FROM PUBLIC, anon, authenticated, service_role`,
      ),
    );
  }
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*TO service_role/,
  );
  assert.doesNotMatch(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.(?:affiliate_sync_v2_apply_promotions_plan_internal|affiliate_sync_v2_apply_ads_plan_internal)/i,
  );
});
