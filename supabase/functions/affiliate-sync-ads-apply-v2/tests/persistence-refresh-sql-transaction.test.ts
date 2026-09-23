import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Source contracts only: this suite never starts PostgreSQL or executes SQL.
const migrations = new URL("../../../migrations/", import.meta.url);
const migrationName =
  "20260923120000_affiliate_sync_ads_v2_refresh_transaction.sql";
const raw = readFileSync(new URL(migrationName, migrations), "utf8");
const sql = raw.replace(/--[^\n]*/g, "");
const ads1 = readFileSync(
  new URL("20260909090000_affiliate_sync_ads_v2_persistence.sql", migrations),
  "utf8",
);
const d4d1 = readFileSync(
  new URL(
    "20260923103000_affiliate_sync_ads_v2_refresh_compatibility.sql",
    migrations,
  ),
  "utf8",
);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, start);
  assert.ok(to > from, end);
  return source.slice(from, to);
}

const validation = between(
  sql,
  "IF _integration_id IS NULL",
  "v_stage := 'replay_resolution'",
);
const stores = between(
  sql,
  "v_stage := 'store_revalidation'",
  "v_stage := 'offer_revalidation'",
);
const offers = between(
  sql,
  "v_stage := 'offer_revalidation'",
  "v_stage := 'reconciliation'",
);
const storeCreate = between(
  stores,
  "IF v_action = 'create' THEN",
  "ELSE\n          v_expected_id",
);
const offerCreate = between(
  offers,
  "IF v_action = 'create' THEN",
  "ELSE\n          v_expected_id",
);
const storeUpdate = between(
  stores,
  "v_stage := 'store_update'",
  "v_outcome := 'updated_existing'",
);
const offerUpdate = between(
  offers,
  "v_stage := 'offer_update'",
  "v_outcome := 'updated_existing'",
);
const durable = sql.slice(sql.indexOf("v_stage := 'evidence_validation'"));
const block =
  /RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked'/;

test("D4D2 defines exactly one private Ads-2 transaction with a fixed search path", () => {
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.affiliate_sync_v2_apply_ads_refresh_plan_internal\(/,
  );
  assert.match(
    sql,
    /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/,
  );
});

test("D4D2 requires the exact provider version fingerprint and finite evaluation instant", () => {
  for (
    const marker of [
      "_provider IS DISTINCT FROM 'impact'",
      "_persistence_contract_version IS DISTINCT FROM 'v2-a11-ads-2'",
      "_plan_fingerprint_algorithm IS DISTINCT FROM 'sha256-canonical-plan-v1'",
      "_plan_fingerprint !~ '^[0-9a-f]{64}$'",
      "_integration_id IS NULL",
      "_triggered_by IS NULL",
      "_evaluation_timestamp IS NULL",
      "NOT isfinite(_evaluation_timestamp)",
    ]
  ) assert.ok(validation.includes(marker), marker);
  assert.match(validation, block);
});

test("D4D2 leaves the public dispatcher and all active integrations untouched", () => {
  assert.doesNotMatch(sql, /public\.apply_affiliate_persistence_plan_v2\s*\(/);
  const dispatcher = ads1.slice(
    ads1.indexOf(
      "CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2(",
    ),
  );
  assert.match(dispatcher, /_persistence_contract_version = 'v2-a11-ads-1'/);
  assert.doesNotMatch(
    dispatcher,
    /v2-a11-ads-2|apply_ads_refresh_plan_internal/,
  );
  assert.doesNotMatch(
    sql,
    /ALTER\s+(TABLE|FUNCTION)|CREATE\s+(TABLE|INDEX)|GRANT\s/i,
  );
});

test("D4D2 private target denies PUBLIC anon authenticated and service_role", () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.affiliate_sync_v2_apply_ads_refresh_plan_internal\(\s*uuid, text, text, text, text, timestamptz, uuid, jsonb, jsonb, jsonb\s*\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(sql, /GRANT\s+(?:ALL|EXECUTE)/i);
});

test("D4D2 accepts only exact closed instruction shapes and non-null string actions", () => {
  assert.equal(
    (validation.match(
      /CASE WHEN v_instruction->>'action' = 'update_existing'/g,
    ) ?? []).length,
    2,
  );
  assert.equal(
    (validation.match(
      /THEN ARRAY\['expectedCurrentManagedState', 'desiredManagedState'\]/g,
    ) ?? []).length,
    2,
  );
  assert.equal(
    (validation.match(
      /jsonb_typeof\(v_instruction->'action'\) IS DISTINCT FROM 'string'/g,
    ) ?? []).length,
    2,
  );
  assert.equal(
    (validation.match(
      /v_action NOT IN \('create', 'noop_existing', 'update_existing'\)/g,
    ) ?? []).length,
    2,
  );
  assert.match(
    validation,
    /v_instruction->'qualified' IS DISTINCT FROM 'true'::jsonb/,
  );
});

test("D4D2 validates namespaces kind duplicate identities ordinals and instruction counts", () => {
  for (
    const marker of [
      "v_seen_store_ids ? v_provider_entity_id",
      "v_seen_offer_ids ? v_provider_entity_id",
      "v_kind IS DISTINCT FROM 'coupon'",
      "v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'campaign'",
      "v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'ad'",
      "v_store_update_seen <> v_store_update_expected",
      "v_offer_update_seen <> v_offer_update_expected",
      "public.affiliate_sync_v2_is_nonnegative_integer(v_instruction->'instructionOrdinal')",
      "v_store_create_expected + v_store_update_expected + v_store_existing_expected",
      "v_offer_create_expected + v_offer_update_expected + v_offer_existing_expected",
    ]
  ) assert.ok(validation.includes(marker), marker);
});

for (
  const [kind, runtime, create, row] of [
    ["Campaign", stores, storeCreate, "v_store"],
    ["Ad", offers, offerCreate, "v_offer"],
  ] as const
) {
  test(`D4D2 ${kind} CREATE requires absent exact identity and blocks unexpected existing rows`, () => {
    assert.ok(
      create.indexOf(`IF ${row}.id IS NOT NULL THEN`) <
        create.indexOf("INSERT INTO"),
    );
    assert.match(
      between(create, `IF ${row}.id IS NOT NULL THEN`, "END IF;"),
      block,
    );
    assert.match(runtime, /provider = 'impact'/);
    assert.match(
      runtime,
      /provider_entity_id = v_provider_entity_id\s+FOR UPDATE/,
    );
  });
  test(`D4D2 ${kind} CREATE races block without adopting NOOP or UPDATE`, () => {
    const race = between(
      create,
      "EXCEPTION WHEN unique_violation THEN",
      "END;",
    );
    assert.match(race, block);
    assert.doesNotMatch(
      create,
      /ON CONFLICT|noop_existing|updated_existing|UPDATE public\./,
    );
    assert.doesNotMatch(create, /v_entity_id := v_(store|offer)\.id/);
  });
  test(`D4D2 ${kind} CREATE emits only created with a null expected UUID`, () => {
    assert.match(create, /RETURNING id INTO v_entity_id/);
    assert.match(create, /v_outcome := 'created'/);
    assert.doesNotMatch(create, /v_expected_id :=/);
    assert.ok(
      runtime.indexOf("v_expected_id := NULL") <
        runtime.indexOf("IF v_action = 'create'"),
    );
    assert.match(runtime, /'expectedEntityId', v_expected_id/);
  });
  test(`D4D2 ${kind} legacy collision is checked before catalog mutation`, () => {
    assert.match(runtime, /provider_entity_namespace = 'legacy'/);
    assert.ok(
      runtime.indexOf("'legacy_identity_collision'") <
        runtime.indexOf("INSERT INTO"),
    );
  });
}

test("D4D2 retains Ads-1 insert column/value projections without its adoption branches", () => {
  for (const table of ["stores", "coupons"]) {
    const oldInsert = between(
      ads1,
      `INSERT INTO public.${table} (`,
      "ON CONFLICT",
    );
    const newInsert = between(
      sql,
      `INSERT INTO public.${table} (`,
      "RETURNING id",
    );
    assert.equal(newInsert.trim(), oldInsert.trim());
  }
  assert.match(storeCreate, /'provider',\s+true,\s+false,\s+'qualified'/);
  assert.doesNotMatch(storeCreate, /is_featured|is_banner|publication_status/);
});

test("D4D2 retains full CREATE projection validation rather than trusting object shape alone", () => {
  for (
    const marker of [
      "v_projection->>'couponType' IS DISTINCT FROM 'code'",
      "lower(v_projection->>'couponCode') IN",
      "public.affiliate_sync_v2_is_iso_date(v_projection->>'startDate')",
      "v_projection->>'lastQualificationResult' IS DISTINCT FROM 'qualified'",
      "v_projection_timestamp IS DISTINCT FROM _evaluation_timestamp",
      "v_projection#>>'{metadata,adId}' IS DISTINCT FROM v_provider_entity_id",
    ]
  ) assert.ok(validation.includes(marker), marker);
});

test("D4D2 slug collision is only a blocker never an adoption key", () => {
  assert.match(
    storeCreate,
    /IF EXISTS \(SELECT 1 FROM public\.stores WHERE slug = v_slug\) THEN\s+v_reason := 'store_slug_collision';/,
  );
  assert.doesNotMatch(sql, /SELECT[^;]*slug[^;]*INTO v_entity_id/i);
});

test("D4D2 exact NOOP Campaign UUID is mandatory and NOOP changes no catalog columns", () => {
  assert.match(
    stores,
    /v_expected_id := \(v_instruction->>'expectedExistingStoreId'\)::uuid/,
  );
  assert.match(
    stores,
    /v_store\.id IS NULL OR v_store\.id IS DISTINCT FROM v_expected_id/,
  );
  assert.match(
    stores,
    /ELSE\s+v_outcome := 'noop_existing';\s+v_stores_noop := v_stores_noop \+ 1;\s+END IF;/,
  );
});

test("D4D2 exact NOOP Ad UUID and parent UUID are mandatory", () => {
  assert.match(
    offers,
    /v_expected_id := \(v_instruction->>'existingOfferId'\)::uuid/,
  );
  assert.match(
    offers,
    /v_offer\.id IS NULL OR v_offer\.id IS DISTINCT FROM v_expected_id/,
  );
  assert.match(
    offers,
    /v_offer\.store_id IS DISTINCT FROM v_expected_parent_id/,
  );
  assert.match(
    validation,
    /v_action <> 'create' AND v_instruction->'expectedParentStoreId' = 'null'::jsonb/,
  );
});

for (
  const [kind, update] of [["store", storeUpdate], [
    "offer",
    offerUpdate,
  ]] as const
) {
  test(`D4D2 ${kind} UPDATE compares the exact bounded snapshot before writing`, () => {
    const predicate =
      "v_current_state IS DISTINCT FROM v_instruction->'expectedCurrentManagedState'";
    assert.ok(update.indexOf(predicate) >= 0);
    assert.ok(update.indexOf(predicate) < update.indexOf("UPDATE public."));
    assert.match(
      update,
      new RegExp(`v_reason := 'stale_${kind}_state';\\s+RAISE EXCEPTION`),
    );
    assert.match(update, /v_entity_id IS DISTINCT FROM v_expected_id/);
  });
  test(`D4D2 ${kind} UPDATE emits updated_existing and increments only its UPDATE counter`, () => {
    const runtime = kind === "store" ? stores : offers;
    assert.match(
      runtime,
      new RegExp(
        `v_outcome := 'updated_existing';\\s+v_${kind}s_updated := v_${kind}s_updated \\+ 1;`,
      ),
    );
    assert.match(runtime, /'plannedAction', v_action, 'outcome', v_outcome/);
  });
}

test("D4D2 current and desired snapshots are both closed and checked before database access", () => {
  assert.equal(
    (validation.match(
      /FOREACH v_state_name IN ARRAY ARRAY\['expectedCurrentManagedState', 'desiredManagedState'\]/g,
    ) ?? []).length,
    2,
  );
  assert.match(
    validation,
    /has_exact_keys\(v_state, ARRAY\['affiliateUrl', 'metadata'\]\)/,
  );
  assert.match(
    validation,
    /has_exact_keys\(v_state, ARRAY\['couponCode', 'affiliateUrl', 'landingPageUrl', 'startDate', 'expiryDate', 'status', 'terms', 'discountType', 'discountValue', 'structuredTerms', 'metadata'\]\)/,
  );
  assert.match(validation, /has_exact_keys\(v_state->'structuredTerms'/);
  assert.match(validation, /v_state_name = 'desiredManagedState'/);
});

test("D4D2 nullable managed-state comparison preserves null distinctions and all field projections", () => {
  assert.match(
    storeUpdate,
    /jsonb_build_object\(\s+'affiliateUrl', v_store\.affiliate_url, 'metadata', v_current_metadata/,
  );
  assert.match(
    storeUpdate,
    /coalesce\(v_store\.metadata->v_key, 'null'::jsonb\)/,
  );
  assert.match(
    offerUpdate,
    /coalesce\(v_offer\.metadata->v_key, 'null'::jsonb\)/,
  );
  assert.match(
    offerUpdate,
    /coalesce\(v_offer\.structured_terms->v_key, 'null'::jsonb\)/,
  );
  for (
    const column of [
      "coupon_code",
      "affiliate_url",
      "landing_page_url",
      "start_date",
      "expiry_date",
      "status",
      "terms",
      "discount_type",
      "discount_value",
    ]
  ) assert.ok(offerUpdate.includes(`v_offer.${column}`), column);
  assert.match(offerUpdate, /to_char\(v_offer\.start_date, 'YYYY-MM-DD'\)/);
  assert.doesNotMatch(storeUpdate + offerUpdate, /coalesce\([^\n]*, ''\)/);
});

test("D4D2 store ownership and lifecycle authority must still be valid at UPDATE", () => {
  assert.match(
    storeUpdate,
    /v_store\.import_origin IS DISTINCT FROM 'provider'\s+OR v_store\.lifecycle_managed IS DISTINCT FROM true/,
  );
  assert.match(
    storeUpdate,
    /v_reason := 'ownership_not_provider_managed';\s+RAISE EXCEPTION/,
  );
  assert.match(
    storeUpdate,
    /store\.import_origin = 'provider'\s+AND store\.lifecycle_managed = true/,
  );
});

test("D4D2 Ad refresh requires the exact parent Campaign ownership and lifecycle authority", () => {
  assert.match(
    offers,
    /store\.id = v_parent_store_id\s+AND store\.provider = 'impact'\s+AND store\.provider_entity_namespace = 'campaign'\s+AND store\.provider_entity_id = v_parent_provider_entity_id\s+FOR UPDATE/,
  );
  assert.match(
    offers,
    /v_parent\.import_origin IS DISTINCT FROM 'provider'\s+OR v_parent\.lifecycle_managed IS DISTINCT FROM true/,
  );
  assert.ok(
    offers.indexOf("ownership_not_provider_managed") <
      offers.indexOf("UPDATE public.coupons"),
  );
});

test("D4D2 Campaign provider identity is immutable through optimistic UPDATE", () => {
  assert.match(
    storeUpdate,
    /store\.id = v_expected_id\s+AND store\.provider = 'impact'\s+AND store\.provider_entity_namespace = 'campaign'\s+AND store\.provider_entity_id = v_provider_entity_id/,
  );
  assert.match(
    validation,
    /v_state#>>'\{metadata,campaignId\}' IS DISTINCT FROM v_provider_entity_id/,
  );
});

test("D4D2 Ad identity kind and Campaign parent are immutable through UPDATE", () => {
  assert.match(
    offerUpdate,
    /offer\.id = v_expected_id\s+AND offer\.provider = 'impact'\s+AND offer\.provider_entity_namespace = 'ad'\s+AND offer\.provider_entity_id = v_provider_entity_id/,
  );
  assert.match(
    offerUpdate,
    /offer\.coupon_type = 'code'\s+AND offer\.store_id = v_expected_parent_id\s+AND offer\.store_id = v_parent_store_id/,
  );
  assert.match(
    validation,
    /v_state#>>'\{metadata,adId\}' IS DISTINCT FROM v_provider_entity_id/,
  );
  assert.match(
    validation,
    /v_state#>>'\{metadata,campaignId\}' IS DISTINCT FROM v_parent_provider_entity_id/,
  );
});

test("D4D2 UPDATE SET lists are exactly the approved managed columns", () => {
  const updates = [
    ...sql.matchAll(
      /UPDATE public\.(stores|coupons) AS \w+\s+SET ([\s\S]*?)\s+WHERE/g,
    ),
  ];
  assert.equal(updates.length, 2);
  const columns = (set: string) =>
    [...set.matchAll(/(?:^|,\s*)([a-z_]+)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(columns(updates[0]![2]!), ["affiliate_url", "metadata"]);
  assert.deepEqual(columns(updates[1]![2]!), [
    "coupon_code",
    "affiliate_url",
    "landing_page_url",
    "start_date",
    "expiry_date",
    "status",
    "terms",
    "discount_type",
    "discount_value",
    "structured_terms",
    "metadata",
  ]);
});

test("D4D2 preserves unrelated metadata and never owns presentation fields", () => {
  assert.match(
    storeUpdate,
    /coalesce\(nullif\(store\.metadata, 'null'::jsonb\), '\{\}'::jsonb\)\s+\|\| \(v_desired->'metadata'\)/,
  );
  assert.match(
    offerUpdate,
    /coalesce\(nullif\(offer\.metadata, 'null'::jsonb\), '\{\}'::jsonb\)\s+\|\| \(v_desired->'metadata'\)/,
  );
  assert.doesNotMatch(
    storeUpdate + offerUpdate,
    /(?:SET|,)\s*(?:slug|name|title|description|seo_\w+|og_\w+|logo_\w+|lifecycle_hidden|is_featured)\s*=/,
  );
});

test("D4D2 uses exclusive locks before state comparison and keeps both mutations in one subtransaction", () => {
  for (const runtime of [stores, offers]) {
    assert.ok(
      runtime.indexOf("FOR UPDATE") < runtime.indexOf("v_current_state"),
    );
  }
  assert.match(sql, /BEGIN\s+BEGIN\s+IF _integration_id/);
  const catcher = sql.slice(sql.lastIndexOf("EXCEPTION WHEN OTHERS THEN"));
  assert.match(
    catcher,
    /SQLSTATE = 'P0001' AND SQLERRM = 'v2_persistence_blocked'/,
  );
  assert.match(catcher, /'status', 'blocked'/);
  assert.match(catcher, /'status', 'failed'.*'internal_failure'/);
  assert.doesNotMatch(sql, /\b(COMMIT|ROLLBACK|EXECUTE|DELETE|TRUNCATE)\b/i);
});

test("D4D2 integration and fingerprint replay are locked before any CREATE or UPDATE", () => {
  const replay = between(
    sql,
    "v_stage := 'replay_resolution'",
    "v_stage := 'store_revalidation'",
  );
  assert.match(replay, /integration\.id = _integration_id\s+FOR UPDATE/);
  for (
    const field of [
      "integration_id",
      "provider",
      "persistence_contract_version",
      "plan_fingerprint_algorithm",
      "plan_fingerprint",
    ]
  ) {
    assert.ok(replay.includes(`run.${field} = _${field}`), field);
  }
  assert.match(
    replay,
    /IF v_run_id IS NOT NULL THEN\s+v_status := 'replayed_existing';\s+ELSE/,
  );
  assert.doesNotMatch(
    between(replay, "IF v_run_id IS NOT NULL THEN", "ELSE"),
    /INSERT|UPDATE public/,
  );
});

test("D4D2 replay checks durable run metadata and never reads current mutable catalog rows", () => {
  for (
    const field of [
      "integration_id",
      "provider",
      "persistence_contract_version",
      "plan_fingerprint_algorithm",
      "plan_fingerprint",
    ]
  ) {
    assert.ok(
      durable.includes(`v_run.${field} IS DISTINCT FROM _${field}`),
      field,
    );
  }
  assert.match(
    durable,
    /v_run\.plan_evaluated_at IS DISTINCT FROM _evaluation_timestamp/,
  );
  assert.match(
    durable,
    /v_run\.persistence_counts->'expected' IS DISTINCT FROM _expected_counts/,
  );
  assert.doesNotMatch(
    durable,
    /FROM public\.(stores|coupons)|UPDATE public\.|INSERT INTO/,
  );
});

test("D4D2 durable ledger binds every canonical ordinal identity action and outcome", () => {
  for (
    const field of [
      "instructionOrdinal",
      "providerEntityNamespace",
      "providerEntityId",
    ]
  ) {
    assert.ok(
      durable.includes(
        `v_evidence->'${field}' IS DISTINCT FROM v_instruction->'${field}'`,
      ),
      field,
    );
  }
  assert.match(
    durable,
    /v_evidence->>'plannedAction' IS DISTINCT FROM v_action/,
  );
  assert.match(durable, /v_evidence->>'outcome' IS DISTINCT FROM v_outcome/);
  assert.match(
    durable,
    /CASE v_action WHEN 'create' THEN 'created'\s+WHEN 'update_existing' THEN 'updated_existing' ELSE 'noop_existing' END/,
  );
});

test("D4D2 UPDATE and NOOP ledger entity UUID must equal the exact expected UUID", () => {
  assert.match(
    durable,
    /\(v_evidence->>'expectedEntityId'\)::uuid IS DISTINCT FROM v_expected_id/,
  );
  assert.match(
    durable,
    /v_expected_id IS NOT NULL AND v_entity_id IS DISTINCT FROM v_expected_id/,
  );
  assert.match(durable, /v_seen_entities \? v_entity_id::text/);
});

test("D4D2 durable offer ledger binds the exact Campaign parent UUID and coupon kind", () => {
  assert.match(durable, /v_evidence->>'offerKind' IS DISTINCT FROM 'coupon'/);
  assert.match(
    durable,
    /v_evidence->>'parentProviderEntityNamespace' IS DISTINCT FROM 'campaign'/,
  );
  assert.match(
    durable,
    /\(v_evidence->>'parentEntityId'\)::uuid IS DISTINCT FROM v_parent_store_id/,
  );
  assert.match(
    durable,
    /v_expected_parent_id IS NOT NULL AND v_parent_store_id IS DISTINCT FROM v_expected_parent_id/,
  );
});

test("D4D2 persists SQL-derived action outcome expected UUID and parent evidence", () => {
  assert.match(
    sql,
    /INSERT INTO public\.affiliate_import_run_mutations_v2 \([\s\S]*?planned_action, outcome[\s\S]*?expected_entity_id[\s\S]*?parent_entity_id, offer_kind/,
  );
  assert.match(sql, /v_evidence->>'plannedAction', v_evidence->>'outcome'/);
  assert.match(
    durable,
    /v_status = 'committed' AND v_persisted_ledger IS DISTINCT FROM v_ledger/,
  );
});

test("D4D2 uses strict D4D1 counts for CREATE UPDATE NOOP and records_updated", () => {
  assert.match(
    sql,
    /affiliate_sync_ads_v2_valid_refresh_expected_counts\(_expected_counts\)/,
  );
  assert.equal(
    (sql.match(
      /affiliate_sync_ads_v2_valid_refresh_persistence_counts\(v_persistence_counts\)/g,
    ) ?? []).length,
    2,
  );
  assert.equal(
    (sql.match(
      /v_records_updated := public\.affiliate_sync_ads_v2_refresh_records_updated\(v_persistence_counts\)/g,
    ) ?? []).length,
    2,
  );
  for (
    const [name, variable] of [
      ["storesCreated", "v_stores_created"],
      ["storesUpdatedExisting", "v_stores_updated"],
      ["storesNoopExisting", "v_stores_noop"],
      ["offersCreated", "v_offers_created"],
      ["offersUpdatedExisting", "v_offers_updated"],
      ["offersNoopExisting", "v_offers_noop"],
    ]
  ) assert.ok(sql.includes(`'${name}', ${variable}`), name);
  assert.match(
    durable,
    /v_persistence_counts IS DISTINCT FROM v_run\.persistence_counts/,
  );
  assert.match(
    durable,
    /v_run\.records_updated IS DISTINCT FROM v_records_updated/,
  );
});

test("D4D2 run evidence remains successful non-preview committed and operationally reconciled", () => {
  for (
    const marker of [
      "v_run.preview IS DISTINCT FROM false",
      "v_run.success IS DISTINCT FROM true",
      "v_run.persistence_execution_status IS DISTINCT FROM 'committed'",
      "v_run.finished_at IS NULL",
      "v_run.triggered_by IS NULL",
      "v_run.error_message IS NOT NULL",
      "v_run.records_processed IS DISTINCT FROM",
      "v_run.records_created IS DISTINCT FROM",
      "v_run.records_skipped IS DISTINCT FROM",
      "v_run.records_published IS DISTINCT FROM",
      "v_run.records_held IS DISTINCT FROM",
      "v_run.records_fetched IS DISTINCT FROM",
      "v_run.new_provider_identities IS DISTINCT FROM",
      "v_run.existing_provider_identities IS DISTINCT FROM",
    ]
  ) assert.ok(durable.includes(marker), marker);
  assert.match(durable, /'run_coherence_mismatch'/);
});

test("D4D2 success result has exactly the existing validator root fields", () => {
  const result = between(durable, "RETURN jsonb_build_object(", ");");
  const keys = [...result.matchAll(/'([a-zA-Z]+)',/g)].map((m) => m[1]);
  assert.deepEqual(keys, [
    "status",
    "runId",
    "persistenceContractVersion",
    "planFingerprintAlgorithm",
    "planFingerprint",
    "evaluationTimestamp",
    "counts",
    "createdStores",
    "createdOffers",
    "noops",
    "stores",
    "offers",
    "ledger",
  ]);
  assert.doesNotMatch(
    result,
    /couponCode|affiliateUrl|metadata|projection|provider'|integrationId/,
  );
});

test("D4D2 errors are fixed bounded diagnostics with no raw exception or payload exposure", () => {
  const catcher = sql.slice(sql.lastIndexOf("EXCEPTION WHEN OTHERS THEN"));
  for (
    const statement of catcher.match(/RETURN jsonb_build_object\([^;]+;/g) ?? []
  ) {
    assert.doesNotMatch(
      statement,
      /SQLERRM|SQLSTATE|v_instruction|v_projection|v_state|_store_instructions|_offer_instructions/,
    );
  }
  assert.doesNotMatch(
    sql,
    /RAISE (?:NOTICE|WARNING|LOG)|GET STACKED DIAGNOSTICS/,
  );
});

test("D4D2 malformed request casts become bounded blockers rather than SQL errors", () => {
  const catcher = sql.slice(sql.lastIndexOf("EXCEPTION WHEN OTHERS THEN"));
  assert.match(
    catcher,
    /v_stage = 'request_validation' AND SQLSTATE LIKE '22%' THEN\s+RETURN jsonb_build_object\('status', 'blocked', 'stage', v_stage, 'reason', 'invalid_request'\)/,
  );
});

test("D4D2 introduces no V1 dependency destructive SQL or generic count-helper redefinition", () => {
  assert.doesNotMatch(
    sql,
    /public\.import_apply|DELETE\s+FROM|TRUNCATE|UPDATE[^;]*lifecycle_hidden\s*=/i,
  );
  assert.doesNotMatch(
    sql,
    /public\.affiliate_sync_v2_valid_(?:expected|persistence)_counts\(/,
  );
  assert.doesNotMatch(
    sql,
    /ALTER TABLE|DROP CONSTRAINT|CREATE TRIGGER|CREATE POLICY/i,
  );
});

test("D4D2 leaves every historical migration byte-identical", () => {
  const names = readdirSync(migrations)
    .filter((name) => name.endsWith(".sql") && name < migrationName).sort();
  assert.equal(names.length, 51);
  const hash = createHash("sha256");
  for (const name of names) {
    hash.update(name + "\0").update(readFileSync(new URL(name, migrations)))
      .update("\0");
  }
  assert.equal(
    hash.digest("hex"),
    "90ff5416de94397b2405b5e66814d123c686fc637885fd4ef68618e325f9566d",
  );
});

test("D4D2 leaves D4D1 strict counts and historical CREATE-to-NOOP ledger compatibility unchanged", () => {
  assert.equal(
    digest(d4d1),
    "60e73483bd94652904b04bc9efc035400f48265ab02e1f065154f5401631bd94",
  );
  assert.match(
    d4d1,
    /planned_action = 'create'[\s\S]*?outcome IN \(\s+'created',\s+'noop_existing'/,
  );
  for (const kind of ["stores", "offers"]) {
    assert.ok(
      d4d1.includes(
        `(_counts#>>'{actual,${kind}Created}')::numeric =\n      (_counts#>>'{expected,${kind},create}')::numeric`,
      ),
    );
  }
  assert.match(d4d1, /AND records_updated = 0/);
});

test("D4D2 leaves the strict Ads-2 result validator byte-identical", () => {
  const validator = readFileSync(
    new URL("../persistence-refresh-result.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    digest(validator),
    "1699a30c703491cb5657fa45596c75dcad43bccab26f5fe31d9e72062814f58a",
  );
});

test("D4D2 leaves executable Ads-1 planner hash unchanged", () => {
  const planner = readFileSync(
    new URL(
      "../../_shared/affiliate-sync-v2-ads-persistence/AdsPersistencePlannerV2.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const start = planner.indexOf(
    "  static plan(input: AdsPersistencePlannerInputV2): AdsPersistencePlanV2 {",
  );
  assert.ok(start >= 0);
  assert.equal(
    digest(planner.slice(start)),
    "2159faaad3d77c8c62c7e5f2e72b0f686f04d45b7b803fb1c577f929a3b67389",
  );
});
