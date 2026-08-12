import assert from "node:assert/strict";
import test from "node:test";
import {
  ImpactNormalizer,
  isCouponPromotion,
} from "../_shared/affiliate-sync-core/normalizers/impact/ImpactNormalizer.ts";

test("Impact normalization preserves promotion and merchant identities", () => {
  const normalizer = new ImpactNormalizer();
  const store = normalizer.normalizeStore({
    CampaignId: "campaign-42",
    AdvertiserId: "advertiser-9",
    CampaignName: "Merchant",
    TrackingLink: "https://track.example/store",
    ContractStatus: "Active",
  });
  assert.equal(store.success, true);
  assert.equal(store.body?.providerStoreId, "campaign-42");
  assert.equal(store.body?.providerCampaignId, "campaign-42");
  assert.equal(store.body?.providerAdvertiserId, "advertiser-9");

  const codedPromotion = {
    PromotionIds: "promotion-1",
    CampaignId: "campaign-42",
    AdvertiserId: "advertiser-9",
    PromotionTitle: "Save 20%",
    GenericRedemptionCode: "SAVE20",
    DiscountPercent: "20",
    TrackingUrl: "https://track.example/coupon",
    State: "Active",
  };
  const codeFreePromotion = {
    PromotionIds: "promotion-2",
    CampaignId: "campaign-42",
    AdvertiserId: "advertiser-9",
    PromotionTitle: "Free shipping",
    GenericRedemptionCode: "N/A",
    TrackingUrl: "https://track.example/deal",
    State: "Active",
  };
  assert.equal(isCouponPromotion(codedPromotion), true);
  assert.equal(isCouponPromotion(codeFreePromotion), false);

  const promotions = normalizer.normalizePromotions([codedPromotion, codeFreePromotion]);
  assert.equal(promotions.success, true);
  assert.deepEqual(promotions.body?.coupons.map((coupon) => ({
    id: coupon.providerCouponId,
    store: coupon.providerStoreId,
    advertiser: coupon.providerAdvertiserId,
    campaign: coupon.providerCampaignId,
    code: coupon.code,
  })), [{
    id: "promotion-1",
    store: "advertiser-9",
    advertiser: "advertiser-9",
    campaign: "campaign-42",
    code: "SAVE20",
  }]);
  assert.deepEqual(promotions.body?.deals.map((deal) => ({
    id: deal.providerDealId,
    store: deal.providerStoreId,
    advertiser: deal.providerAdvertiserId,
    campaign: deal.providerCampaignId,
  })), [{
    id: "promotion-2",
    store: "advertiser-9",
    advertiser: "advertiser-9",
    campaign: "campaign-42",
  }]);
});
