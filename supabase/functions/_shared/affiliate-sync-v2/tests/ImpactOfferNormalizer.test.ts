import assert from "node:assert/strict";
import test from "node:test";
import { ImpactMerchantResolver } from "../ImpactMerchantResolver.ts";
import { ImpactOfferNormalizer } from "../ImpactOfferNormalizer.ts";
import { StoreOfferMatcher } from "../StoreOfferMatcher.ts";
import type {
  ExistingCatalogSnapshotV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
} from "../models.ts";
import {
  healthyMultiBrandCampaigns,
  healthyMultiBrandPromotions,
  healthyMultiBrandSnapshot,
} from "./fixtures/healthy-multi-brand.ts";

function normalizedHealthyFixture() {
  const resolved = ImpactMerchantResolver.resolve(healthyMultiBrandPromotions, healthyMultiBrandCampaigns);
  return ImpactOfferNormalizer.normalize(
    healthyMultiBrandPromotions,
    resolved.promotionAssociations,
    healthyMultiBrandCampaigns,
  );
}

function campaign(campaignId: string, advertiserId: string): RawImpactCampaignV2 {
  return {
    campaignId,
    advertiserId,
    campaignName: "Acme",
    destinationUrl: "https://acme.example",
    trackingUrl: "https://track.example/acme",
    raw: { CampaignId: campaignId },
    provenance: {
      stream: "campaigns",
      fetchSequence: 1,
      recordIndex: 0,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Campaigns?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

function promotion(input: {
  promotionId: string;
  campaignId: string | null;
  advertiserId: string | null;
  title: string;
  genericRedemptionCode: string | null;
}): RawImpactPromotionV2 {
  return {
    promotionId: input.promotionId,
    advertiserId: input.advertiserId,
    advertiserName: "Acme",
    campaignId: input.campaignId,
    programId: "program-not-a-campaign",
    promotionTitle: input.title,
    description: "Provider description",
    genericRedemptionCode: input.genericRedemptionCode,
    trackingUrl: "https://track.example/offer",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T23:59:59Z",
    raw: { PromotionIds: input.promotionId, GenericRedemptionCode: input.genericRedemptionCode },
    provenance: {
      stream: "promotions",
      fetchSequence: 1,
      recordIndex: 0,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

function normalize(promotions: RawImpactPromotionV2[], campaigns: RawImpactCampaignV2[]) {
  const resolved = ImpactMerchantResolver.resolve(promotions, campaigns);
  return ImpactOfferNormalizer.normalize(promotions, resolved.promotionAssociations, campaigns);
}

test("uses only GenericRedemptionCode to classify coupons and deals, preserving source identity", () => {
  const normalized = normalizedHealthyFixture();
  assert.equal(normalized.normalizedCoupons.length, 1);
  assert.equal(normalized.normalizedDeals.length, 1);
  const coupon = normalized.normalizedCoupons[0]!;
  const deal = normalized.normalizedDeals[0]!;

  assert.equal(coupon.kind, "coupon");
  assert.equal(coupon.code, "ACME10");
  assert.equal(deal.kind, "deal");
  assert.deepEqual(
    [coupon.promotionId, coupon.advertiserId, coupon.advertiserName, coupon.campaignId, coupon.programId],
    ["promotion-acme-coupon", "advertiser-acme", "Acme", "campaign-acme", "program-campaign-acme"],
  );
  assert.deepEqual(coupon.association, {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
    matchedStoreId: null,
    matchMethod: "campaign_id",
    unresolvedReason: null,
  });
  assert.equal(coupon.provenance, healthyMultiBrandPromotions[0]!.provenance);
  assert.deepEqual(normalized.diagnostics, {
    deduplicatedPromotionsEvaluated: 2,
    couponsNormalized: 1,
    dealsNormalized: 1,
    offersUnresolvedFromA4: 0,
    offersWithResolvedProviderStoreKey: 2,
    storesNormalized: 2,
  });
});

test("normalizes stores only from resolved campaign-backed candidates and keeps brands isolated", () => {
  const normalized = normalizedHealthyFixture();
  assert.deepEqual(normalized.normalizedStores.map((store) => ({
    key: store.providerStoreKey,
    campaignId: store.campaignId,
    advertiserId: store.advertiserId,
    name: store.name,
  })), [
    {
      key: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
      campaignId: "campaign-acme", advertiserId: "advertiser-acme", name: "Acme",
    },
    {
      key: { provider: "impact", namespace: "campaign", id: "campaign-bravo" },
      campaignId: "campaign-bravo", advertiserId: "advertiser-bravo", name: "Bravo",
    },
  ]);
  assert.notDeepEqual(
    normalized.normalizedCoupons[0]?.association.providerStoreKey,
    normalized.normalizedDeals[0]?.association.providerStoreKey,
  );
});

test("matches only an exact snapshot provider-store key and detects existing promotions by exact PromotionId", () => {
  const normalized = normalizedHealthyFixture();
  const matched = StoreOfferMatcher.match(normalized, healthyMultiBrandSnapshot);
  const coupon = matched.normalizedCoupons[0]!;
  const deal = matched.normalizedDeals[0]!;

  assert.equal(coupon.association.matchedStoreId, "store-acme-existing");
  assert.equal(coupon.existingPromotionIdentity, "existing");
  assert.equal(coupon.existingOfferId, "offer-acme-existing");
  assert.equal(deal.association.matchedStoreId, null);
  assert.equal(deal.existingPromotionIdentity, "new");
  assert.deepEqual(matched.diagnostics, {
    offersEvaluated: 2,
    offersUnresolvedFromA4: 0,
    offersWithResolvedProviderStoreKey: 2,
    offersMatchedToExistingStore: 1,
    resolvedProviderStoreKeysWithNoExistingStore: 1,
    ambiguousSnapshotStoreKeys: 0,
    newPromotionIdentities: 1,
    existingPromotionIdentities: 1,
  });
});

test("does not use similarly named or advertiser-related snapshot data for an approximate store match", () => {
  const promotions = [promotion({
    promotionId: "promotion-c1", campaignId: "campaign-c1", advertiserId: "advertiser-acme", title: "Acme offer", genericRedemptionCode: "CODE",
  })];
  const normalized = normalize(promotions, [campaign("campaign-c1", "advertiser-acme")]);
  const snapshot = {
    stores: [{
      id: "store-similar-only",
      providerStoreKey: { provider: "impact" as const, namespace: "campaign" as const, id: "campaign-other" },
      name: "Acme",
      advertiserId: "advertiser-acme",
    }],
    offers: [],
  };
  const matched = StoreOfferMatcher.match(normalized, snapshot);

  assert.equal(matched.normalizedCoupons[0]?.association.providerStoreKey?.id, "campaign-c1");
  assert.equal(matched.normalizedCoupons[0]?.association.matchedStoreId, null);
  assert.equal(matched.diagnostics.resolvedProviderStoreKeysWithNoExistingStore, 1);
});

test("unmatched A4 offers remain unmatched and ambiguous exact snapshot keys do not select a store", () => {
  const unmatchedPromotion = promotion({
    promotionId: "promotion-unmatched", campaignId: null, advertiserId: null, title: "Unmatched", genericRedemptionCode: null,
  });
  const unmatchedNormalized = normalize([unmatchedPromotion], []);
  const snapshot: ExistingCatalogSnapshotV2 = {
    stores: [{ id: "store-not-a-rescue", providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-c1" } }],
    offers: [],
  };
  const unmatched = StoreOfferMatcher.match(unmatchedNormalized, snapshot);
  assert.equal(unmatchedNormalized.normalizedStores.length, 0);
  assert.deepEqual(unmatched.normalizedDeals[0]?.association, {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "missing_merchant_identity",
  });

  const resolvedNormalized = normalize([
    promotion({ promotionId: "promotion-ambiguous-snapshot", campaignId: "campaign-c1", advertiserId: "advertiser-acme", title: "Acme", genericRedemptionCode: null }),
  ], [campaign("campaign-c1", "advertiser-acme")]);
  const ambiguous = StoreOfferMatcher.match(resolvedNormalized, {
    stores: [
      { id: "store-one", providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-c1" } },
      { id: "store-two", providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-c1" } },
    ],
    offers: [],
  });
  assert.equal(ambiguous.normalizedDeals[0]?.association.matchedStoreId, null);
  assert.equal(ambiguous.diagnostics.ambiguousSnapshotStoreKeys, 1);
});

test("existing promotion identity ignores title and code, while a different PromotionId stays new", () => {
  const promotions = [
    promotion({ promotionId: "promotion-existing", campaignId: "campaign-c1", advertiserId: "advertiser-acme", title: "Different title", genericRedemptionCode: "DIFFERENT" }),
    promotion({ promotionId: "promotion-new", campaignId: "campaign-c1", advertiserId: "advertiser-acme", title: "Different title", genericRedemptionCode: "DIFFERENT" }),
  ];
  const normalized = normalize(promotions, [campaign("campaign-c1", "advertiser-acme")]);
  const matched = StoreOfferMatcher.match(normalized, {
    stores: [],
    offers: [{ id: "existing-offer", promotionId: "promotion-existing" }],
  });
  assert.equal(matched.normalizedCoupons[0]?.existingPromotionIdentity, "existing");
  assert.equal(matched.normalizedCoupons[1]?.existingPromotionIdentity, "new");
  assert.deepEqual([matched.diagnostics.existingPromotionIdentities, matched.diagnostics.newPromotionIdentities], [1, 1]);
});

test("does not mutate provider inputs, A4 associations, normalized inputs, or snapshots", () => {
  const promotions = structuredClone(healthyMultiBrandPromotions);
  const campaigns = structuredClone(healthyMultiBrandCampaigns);
  const snapshot = structuredClone(healthyMultiBrandSnapshot);
  const resolved = ImpactMerchantResolver.resolve(promotions, campaigns);
  const beforePromotions = structuredClone(promotions);
  const beforeCampaigns = structuredClone(campaigns);
  const beforeAssociations = structuredClone(resolved.promotionAssociations);
  const normalized = ImpactOfferNormalizer.normalize(promotions, resolved.promotionAssociations, campaigns);
  const beforeNormalized = structuredClone(normalized);
  const beforeSnapshot = structuredClone(snapshot);
  StoreOfferMatcher.match(normalized, snapshot);

  assert.deepEqual(promotions, beforePromotions);
  assert.deepEqual(campaigns, beforeCampaigns);
  assert.deepEqual(resolved.promotionAssociations, beforeAssociations);
  assert.deepEqual(normalized, beforeNormalized);
  assert.deepEqual(snapshot, beforeSnapshot);
});
