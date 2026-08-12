import assert from "node:assert/strict";
import test from "node:test";
import { ImpactMerchantResolver } from "../ImpactMerchantResolver.ts";
import { ImpactOfferNormalizer } from "../ImpactOfferNormalizer.ts";
import { OfferQualification } from "../OfferQualification.ts";
import {
  DEFAULT_PUBLISHING_POLICY_CONFIG_V2,
  PublishingPolicy,
  StoreQualification,
} from "../PublishingPolicy.ts";
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
import { policyCampaigns, policyPromotions, policySnapshot } from "./fixtures/publishing-policy.ts";

const EVALUATION_TIMESTAMP = "2026-06-01T00:00:00Z";

function matched(
  promotions: readonly RawImpactPromotionV2[],
  campaigns: readonly RawImpactCampaignV2[],
  snapshot: ExistingCatalogSnapshotV2 = { stores: [], offers: [] },
) {
  const resolved = ImpactMerchantResolver.resolve(promotions, campaigns);
  const normalized = ImpactOfferNormalizer.normalize(promotions, resolved.promotionAssociations, campaigns);
  return StoreOfferMatcher.match(normalized, snapshot);
}

function qualify(promotions: readonly RawImpactPromotionV2[] = policyPromotions) {
  return OfferQualification.evaluate(matched(promotions, policyCampaigns, policySnapshot), {
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  });
}

function promotionVariant(
  template: RawImpactPromotionV2,
  promotionId: string,
  overrides: Partial<Pick<RawImpactPromotionV2, "campaignId" | "advertiserId" | "promotionTitle" | "trackingUrl" | "startDate" | "endDate">>,
  recordIndex: number,
): RawImpactPromotionV2 {
  return {
    ...structuredClone(template),
    ...overrides,
    promotionId,
    raw: { PromotionIds: promotionId },
    provenance: { ...template.provenance, recordIndex },
  };
}

function ids(offers: readonly { promotionId: string }[]): string[] {
  return offers.map((offer) => offer.promotionId);
}

test("classifies unresolved and provider-date conditions with an injected evaluation time", () => {
  const template = policyPromotions.find((promotion) => promotion.promotionId === "a-deal-a")!;
  const promotions = [
    promotionVariant(template, "no-dates", { trackingUrl: null, startDate: null, endDate: null }, 0),
    promotionVariant(template, "future", { startDate: "2026-06-02T00:00:00Z" }, 1),
    promotionVariant(template, "expired", { endDate: "2026-05-31T23:59:59Z" }, 2),
    promotionVariant(template, "invalid-range", {
      startDate: "2026-07-01T00:00:00Z",
      endDate: "2026-06-01T00:00:00Z",
    }, 3),
    promotionVariant(template, "invalid-date", { startDate: "not-a-provider-date" }, 4),
    promotionVariant(template, "missing-title", { promotionTitle: null }, 5),
    promotionVariant(template, "unresolved", { campaignId: null, advertiserId: null }, 6),
  ];
  const result = OfferQualification.evaluate(matched(promotions, policyCampaigns), {
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  });
  const reasons = new Map(result.ineligibleDeals.map((entry) => [entry.offer.promotionId, entry.reason]));

  assert.deepEqual(ids(result.eligibleDeals), ["no-dates"]);
  assert.deepEqual(Object.fromEntries(reasons), {
    future: "not_started",
    expired: "expired",
    "invalid-range": "invalid_date_range",
    "invalid-date": "invalid_date",
    "missing-title": "missing_title",
    unresolved: "unresolved_store",
  });
  assert.deepEqual(result.diagnostics, {
    offersEvaluated: 7,
    eligibleOffers: 1,
    ineligibleOffers: 6,
    ineligibleReasonCounts: {
      unresolved_store: 1,
      not_started: 1,
      expired: 1,
      invalid_date: 1,
      invalid_date_range: 1,
      missing_title: 1,
    },
  });
});

test("uses inclusive date boundaries and rejects an invalid reference timestamp", () => {
  const template = policyPromotions.find((promotion) => promotion.promotionId === "a-deal-a")!;
  const atStart = promotionVariant(template, "at-start", {
    startDate: EVALUATION_TIMESTAMP,
    endDate: "2026-07-01T00:00:00Z",
  }, 0);
  const atEnd = promotionVariant(template, "at-end", {
    startDate: "2026-05-01T00:00:00Z",
    endDate: EVALUATION_TIMESTAMP,
  }, 1);
  const input = matched([atStart, atEnd], policyCampaigns);

  assert.deepEqual(ids(OfferQualification.evaluate(input, {
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  }).eligibleDeals), ["at-start", "at-end"]);
  assert.throws(
    () => OfferQualification.evaluate(input, { evaluationTimestamp: "not-a-time" }),
    /evaluationTimestamp must be a valid date-time string/,
  );
});

test("applies coupon and deal limits independently to exact campaign store keys", () => {
  const result = PublishingPolicy.apply(qualify(), { maxCouponsPerStore: 2, maxDealsPerStore: 1 });
  const storeA = result.stores.find((store) => store.providerStoreKey.id === "campaign-a")!;
  const storeB = result.stores.find((store) => store.providerStoreKey.id === "campaign-b")!;

  assert.equal(result.stores.length, 2);
  assert.equal(storeA.matchedStoreId, "existing-store-a");
  assert.equal(storeB.matchedStoreId, null);
  assert.deepEqual(ids(storeA.selectedCoupons), ["a-coupon-expiring", "a-coupon-newer"]);
  assert.deepEqual(ids(storeA.selectedDeals), ["a-deal-a"]);
  assert.deepEqual(ids(storeB.selectedCoupons), ["b-coupon-a", "b-coupon-b"]);
  assert.deepEqual(ids(storeB.selectedDeals), ["b-deal-a"]);
  assert.ok([...storeA.eligibleCoupons, ...storeA.eligibleDeals].every((offer) => offer.association.providerStoreKey?.id === "campaign-a"));
  assert.ok([...storeB.eligibleCoupons, ...storeB.eligibleDeals].every((offer) => offer.association.providerStoreKey?.id === "campaign-b"));
  assert.ok(storeA.heldCoupons.every((entry) => entry.reason === "over_coupon_limit"));
  assert.ok(storeA.heldDeals.every((entry) => entry.reason === "over_deal_limit"));
  assert.ok(storeB.heldDeals.every((entry) => entry.reason === "over_deal_limit"));
  assert.deepEqual(ids(result.unresolvedHeldDeals.map((entry) => entry.offer)), ["unresolved-deal"]);
  assert.equal(result.unresolvedHeldDeals[0]?.reason, "unresolved_store");
  assert.deepEqual(result.diagnostics, {
    offersEvaluated: 12,
    eligibleOffers: 11,
    ineligibleOffers: 1,
    selectedOffers: 6,
    heldOffers: 6,
    couponsSelected: 4,
    couponsHeld: 2,
    dealsSelected: 2,
    dealsHeld: 4,
    storesCovered: 2,
    holdReasonCounts: {
      unresolved_store: 1,
      not_started: 0,
      expired: 0,
      invalid_date: 0,
      invalid_date_range: 0,
      missing_title: 0,
      over_coupon_limit: 2,
      over_deal_limit: 3,
    },
  });
});

test("uses explicit uncapped compatibility defaults", () => {
  assert.deepEqual(DEFAULT_PUBLISHING_POLICY_CONFIG_V2, {
    maxCouponsPerStore: 0,
    maxDealsPerStore: 0,
  });
  const result = PublishingPolicy.apply(qualify());

  assert.equal(result.diagnostics.selectedOffers, 11);
  assert.equal(result.diagnostics.heldOffers, 1);
  assert.equal(result.diagnostics.holdReasonCounts.unresolved_store, 1);
  assert.equal(result.diagnostics.holdReasonCounts.over_coupon_limit, 0);
  assert.equal(result.diagnostics.holdReasonCounts.over_deal_limit, 0);
});

test("ranking is stable across input order and ends with immutable PromotionId tie-breaking", () => {
  const forward = PublishingPolicy.apply(qualify(policyPromotions), {
    maxCouponsPerStore: 3,
    maxDealsPerStore: 2,
  });
  const reverse = PublishingPolicy.apply(qualify([...policyPromotions].reverse()), {
    maxCouponsPerStore: 3,
    maxDealsPerStore: 2,
  });

  assert.deepEqual(ids(forward.selectedCoupons), ids(reverse.selectedCoupons));
  assert.deepEqual(ids(forward.selectedDeals), ids(reverse.selectedDeals));
  assert.deepEqual(
    ids(forward.stores.find((store) => store.providerStoreKey.id === "campaign-a")!.selectedCoupons),
    ["a-coupon-expiring", "a-coupon-newer", "a-coupon-a"],
  );
  assert.deepEqual(
    ids(forward.stores.find((store) => store.providerStoreKey.id === "campaign-a")!.heldCoupons.map((entry) => entry.offer)),
    ["a-coupon-b"],
  );
});

test("qualification reports each threshold independently and ignores existing-store metadata", () => {
  const policy = PublishingPolicy.apply(qualify(), { maxCouponsPerStore: 2, maxDealsPerStore: 1 });
  const qualifying = StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 2,
    minimumSelectedDeals: 1,
    minimumTotalSelectedOffers: 3,
  });
  const existing = qualifying.find((store) => store.providerStoreKey.id === "campaign-a")!;
  const candidate = qualifying.find((store) => store.providerStoreKey.id === "campaign-b")!;

  assert.deepEqual(existing, {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-a" },
    matchedStoreId: "existing-store-a",
    selectedCouponCount: 2,
    selectedDealCount: 1,
    selectedTotal: 3,
    qualified: true,
    reasons: ["qualified"],
  });
  assert.deepEqual(
    { ...candidate, providerStoreKey: existing.providerStoreKey, matchedStoreId: existing.matchedStoreId },
    existing,
  );
  assert.deepEqual(StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 3,
    minimumSelectedDeals: 0,
    minimumTotalSelectedOffers: 0,
  })[0]?.reasons, ["insufficient_coupons"]);
  assert.deepEqual(StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 0,
    minimumSelectedDeals: 2,
    minimumTotalSelectedOffers: 0,
  })[0]?.reasons, ["insufficient_deals"]);
  assert.deepEqual(StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 0,
    minimumSelectedDeals: 0,
    minimumTotalSelectedOffers: 4,
  })[0]?.reasons, ["insufficient_total_offers"]);
  assert.deepEqual(StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 3,
    minimumSelectedDeals: 2,
    minimumTotalSelectedOffers: 4,
  })[0]?.reasons, ["insufficient_coupons", "insufficient_deals", "insufficient_total_offers"]);
});

test("healthy multi-brand fixture keeps two stores isolated and allows both to qualify", () => {
  const fixtureMatched = matched(
    healthyMultiBrandPromotions,
    healthyMultiBrandCampaigns,
    healthyMultiBrandSnapshot,
  );
  const eligibility = OfferQualification.evaluate(fixtureMatched, {
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  });
  const policy = PublishingPolicy.apply(eligibility);
  const qualification = StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 0,
    minimumSelectedDeals: 0,
    minimumTotalSelectedOffers: 1,
  });

  assert.deepEqual(policy.stores.map((store) => store.providerStoreKey.id), [
    "campaign-acme",
    "campaign-bravo",
  ]);
  assert.deepEqual(policy.stores.map((store) => ids([...store.selectedCoupons, ...store.selectedDeals])), [
    ["promotion-acme-coupon"],
    ["promotion-bravo-deal"],
  ]);
  assert.equal(qualification.length, 2);
  assert.ok(qualification.every((store) => store.qualified));
});

test("eligibility, policy, and qualification do not mutate offers, associations, or snapshot identity", () => {
  const promotions = structuredClone(policyPromotions);
  const campaigns = structuredClone(policyCampaigns);
  const snapshot = structuredClone(policySnapshot);
  const beforePromotions = structuredClone(promotions);
  const beforeCampaigns = structuredClone(campaigns);
  const beforeSnapshot = structuredClone(snapshot);
  const matchedInput = matched(promotions, campaigns, snapshot);
  const beforeMatched = structuredClone(matchedInput);
  const eligibility = OfferQualification.evaluate(matchedInput, {
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  });
  const beforeEligibility = structuredClone(eligibility);
  const policy = PublishingPolicy.apply(eligibility, { maxCouponsPerStore: 2, maxDealsPerStore: 1 });
  const beforePolicy = structuredClone(policy);
  StoreQualification.evaluate(policy, {
    minimumSelectedCoupons: 1,
    minimumSelectedDeals: 1,
    minimumTotalSelectedOffers: 2,
  });

  assert.deepEqual(promotions, beforePromotions);
  assert.deepEqual(campaigns, beforeCampaigns);
  assert.deepEqual(snapshot, beforeSnapshot);
  assert.deepEqual(matchedInput, beforeMatched);
  assert.deepEqual(eligibility, beforeEligibility);
  assert.deepEqual(policy, beforePolicy);
  for (const store of policy.stores) {
    for (const offer of [...store.selectedCoupons, ...store.selectedDeals]) {
      assert.equal(offer.association.providerStoreKey?.id, store.providerStoreKey.id);
      assert.equal(offer.association.matchedStoreId, store.matchedStoreId);
    }
  }
});
