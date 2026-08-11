import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalCoupon, CanonicalDeal, CanonicalStore } from "@/lib/normalizers";
import type { PublishingPolicy } from "@/lib/publishing-policy";
import type { SyncResult } from "@/lib/sync";
import { projectPreviewSyncRunReport } from "@/lib/sync/SyncRunReport";
import { prepareImportPreview } from "./ImportPreviewPipeline";
import { runImport } from "./ImportPipeline";

const policy: PublishingPolicy = {
  id: "policy", name: "Preview policy", description: null, enabled: true, isDefault: true,
  minCouponsPerStore: 2, maxCouponsPerStore: 1, minDealsPerStore: 2, maxDealsPerStore: 1,
  rankingPriority: ["discount", "newest", "expiry", "merchant_priority"], fairDistribution: false,
  rotation: false, publishOnlyActive: true, skipExpired: true, skipDuplicateIdentities: true,
  respectManualDisable: true, neverOverwriteAdminEdits: true, previewBeforeImport: true,
};

const store: CanonicalStore = {
  provider: "impact", providerStoreId: "campaign-1", providerAdvertiserId: "advertiser-1",
  providerCampaignId: "campaign-1", name: "Preview Merchant", description: "Store description",
  website: "https://merchant.example", logo: "https://merchant.example/logo.png", categories: [],
  country: "US", status: "active", commission: null, metadata: { trackingLink: "https://track.example/store" },
};

const coupon = (id: string, discountValue: number): CanonicalCoupon => ({
  provider: "impact", providerCouponId: id, providerStoreId: "advertiser-1",
  providerAdvertiserId: "advertiser-1", providerCampaignId: "campaign-1", title: `Coupon ${id}`,
  description: "Coupon description", code: "SAVE", discountType: "percentage", discountValue,
  startDate: "2026-08-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z",
  trackingUrl: "https://track.example/coupon", terms: null, status: "active", metadata: { advertiserName: "Preview Merchant" },
});

const deal: CanonicalDeal = {
  provider: "impact", providerDealId: "deal-1", providerStoreId: "advertiser-1",
  providerAdvertiserId: "advertiser-1", providerCampaignId: "campaign-1", title: "Deal one",
  description: "Deal description", trackingUrl: "https://track.example/deal",
  startDate: "2026-08-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z",
  status: "active", metadata: { advertiserName: "Preview Merchant" },
};

const sync: SyncResult = {
  provider: "impact", integrationId: "integration", startedAt: "2026-08-01T00:00:00.000Z",
  finishedAt: "2026-08-01T00:00:01.000Z", entityTypes: ["store", "coupon", "deal"],
  stores: [store], coupons: [coupon("coupon-1", 20), coupon("coupon-2", 10)], deals: [deal],
  categories: [], statistics: null,
  progress: {
    provider: "impact", integrationId: "integration", currentEntity: null, currentPage: 2,
    totalPages: 2, recordsFetched: 4, recordsNormalized: 4, elapsedMs: 100, status: "completed",
  },
  warnings: [], errors: [],
  orchestration: {
    strategy: "full_sync", pagesCrawled: 2, apiCallsUsed: 2, recordsFetched: 4,
    newProviderIdentitiesDiscovered: 3, existingProviderIdentitiesEncountered: 0, stopReason: "provider_end",
  },
};

const existing = { stores: [], categories: [], coupons: [] };

function stableReport(result: Awaited<ReturnType<typeof runImport>>) {
  assert.ok(result.body);
  const report = projectPreviewSyncRunReport(sync, result.body, 123);
  assert.ok(report.statistics);
  report.statistics.durationMs = 0;
  return report;
}

test("shared read-only preview preparation preserves the TanStack preview report", async () => {
  const direct = prepareImportPreview(sync, { existing, policy, policyContext: { now: new Date("2026-08-10T00:00:00.000Z") } });
  const legacy = await runImport(sync, {
    preview: true,
    existing,
    policy,
    policyContext: { now: new Date("2026-08-10T00:00:00.000Z") },
  });

  assert.ok(direct.body);
  assert.equal(direct.body.preview, true);
  assert.equal(direct.body.committed, false);
  assert.equal(direct.body.statistics.created, 0);
  assert.equal(direct.body.statistics.updated, 0);
  assert.equal(direct.body.publishing?.couponsPublished, 1);
  assert.equal(direct.body.plan.storeLifecycle[0]?.action, "create_store");
  assert.equal(direct.body.identityDiagnostics?.totalNormalizedCoupons, 2);

  const directReport = projectPreviewSyncRunReport(sync, direct.body, 123);
  assert.ok(directReport.statistics);
  directReport.statistics.durationMs = 0;
  assert.deepEqual(stableReport(legacy), directReport);
  assert.equal(directReport.lifecycleDiagnostics.length, 1);
  assert.equal(directReport.presentation.length, 2);
  assert.deepEqual(
    directReport.presentation.map((row) => [row.entity, row.name]),
    [
      ["store", "Preview Merchant"],
      ["coupon", "Coupon coupon-1"],
    ],
  );
  assert.equal(directReport.orchestration?.pagesCrawled, 2);
});
