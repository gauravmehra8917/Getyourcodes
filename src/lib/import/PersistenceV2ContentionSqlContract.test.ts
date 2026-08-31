import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const historicalMigrationUrl = new URL(
  "../../../supabase/migrations/20260819090000_affiliate_sync_v2_persistence.sql",
  import.meta.url,
);
const repairMigrationUrl = new URL(
  "../../../supabase/migrations/20260826160000_affiliate_sync_v2_contention_revalidation.sql",
  import.meta.url,
);
const historicalMigration = readFileSync(historicalMigrationUrl, "utf8");
const repairMigration = readFileSync(repairMigrationUrl, "utf8");
const executableSql = repairMigration
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

test("A9C-R1 leaves the historical reviewed migration byte-identical", () => {
  assert.equal(
    createHash("sha256").update(historicalMigration).digest("hex"),
    "19b2b0dd072d00178daab37f4e315f4a079868ea02e05f5706672d09afd173ec",
  );
  assert.ok(repairMigrationUrl.pathname > historicalMigrationUrl.pathname);
});

test("A9C-R1 replaces only the settled SECURITY DEFINER RPC", () => {
  assert.equal(
    repairMigration.match(
      /CREATE OR REPLACE FUNCTION public\.apply_affiliate_persistence_plan_v2\(/g,
    )?.length,
    1,
  );
  assert.match(
    repairMigration,
    /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/,
  );
  assert.doesNotMatch(
    executableSql,
    /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|POLICY|TYPE|SCHEMA)\b/i,
  );
  assert.doesNotMatch(executableSql, /\b(?:REVOKE|GRANT)\b/i);
  assert.doesNotMatch(executableSql, /\bimport_apply\s*\(/i);
  assert.doesNotMatch(
    executableSql,
    /\b(?:UPDATE|DELETE\s+FROM)\s+public\.(?:stores|coupons)\b/i,
  );
});

test("A9C-R1 store create settles an audited conflict only by exact identity or exact slug", () => {
  const start = repairMigration.indexOf(
    "-- Stores are resolved only by exact provider identity",
  );
  const end = repairMigration.indexOf(
    "v_stage := 'offer_revalidation';",
    start,
  );
  const storeBlock = repairMigration.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(
    storeBlock,
    /INSERT INTO public\.stores[\s\S]*ON CONFLICT \(provider, provider_entity_id\)\s+WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL\s+DO NOTHING[\s\S]*RETURNING id INTO v_entity_id/,
  );
  assert.ok(
    (storeBlock.match(/store\.provider = 'impact'/g)?.length ?? 0) >= 2,
  );
  assert.ok(
    (storeBlock.match(/store\.provider_entity_id = v_provider_entity_id/g)
      ?.length ?? 0) >= 2,
  );
  assert.ok(
    (storeBlock.match(/WHERE store\.slug = v_slug/g)?.length ?? 0) >= 2,
  );
  assert.match(
    storeBlock,
    /EXCEPTION WHEN unique_violation THEN[\s\S]*CONSTRAINT_NAME[\s\S]*stores_slug_key[\s\S]*RAISE;[\s\S]*v_conflicting_store_id IS DISTINCT FROM v_existing_store_id[\s\S]*store_slug_collision/,
  );
  assert.match(
    storeBlock,
    /v_existing_store_id IS NULL[\s\S]*v2_persistence_store_conflict_unresolved/,
  );
  assert.match(
    storeBlock,
    /v_existing_store_origin IS DISTINCT FROM 'provider'[\s\S]*v_existing_store_managed IS DISTINCT FROM true[\s\S]*v_existing_store_hidden IS DISTINCT FROM false[\s\S]*v_existing_store_qualification = 'unqualified'[\s\S]*incompatible_store/,
  );
  assert.doesNotMatch(storeBlock, /provider_entity_id[^;]*\bOR\b[^;]*slug/i);
});

test("A9C-R1 offer create targets only the partial provider-identity index and revalidates", () => {
  const start = repairMigration.indexOf("v_stage := 'offer_revalidation';");
  const end = repairMigration.indexOf("v_stage := 'reconciliation';", start);
  const offerBlock = repairMigration.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(
    offerBlock,
    /INSERT INTO public\.coupons[\s\S]*ON CONFLICT \(provider, provider_entity_id\)\s+WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL\s+DO NOTHING[\s\S]*RETURNING id INTO v_entity_id/,
  );
  assert.ok(
    (offerBlock.match(/offer\.provider = 'impact'/g)?.length ?? 0) >= 2,
  );
  assert.ok(
    (offerBlock.match(/offer\.provider_entity_id = v_provider_entity_id/g)
      ?.length ?? 0) >= 2,
  );
  assert.match(
    offerBlock,
    /v_existing_offer_id IS NULL[\s\S]*v2_persistence_offer_conflict_unresolved/,
  );
  assert.match(
    offerBlock,
    /v_existing_offer_kind IS DISTINCT FROM[\s\S]*offer_kind_conflict/,
  );
  assert.match(
    offerBlock,
    /v_existing_offer_parent IS DISTINCT FROM v_parent_store_id[\s\S]*parent_store_mismatch/,
  );
});

test("A9C-R1 adds no updates, advisory locks, retries, or unbounded diagnostics", () => {
  assert.doesNotMatch(executableSql, /ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i);
  assert.doesNotMatch(executableSql, /pg_(?:try_)?advisory/i);
  assert.doesNotMatch(
    executableSql,
    /\bLOOP\b[\s\S]*ON CONFLICT[\s\S]*\bRETRY\b/i,
  );
  const handler = repairMigration.indexOf("EXCEPTION WHEN OTHERS THEN");
  const end = repairMigration.indexOf("$function$;", handler);
  const bounded = repairMigration.slice(handler, end);
  assert.match(bounded, /'status', 'blocked'/);
  assert.match(bounded, /'status', 'failed'/);
  assert.match(bounded, /'reason', 'internal_failure'/);
  assert.doesNotMatch(
    bounded,
    /'sql(?:State|Message|Detail|Hint|Constraint)'/i,
  );
});
