import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalCoupon, CanonicalDeal } from "@/lib/normalizers";
import { buildIdentityDiagnostics, UNASSIGNED_STORE_KEY } from "./IdentityDiagnostics";

const coupon = (id: string, overrides: Partial<CanonicalCoupon> = {}): CanonicalCoupon => ({
  provider: "impact",
  providerCouponId: id,
  providerStoreId: "store-1",
  providerAdvertiserId: "advertiser-1",
  providerCampaignId: "campaign-1",
  title: `Coupon ${id}`,
  description: null,
  code: "SAVE",
  discountType: "percentage",
  discountValue: 10,
  startDate: null,
  endDate: null,
  trackingUrl: null,
  terms: null,
  status: "active",
  metadata: { advertiserName: "Acme Tools" },
  ...overrides,
});

const deal = (id: string, overrides: Partial<CanonicalDeal> = {}): CanonicalDeal => ({
  provider: "impact",
  providerDealId: id,
  providerStoreId: "store-2",
  providerAdvertiserId: null,
  providerCampaignId: "campaign-2",
  title: `Deal ${id}`,
  description: null,
  trackingUrl: null,
  startDate: null,
  endDate: null,
  status: "active",
  metadata: { CampaignName: "Bolt Supply" },
  ...overrides,
});

test("reports normalized offer identities with the current effective key precedence", () => {
  const diagnostics = buildIdentityDiagnostics(
    [coupon("coupon-1"), coupon("coupon-2", { providerAdvertiserId: "", providerStoreId: null, providerCampaignId: null })],
    [deal("deal-1")],
  );

  assert.equal(diagnostics.totalNormalizedCoupons, 2);
  assert.equal(diagnostics.totalNormalizedDeals, 1);
  assert.equal(diagnostics.uniqueProviderAdvertiserIds, 1);
  assert.equal(diagnostics.uniqueProviderStoreIds, 2);
  assert.equal(diagnostics.uniqueProviderCampaignIds, 2);
  assert.equal(diagnostics.uniqueEffectiveStoreKeys, 3);
  assert.equal(diagnostics.offersResolvingToUnassigned, 1);
  assert.deepEqual(diagnostics.topStoreKeys.find((row) => row.effectiveStoreKey === "advertiser-1"), {
    effectiveStoreKey: "advertiser-1",
    coupons: 1,
    deals: 0,
    merchantNames: ["Acme Tools"],
  });
  assert.equal(diagnostics.topStoreKeys.some((row) => row.effectiveStoreKey === UNASSIGNED_STORE_KEY), true);
  assert.deepEqual(diagnostics.sampleOffers[0], {
    offerTitle: "Coupon coupon-1",
    merchantName: "Acme Tools",
    providerEntityId: "coupon-1",
    providerAdvertiserId: "advertiser-1",
    providerStoreId: "store-1",
    providerCampaignId: "campaign-1",
    effectiveStoreKey: "advertiser-1",
  });
});
