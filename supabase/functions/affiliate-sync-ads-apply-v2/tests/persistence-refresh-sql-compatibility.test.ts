import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260923103000_affiliate_sync_ads_v2_refresh_compatibility.sql";

const sql =
  readFileSync(
    migrationPath,
    "utf8",
  );

test(
  "D4D1 adds Ads-2-specific count helpers without redefining historical helpers",
  () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.affiliate_sync_ads_v2_valid_refresh_expected_counts\(/,
    );

    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.affiliate_sync_ads_v2_valid_refresh_persistence_counts\(/,
    );

    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.affiliate_sync_ads_v2_refresh_records_updated\(/,
    );

    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.affiliate_sync_v2_valid_expected_counts\(/,
    );

    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.affiliate_sync_v2_valid_persistence_counts\(/,
    );
  },
);

test(
  "Ads-2 expected counts include UPDATE dimensions and writable totals",
  () => {
    for (
      const marker of [
        "'updateExisting'",
        "{stores,updateExisting}",
        "{offers,updateExisting}",
        "'writableStores'",
        "'writableOffers'",
        "'writableEntities'",
      ]
    ) {
      assert.ok(
        sql.includes(
          marker,
        ),
        marker,
      );
    }

    assert.match(
      sql,
      /writableStores'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{stores,create\}'\)::numeric\s*\n\s*\+\s*\(_counts#>>'\{stores,updateExisting\}'\)::numeric/,
    );

    assert.match(
      sql,
      /writableOffers'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{offers,create\}'\)::numeric\s*\n\s*\+\s*\(_counts#>>'\{offers,updateExisting\}'\)::numeric/,
    );
  },
);

test(
  "Ads-2 persistence counts reconcile CREATE UPDATE NOOP and ledger rows exactly",
  () => {
    for (
      const marker of [
        "'storesCreated'",
        "'storesUpdatedExisting'",
        "'storesNoopExisting'",
        "'offersCreated'",
        "'offersUpdatedExisting'",
        "'offersNoopExisting'",
        "'ledgerRows'",
      ]
    ) {
      assert.ok(
        sql.includes(
          marker,
        ),
        marker,
      );
    }

    assert.match(
      sql,
      /\{actual,storesCreated\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,stores,create\}'\)::numeric/,
    );

    assert.match(
      sql,
      /\{actual,storesUpdatedExisting\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,stores,updateExisting\}'\)::numeric/,
    );

    assert.match(
      sql,
      /\{actual,storesNoopExisting\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,stores,noopExisting\}'\)::numeric/,
    );

    assert.match(
      sql,
      /\{actual,offersCreated\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,offers,create\}'\)::numeric/,
    );

    assert.match(
      sql,
      /\{actual,offersUpdatedExisting\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,offers,updateExisting\}'\)::numeric/,
    );

    assert.match(
      sql,
      /\{actual,offersNoopExisting\}'\)::numeric\s*=\s*\n\s*\(_counts#>>'\{expected,offers,noopExisting\}'\)::numeric/,
    );
  },
);

test(
  "records_updated is derived only from exact store and offer UPDATE outcomes",
  () => {
    const start =
      sql.indexOf(
        "public.affiliate_sync_ads_v2_refresh_records_updated",
      );

    assert.notEqual(
      start,
      -1,
    );

    const block =
      sql.slice(
        start,
        sql.indexOf(
          "$function$;",
          start,
        ) +
          "$function$;".length,
      );

    assert.match(
      block,
      /\{actual,storesUpdatedExisting\}/,
    );

    assert.match(
      block,
      /\{actual,offersUpdatedExisting\}/,
    );

    assert.doesNotMatch(
      block,
      /\{actual,storesCreated\}/,
    );

    assert.doesNotMatch(
      block,
      /\{actual,offersCreated\}/,
    );
  },
);

test(
  "shared ledger preserves historical CREATE and NOOP semantics while adding exact UPDATE evidence",
  () => {
    assert.ok(
      sql.includes(
        "planned_action IN (\n        'create',\n        'noop_existing',\n        'update_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "outcome IN (\n        'created',\n        'noop_existing',\n        'updated_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "planned_action = 'create'",
      ),
    );

    assert.ok(
      sql.includes(
        "outcome IN (\n          'created',\n          'noop_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "planned_action = 'noop_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "outcome = 'noop_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "planned_action = 'update_existing'",
      ),
    );

    assert.ok(
      sql.includes(
        "outcome = 'updated_existing'",
      ),
    );

    const expectedIdentityChecks =
      sql.match(
        /entity_id = expected_entity_id/g,
      ) ?? [];

    assert.equal(
      expectedIdentityChecks.length,
      2,
    );
  },
);

test(
  "historical run contracts retain records_updated zero while Ads-2 gets isolated update-aware coherence",
  () => {
    assert.ok(
      sql.includes(
        "'v2-a9b-1'",
      ),
    );

    assert.ok(
      sql.includes(
        "'v2-a9b-2'",
      ),
    );

    assert.ok(
      sql.includes(
        "'v2-a11-ads-1'",
      ),
    );

    assert.ok(
      sql.includes(
        "'v2-a11-ads-2'",
      ),
    );

    assert.ok(
      sql.includes(
        "AND public.affiliate_sync_v2_valid_persistence_counts(\n              persistence_counts",
      ),
    );

    assert.ok(
      sql.includes(
        "AND records_updated = 0",
      ),
    );

    assert.ok(
      sql.includes(
        "persistence_contract_version =\n              'v2-a11-ads-2'",
      ),
    );

    assert.ok(
      sql.includes(
        "affiliate_sync_ads_v2_valid_refresh_persistence_counts",
      ),
    );

    assert.ok(
      sql.includes(
        "affiliate_sync_ads_v2_refresh_records_updated",
      ),
    );
  },
);

test(
  "D4D1 introduces no Ads-2 executor or dispatcher",
  () => {
    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION\s+private\./,
    );

    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.apply_affiliate_persistence_plan_v2\(/,
    );

    assert.doesNotMatch(
      sql,
      /_persistence_contract_version\s*=\s*'v2-a11-ads-2'\s+THEN/i,
    );
  },
);

test(
  "D4D1 contains no data mutation statements against production rows",
  () => {
    const executableDml =
      sql
        .split("\n")
        .filter(
          (line) =>
            /^(?:\s*)(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(
              line,
            ),
        );

    assert.deepEqual(
      executableDml,
      [],
    );
  },
);

test(
  "new helper permissions remain service-role-only",
  () => {
    for (
      const helper of [
        "affiliate_sync_ads_v2_valid_refresh_expected_counts",
        "affiliate_sync_ads_v2_valid_refresh_persistence_counts",
        "affiliate_sync_ads_v2_refresh_records_updated",
      ]
    ) {
      assert.ok(
        sql.includes(
          `public.${helper}(jsonb)\n  FROM PUBLIC, anon, authenticated`,
        ),
        helper,
      );

      assert.ok(
        sql.includes(
          `public.${helper}(jsonb)\n  TO service_role`,
        ),
        helper,
      );
    }
  },
);
