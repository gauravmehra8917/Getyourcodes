import assert from "node:assert/strict";
import test from "node:test";
import { ImpactMerchantResolver } from "../ImpactMerchantResolver.ts";
import { ImpactOfferNormalizer } from "../ImpactOfferNormalizer.ts";
import { OfferQualification } from "../OfferQualification.ts";
import { PreviewPlanner } from "../PreviewPlanner.ts";
import { PublishingPolicy, StoreQualification } from "../PublishingPolicy.ts";
import { RawPromotionDeduplicator } from "../RawPromotionDeduplicator.ts";
import { StoreOfferMatcher } from "../StoreOfferMatcher.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "../models.ts";
import {
  healthyMultiBrandCampaigns,
  healthyMultiBrandPromotions,
  healthyMultiBrandSnapshot,
} from "./fixtures/healthy-multi-brand.ts";
import { overlappingPagePromotions } from "./fixtures/overlapping-pages.ts";
import { policyCampaigns, policyPromotions, policySnapshot } from "./fixtures/publishing-policy.ts";

test("raw-promotion deduplication invariants hold for the overlapping-pages fixture", () => {
  const result = RawPromotionDeduplicator.deduplicate(overlappingPagePromotions);
  const inputIds = new Set(overlappingPagePromotions.map((entry) => entry.promotionId));
  const outputIds = result.uniquePromotions.map((entry) => entry.promotionId);
  const duplicateIds = new Set(result.duplicateDiagnostics.map((entry) => entry.promotionId));

  assert.ok(result.uniquePromotions.length <= result.stats.acceptedInputRecords);
  assert.equal(
    result.stats.uniquePromotions + result.stats.duplicateRecordsRemoved,
    result.stats.acceptedInputRecords,
  );
  assert.equal(new Set(outputIds).size, outputIds.length);
  assert.equal(result.stats.uniquePromotions, inputIds.size);
  assert.deepEqual([...duplicateIds], ["C"]);
  assert.ok([...duplicateIds].every((promotionId) => inputIds.has(promotionId)));

  for (const diagnostic of result.duplicateDiagnostics) {
    assert.ok(diagnostic.totalOccurrences > 1);
    const first = overlappingPagePromotions
      .filter((entry) => entry.promotionId === diagnostic.promotionId)
      .sort((left, right) => left.provenance.fetchSequence - right.provenance.fetchSequence || left.provenance.recordIndex - right.provenance.recordIndex)[0];
    const retained = result.uniquePromotions.find((entry) => entry.promotionId === diagnostic.promotionId);
    assert.equal(retained, first);
    assert.deepEqual(diagnostic.retainedOccurrence, first?.provenance);
  }
});

function promotion(
  promotionId: string,
  campaignId: string | null,
  advertiserId: string | null,
  recordIndex: number,
): RawImpactPromotionV2 {
  return {
    promotionId,
    campaignId,
    advertiserId,
    advertiserName: "Presentation only",
    programId: "program-not-a-campaign",
    promotionTitle: null,
    description: null,
    genericRedemptionCode: null,
    trackingUrl: null,
    startDate: null,
    endDate: null,
    raw: { PromotionIds: promotionId },
    provenance: {
      stream: "promotions",
      fetchSequence: 1,
      recordIndex,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

function campaign(campaignId: string, advertiserId: string, recordIndex: number): RawImpactCampaignV2 {
  return {
    campaignId,
    advertiserId,
    campaignName: "Presentation only",
    destinationUrl: "https://merchant.example",
    trackingUrl: "https://track.example",
    raw: { CampaignId: campaignId },
    provenance: {
      stream: "campaigns",
      fetchSequence: 1,
      recordIndex,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Campaigns?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

test("merchant-resolution invariants preserve namespace boundaries and one explicit association per promotion", () => {
  const promotions = [
    promotion("exact", "campaign-exact", "advertiser-exact", 0),
    promotion("unknown-explicit", "campaign-missing", "advertiser-exact", 1),
    promotion("unique-advertiser", null, "advertiser-unique", 2),
    promotion("ambiguous-advertiser", null, "advertiser-ambiguous", 3),
    promotion("namespace-isolation", null, "123", 4),
    promotion("missing", null, null, 5),
  ];
  const campaigns = [
    campaign("campaign-exact", "advertiser-exact", 0),
    campaign("campaign-unique", "advertiser-unique", 1),
    campaign("campaign-ambiguous-a", "advertiser-ambiguous", 2),
    campaign("campaign-ambiguous-b", "advertiser-ambiguous", 3),
    campaign("123", "another-advertiser", 4),
  ];
  const beforePromotions = structuredClone(promotions);
  const beforeCampaigns = structuredClone(campaigns);
  const result = ImpactMerchantResolver.resolve(promotions, campaigns);
  const associations = new Map(result.promotionAssociations.map((entry) => [entry.promotionId, entry.association]));

  assert.equal(result.promotionAssociations.length, promotions.length);
  assert.equal(
    result.merchantIdentityDiagnostics.resolvedByCampaignId +
      result.merchantIdentityDiagnostics.resolvedByAdvertiserId +
      result.merchantIdentityDiagnostics.unmatchedTotal,
    promotions.length,
  );
  for (const association of associations.values()) {
    if (association.matchMethod === "unmatched") {
      assert.equal(association.providerStoreKey, null);
      assert.equal(association.matchedStoreId, null);
    } else {
      assert.deepEqual(association.providerStoreKey?.provider, "impact");
      assert.deepEqual(association.providerStoreKey?.namespace, "campaign");
      assert.equal(association.unresolvedReason, null);
    }
  }
  assert.equal(associations.get("unknown-explicit")?.unresolvedReason, "unknown_campaign_id");
  assert.equal(associations.get("unique-advertiser")?.matchMethod, "advertiser_id");
  assert.equal(associations.get("ambiguous-advertiser")?.unresolvedReason, "ambiguous_advertiser_id");
  assert.equal(associations.get("namespace-isolation")?.unresolvedReason, "unknown_advertiser_id");
  assert.equal(associations.get("missing")?.unresolvedReason, "missing_merchant_identity");
  assert.equal(result.merchantIdentityDiagnostics.distinctResolvedProviderStoreKeys, 2);
  assert.deepEqual(promotions, beforePromotions);
  assert.deepEqual(campaigns, beforeCampaigns);
});

test("normalization and snapshot matching preserve one offer per promotion and exact campaign-store identity", () => {
  const promotions = [
    promotion("exact", "campaign-exact", "advertiser-exact", 0),
    promotion("unknown-explicit", "campaign-missing", "advertiser-exact", 1),
    promotion("unique-advertiser", null, "advertiser-unique", 2),
    promotion("ambiguous-advertiser", null, "advertiser-ambiguous", 3),
    promotion("namespace-isolation", null, "123", 4),
    promotion("missing", null, null, 5),
  ];
  const campaigns = [
    campaign("campaign-exact", "advertiser-exact", 0),
    campaign("campaign-unique", "advertiser-unique", 1),
    campaign("campaign-ambiguous-a", "advertiser-ambiguous", 2),
    campaign("campaign-ambiguous-b", "advertiser-ambiguous", 3),
    campaign("123", "another-advertiser", 4),
  ];
  const beforePromotions = structuredClone(promotions);
  const beforeCampaigns = structuredClone(campaigns);
  const resolved = ImpactMerchantResolver.resolve(promotions, campaigns);
  const normalized = ImpactOfferNormalizer.normalize(promotions, resolved.promotionAssociations, campaigns);
  const matched = StoreOfferMatcher.match(normalized, {
    stores: [{
      id: "store-exact",
      providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-exact" },
    }],
    offers: [{ id: "offer-exact", promotionId: "exact" }],
  });
  const offers = [...matched.normalizedCoupons, ...matched.normalizedDeals];
  const offersByPromotionId = new Map(offers.map((offer) => [offer.promotionId, offer]));

  assert.equal(normalized.normalizedCoupons.length + normalized.normalizedDeals.length, promotions.length);
  assert.equal(new Set(offers.map((offer) => offer.promotionId)).size, promotions.length);
  for (const offer of offers) {
    const source = promotions.find((promotion) => promotion.promotionId === offer.promotionId);
    assert.equal(offer.promotionId, source?.promotionId);
    assert.equal(offer.advertiserId, source?.advertiserId);
    assert.equal(offer.advertiserName, source?.advertiserName);
    assert.equal(offer.campaignId, source?.campaignId);
    assert.equal(offer.programId, source?.programId);
    if (offer.association.matchMethod === "unmatched") {
      assert.equal(offer.association.providerStoreKey, null);
      assert.equal(offer.association.matchedStoreId, null);
    } else {
      assert.equal(offer.association.providerStoreKey.provider, "impact");
      assert.equal(offer.association.providerStoreKey.namespace, "campaign");
    }
  }
  assert.equal(offersByPromotionId.get("exact")?.association.matchedStoreId, "store-exact");
  assert.equal(offersByPromotionId.get("unknown-explicit")?.association.matchMethod, "unmatched");
  assert.equal(offersByPromotionId.get("unknown-explicit")?.association.matchedStoreId, null);
  assert.equal(offersByPromotionId.get("namespace-isolation")?.association.matchMethod, "unmatched");
  assert.equal(new Set(normalized.normalizedStores.map((store) => store.providerStoreKey.id)).size, normalized.normalizedStores.length);
  assert.ok(normalized.normalizedStores.every((store) => store.providerStoreKey.namespace === "campaign"));
  assert.deepEqual(promotions, beforePromotions);
  assert.deepEqual(campaigns, beforeCampaigns);
});

test("qualification and publishing invariants preserve exact store identity and exhaustive offer accounting", () => {
  const promotions = structuredClone(policyPromotions);
  const campaigns = structuredClone(policyCampaigns);
  const snapshot = structuredClone(policySnapshot);
  const beforePromotions = structuredClone(promotions);
  const beforeCampaigns = structuredClone(campaigns);
  const beforeSnapshot = structuredClone(snapshot);

  const run = (orderedPromotions: RawImpactPromotionV2[]) => {
    const resolved = ImpactMerchantResolver.resolve(orderedPromotions, campaigns);
    const normalized = ImpactOfferNormalizer.normalize(orderedPromotions, resolved.promotionAssociations, campaigns);
    const matched = StoreOfferMatcher.match(normalized, snapshot);
    const eligibility = OfferQualification.evaluate(matched, {
      evaluationTimestamp: "2026-06-01T00:00:00Z",
    });
    const policy = PublishingPolicy.apply(eligibility, {
      maxCouponsPerStore: 2,
      maxDealsPerStore: 1,
    });
    return { matched, eligibility, policy };
  };

  const forward = run(promotions);
  const reverse = run([...promotions].reverse());
  const evaluatedIds = [
    ...forward.matched.normalizedCoupons,
    ...forward.matched.normalizedDeals,
  ].map((offer) => offer.promotionId);
  const eligibleIds = [
    ...forward.eligibility.eligibleCoupons,
    ...forward.eligibility.eligibleDeals,
  ].map((offer) => offer.promotionId);
  const ineligibleIds = [
    ...forward.eligibility.ineligibleCoupons,
    ...forward.eligibility.ineligibleDeals,
  ].map((entry) => entry.offer.promotionId);
  const selectedIds = [
    ...forward.policy.selectedCoupons,
    ...forward.policy.selectedDeals,
  ].map((offer) => offer.promotionId);
  const heldIds = [
    ...forward.policy.heldCoupons,
    ...forward.policy.heldDeals,
  ].map((entry) => entry.offer.promotionId);

  assert.equal(eligibleIds.length + ineligibleIds.length, evaluatedIds.length);
  assert.equal(selectedIds.length + heldIds.length, evaluatedIds.length);
  assert.equal(new Set(selectedIds).size, selectedIds.length);
  assert.equal(new Set(heldIds).size, heldIds.length);
  assert.equal(selectedIds.some((promotionId) => heldIds.includes(promotionId)), false);
  assert.equal(selectedIds.includes("unresolved-deal"), false);
  assert.deepEqual(
    forward.policy.selectedCoupons.map((offer) => offer.promotionId),
    reverse.policy.selectedCoupons.map((offer) => offer.promotionId),
  );
  assert.deepEqual(
    forward.policy.selectedDeals.map((offer) => offer.promotionId),
    reverse.policy.selectedDeals.map((offer) => offer.promotionId),
  );
  assert.equal(new Set(forward.policy.stores.map((store) => store.providerStoreKey.id)).size, 2);
  for (const store of forward.policy.stores) {
    assert.ok(store.selectedCoupons.length <= 2);
    assert.ok(store.selectedDeals.length <= 1);
    for (const offer of [
      ...store.eligibleCoupons,
      ...store.eligibleDeals,
      ...store.heldCoupons.map((entry) => entry.offer),
      ...store.heldDeals.map((entry) => entry.offer),
    ]) {
      assert.equal(offer.association.providerStoreKey?.id, store.providerStoreKey.id);
      assert.equal(offer.association.matchedStoreId, store.matchedStoreId);
    }
  }

  const identitiesBeforeQualification = forward.policy.stores.map((store) => ({
    providerStoreKey: structuredClone(store.providerStoreKey),
    matchedStoreId: store.matchedStoreId,
  }));
  const qualification = StoreQualification.evaluate(forward.policy, {
    minimumSelectedCoupons: 1,
    minimumSelectedDeals: 1,
    minimumTotalSelectedOffers: 2,
  });
  assert.deepEqual(
    qualification.map((store) => ({
      providerStoreKey: store.providerStoreKey,
      matchedStoreId: store.matchedStoreId,
    })),
    identitiesBeforeQualification,
  );
  assert.deepEqual(promotions, beforePromotions);
  assert.deepEqual(campaigns, beforeCampaigns);
  assert.deepEqual(snapshot, beforeSnapshot);
});

test("final preview actions and store coverage reconcile without identity collapse", () => {
  const stream = (name: "promotions" | "campaigns", count: number) => ({
    stream: name,
    pagesFetched: 1,
    rawRecordCount: count,
    acceptedRecordCount: count,
    quarantinedRecordCount: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_promotion_id: 0,
      missing_campaign_id: 0,
    },
    ...(name === "promotions"
      ? {
        promotionIdShapeCounts: {
          missing: 0,
          null: 0,
          nonempty_string: count,
          empty_or_whitespace_string: 0,
          number: 0,
          array: 0,
          object: 0,
          boolean: 0,
          other: 0,
        },
        promotionIdentifierCarrierDiagnostics: {
          promotionFileId: {
            missing: count,
            null: 0,
            validOpaqueScalar: 0,
            invalidShape: 0,
            distinctValidOpaqueValues: 0,
          },
          uri: {
            missing: count,
            null: 0,
            nonemptyString: 0,
            invalidShape: 0,
            distinctNonemptyValues: 0,
            promotionRetrievePathShape: 0,
            distinctPromotionRetrieveTerminalSegments: 0,
          },
          promotionIdSingular: {
            missing: count,
            null: 0,
            validOpaqueScalar: 0,
            invalidShape: 0,
            distinctValidOpaqueValues: 0,
          },
          id: {
            missing: count,
            null: 0,
            validOpaqueScalar: 0,
            invalidShape: 0,
            distinctValidOpaqueValues: 0,
          },
        },
      }
      : {}),
    stopReason: "completed" as const,
    parseFailureReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  });
  const preview = PreviewPlanner.plan({
    acceptedPromotions: healthyMultiBrandPromotions,
    acceptedCampaigns: healthyMultiBrandCampaigns,
    fetchDiagnostics: {
      promotions: stream("promotions", healthyMultiBrandPromotions.length),
      campaigns: stream("campaigns", healthyMultiBrandCampaigns.length),
    },
    quarantinedRecords: [],
    existingCatalogSnapshot: healthyMultiBrandSnapshot,
    publishingPolicyConfig: { maxCouponsPerStore: 0, maxDealsPerStore: 0 },
    storeQualificationConfig: {
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 1,
    },
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
  const offerCounts = preview.proposedActions.counts.offers;
  const storeCounts = preview.proposedActions.counts.stores;

  assert.equal(
    offerCounts.existing + offerCounts.proposedCreate + offerCounts.held + offerCounts.unresolved,
    offerCounts.normalized,
  );
  assert.equal(
    preview.publishingPolicy.diagnostics.selectedOffers + preview.publishingPolicy.diagnostics.heldOffers,
    offerCounts.normalized,
  );
  assert.equal(new Set(preview.proposedActions.offers.map((action) => action.promotionId)).size, offerCounts.normalized);
  assert.equal(
    storeCounts.matchedExisting + storeCounts.newCandidates + storeCounts.ambiguousSnapshot,
    storeCounts.discovered,
  );
  assert.ok(preview.storeCoverage.qualifiedStores <= preview.storeCoverage.storesWithSelectedOffers);
  assert.equal(storeCounts.unmatchedAssociations, offerCounts.unresolved);
  assert.equal(preview.identityIntegrityDiagnostics.identityCollapseDetected, false);
  assert.equal(preview.identityIntegrityDiagnostics.distinctResolvedProviderStoreKeys, 2);
});
