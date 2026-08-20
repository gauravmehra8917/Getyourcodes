import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260819090000_affiliate_sync_v2_persistence.sql",
  import.meta.url,
);
const migration = readFileSync(migrationUrl, "utf8");
const executableSql = migration
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

test("A9C-S2 uses the approved additive migration and nullable V2 run fields", () => {
  assert.equal(migrationUrl.pathname.endsWith("20260819090000_affiliate_sync_v2_persistence.sql"), true);
  for (const column of [
    "persistence_contract_version text",
    "plan_fingerprint_algorithm text",
    "plan_fingerprint text",
    "plan_evaluated_at timestamptz",
    "persistence_execution_status text",
    "persistence_counts jsonb",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}`));
    assert.doesNotMatch(migration, new RegExp(`ADD COLUMN ${column}[^,;\\n]*DEFAULT`, "i"));
  }
  assert.match(migration, /affiliate_import_runs_v2_persistence_coherence_check/);
  assert.match(migration, /persistence_contract_version IS NULL[\s\S]*persistence_counts IS NULL/);
  assert.match(migration, /persistence_execution_status IS NOT DISTINCT FROM 'committed'/);
});

test("A9C-S2 closes the persistence-count shape and integer domain", () => {
  assert.match(migration, /affiliate_sync_v2_valid_expected_counts/);
  assert.match(migration, /affiliate_sync_v2_valid_persistence_counts/);
  for (const key of [
    "blockedAmbiguous", "noopUnmatched", "noopHeld", "noopUnresolved",
    "writableStores", "writableOffers", "writableEntities",
    "storesCreated", "storesNoopExisting", "offersCreated",
    "offersNoopExisting", "ledgerRows",
  ]) assert.match(migration, new RegExp(`'${key}'`));
  assert.match(migration, /trunc\(v_number\) = v_number/);
  assert.match(migration, /v_number <= 2147483647/);
});

test("A9C-S2 replay uniqueness has the exact scoped identity", () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX affiliate_import_runs_v2_replay_uidx[\s\S]*provider,[\s\S]*integration_id,[\s\S]*persistence_contract_version,[\s\S]*plan_fingerprint_algorithm,[\s\S]*plan_fingerprint[\s\S]*WHERE preview = false[\s\S]*persistence_contract_version IS NOT NULL/,
  );
});

test("A9C-S2 ledger has closed identity, action, parent, and deletion rules", () => {
  assert.match(migration, /CREATE TABLE public\.affiliate_import_run_mutations_v2/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /UNIQUE \(run_id, instruction_ordinal\)/);
  assert.match(migration, /UNIQUE \(run_id, entity_kind, provider, provider_entity_id\)/);
  assert.match(migration, /UNIQUE \(run_id, entity_kind, entity_id\)/);
  assert.match(migration, /planned_action IN \('create', 'noop_existing'\)/);
  assert.match(migration, /outcome IN \('created', 'noop_existing'\)/);
  assert.match(migration, /entity_kind = 'offer'[\s\S]*offer_kind IS NOT NULL[\s\S]*offer_kind IN \('coupon', 'deal'\)/);
  assert.match(migration, /offer_kind IN \('coupon', 'deal'\)/);
  assert.doesNotMatch(migration, /FOREIGN KEY \(entity_id\)/);
});

test("A9C-S2 ledger is admin-readable but never browser-writable", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.affiliate_import_run_mutations_v2[\s\S]*TO authenticated, service_role/);
  assert.match(migration, /USING \(public\.is_admin\(auth\.uid\(\)\)\)/);
  assert.doesNotMatch(executableSql, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*affiliate_import_run_mutations_v2[^;]*TO\s+(?:anon|authenticated|service_role)/i);
});

test("A9C-S2 RPC is a separate hardened service-role-only boundary", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.apply_affiliate_persistence_plan_v2\(/);
  assert.match(migration, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*TO service_role/,
  );
  assert.doesNotMatch(executableSql, /GRANT EXECUTE ON FUNCTION public\.apply_affiliate_persistence_plan_v2\([\s\S]*TO (?:PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(executableSql, /(?:CREATE|ALTER|DROP|REPLACE)[^;]*import_apply/i);
});

test("A9C-S2 locks integration before replay lookup and catalog mutation", () => {
  const lock = migration.indexOf("FOR UPDATE;");
  const replay = migration.indexOf("FROM public.affiliate_import_runs AS run", lock);
  const storeInsert = migration.indexOf("INSERT INTO public.stores", lock);
  assert.ok(lock > 0);
  assert.ok(replay > lock);
  assert.ok(storeInsert > replay);
});

test("A9C-S2 preserves exact provider identities and uses slug only to block", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.affiliate_sync_v2_is_canonical_provider_id/);
  assert.match(migration, /U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680[\s\S]*\\FEFF'/);
  assert.match(migration, /CHECK \(public\.affiliate_sync_v2_is_canonical_provider_id\(provider_entity_id\)\)/);
  assert.match(migration, /public\.affiliate_sync_v2_is_canonical_provider_id\(parent_provider_entity_id\)/);
  assert.match(migration, /public\.affiliate_sync_v2_is_canonical_provider_id\(v_provider_entity_id\)/);
  assert.match(migration, /public\.affiliate_sync_v2_is_canonical_provider_id\(v_parent_provider_entity_id\)/);
  assert.match(migration, /store\.provider = 'impact'[\s\S]*store\.provider_entity_id = v_provider_entity_id/);
  assert.match(migration, /offer\.provider = 'impact'[\s\S]*offer\.provider_entity_id = v_provider_entity_id/);
  assert.match(migration, /jsonb_typeof\(v_instruction->'providerEntityId'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /jsonb_typeof\(v_instruction->'parentProviderEntityId'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /jsonb_typeof\(v_projection#>'\{metadata,campaignId\}'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /jsonb_typeof\(v_projection#>'\{metadata,resolvedCampaignId\}'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /WHERE store\.slug = v_slug[\s\S]*store_slug_collision/);
  assert.doesNotMatch(executableSql, /WHERE[^;]*(?:name|domain|affiliate_url)\s*=/i);
  assert.doesNotMatch(executableSql, /provider_entity_id[^;]*\bOR\b[^;]*slug/i);
});

test("A9C-S2 requires actual JSON booleans for store lifecycle projection fields", () => {
  assert.match(migration, /jsonb_typeof\(v_projection->'lifecycleManaged'\) IS DISTINCT FROM 'boolean'[\s\S]*v_projection->>'lifecycleManaged' IS DISTINCT FROM 'true'/);
  assert.match(migration, /jsonb_typeof\(v_projection->'lifecycleHidden'\) IS DISTINCT FROM 'boolean'[\s\S]*v_projection->>'lifecycleHidden' IS DISTINCT FROM 'false'/);
});

test("A9C-S2 never updates/deletes catalog rows or calls V1", () => {
  assert.doesNotMatch(executableSql, /UPDATE\s+public\.(?:stores|coupons)\b/i);
  assert.doesNotMatch(executableSql, /DELETE\s+FROM\s+public\.(?:stores|coupons)\b/i);
  assert.doesNotMatch(executableSql, /ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i);
  assert.doesNotMatch(executableSql, /\bimport_apply\s*\(/i);
});

test("A9C-S2 records deterministic create/no-op evidence and counts", () => {
  assert.match(migration, /plannedAction', v_action/);
  assert.match(migration, /outcome', v_outcome/);
  assert.match(migration, /ORDER BY mutation\.instruction_ordinal/);
  assert.match(migration, /ledger_count_mismatch/);
  assert.match(migration, /records_updated,[\s\S]*0,[\s\S]*v_records_skipped/);
});

test("A9C-S2 bounded failure handler encloses all catalog/run/ledger writes", () => {
  const protectedBlock = migration.indexOf("-- Every database-changing statement");
  const firstWrite = migration.indexOf("INSERT INTO public.stores", protectedBlock);
  const handler = migration.indexOf("EXCEPTION WHEN OTHERS THEN", firstWrite);
  const end = migration.indexOf("$function$;", handler);
  assert.ok(protectedBlock > 0 && firstWrite > protectedBlock && handler > firstWrite && end > handler);
  assert.match(migration.slice(handler, end), /'status', 'blocked'/);
  assert.match(migration.slice(handler, end), /'status', 'failed'/);
  assert.match(migration.slice(handler, end), /'reason', 'internal_failure'/);
  assert.doesNotMatch(migration.slice(handler, end), /'sql(?:State|Message|Detail|Hint)'/i);
});
