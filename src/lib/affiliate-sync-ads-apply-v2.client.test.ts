import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADMIN_IMPACT_IMPORT_MUTATION_OPTIONS,
  AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION,
  isExactImpactProvider,
  parseAffiliateSyncAdsApplyV2Response,
  requestAffiliateSyncAdsApplyV2,
  type AffiliateSyncAdsApplyV2Invoke,
} from "./affiliate-sync-ads-apply-v2.client.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const success = {
  status: "committed",
  runId: RUN_ID,
  mode: "full",
  evaluationTimestamp: "2026-09-11T00:00:00.000Z",
  refreshedPlan: true,
  counts: { expected: {}, actual: {} },
  created: { stores: 1, coupons: 2 },
  noops: { stores: 3, coupons: 4 },
  ledgerRows: 10,
};

test("uses the exact function slug and full-mode body without extra keys", async () => {
  let call: Parameters<AffiliateSyncAdsApplyV2Invoke> | null = null;
  const result = await requestAffiliateSyncAdsApplyV2(INTEGRATION_ID, async (...args) => {
    call = args;
    return { data: success, error: null };
  });
  assert.equal(AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION, "affiliate-sync-ads-apply-v2");
  assert.deepEqual(call, [AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION, {
    body: { integrationId: INTEGRATION_ID, execute: true, mode: "full" },
  }]);
  assert.equal(result.status, "committed");
});

test("supports committed, blocked, failed, and indeterminate responses", () => {
  assert.equal(parseAffiliateSyncAdsApplyV2Response(success)?.status, "committed");
  assert.deepEqual(parseAffiliateSyncAdsApplyV2Response({ status: "blocked", private: "removed" }), { status: "blocked" });
  assert.deepEqual(parseAffiliateSyncAdsApplyV2Response({ status: "failed", private: "removed" }), { status: "failed" });
  assert.deepEqual(parseAffiliateSyncAdsApplyV2Response({ status: "indeterminate", private: "removed" }), { status: "indeterminate" });
});

test("malformed success fails closed", () => {
  assert.equal(parseAffiliateSyncAdsApplyV2Response({ ...success, couponCode: "secret" }), null);
  assert.equal(parseAffiliateSyncAdsApplyV2Response({ ...success, runId: "bad" }), null);
});

test("matches only exact normalized Impact provider names", () => {
  for (const name of ["impact", " Impact.com ", "IMPACT RADIUS"]) assert.equal(isExactImpactProvider(name), true);
  for (const name of ["impact affiliate", "impact-radius", "impact.com.au", ""]) assert.equal(isExactImpactProvider(name), false);
});

test("admin mutation has no automatic retry and route has no active legacy controls", () => {
  assert.equal(ADMIN_IMPACT_IMPORT_MUTATION_OPTIONS.retry, false);
  const route = readFileSync("src/routes/admin.integrations.tsx", "utf8");
  for (const retired of ["runProviderSync", "runLegacyImport", "legacyImportModal", "runV2Preview", "V2PreviewResultModal", "Legacy Import (V1)"]) {
    assert.equal(route.includes(retired), false, `retired reference remains: ${retired}`);
  }
});