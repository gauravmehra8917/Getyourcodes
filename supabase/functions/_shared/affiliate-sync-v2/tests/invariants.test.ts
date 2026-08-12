import assert from "node:assert/strict";
import test from "node:test";
import { ImpactMerchantResolver } from "../ImpactMerchantResolver.ts";
import { ImpactOfferNormalizer } from "../ImpactOfferNormalizer.ts";
import { RawPromotionDeduplicator } from "../RawPromotionDeduplicator.ts";
import { StoreOfferMatcher } from "../StoreOfferMatcher.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "../models.ts";
import { overlappingPagePromotions } from "./fixtures/overlapping-pages.ts";

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
