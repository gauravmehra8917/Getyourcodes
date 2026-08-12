import assert from "node:assert/strict";
import test from "node:test";
import { ImpactMerchantResolver } from "../ImpactMerchantResolver.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2, StoreOfferAssociationV2 } from "../models.ts";
import {
  ambiguousAdvertiserCampaigns,
  ambiguousAdvertiserPromotion,
} from "./fixtures/ambiguous-advertiser.ts";

function campaign(input: {
  campaignId: string;
  fetchSequence: number;
  recordIndex?: number;
  advertiserId?: string | null;
  campaignName?: string | null;
  destinationUrl?: string | null;
  trackingUrl?: string | null;
  raw?: Record<string, unknown>;
}): RawImpactCampaignV2 {
  return {
    campaignId: input.campaignId,
    advertiserId: input.advertiserId === undefined ? "advertiser-default" : input.advertiserId,
    campaignName: input.campaignName === undefined ? `Campaign ${input.campaignId}` : input.campaignName,
    destinationUrl: input.destinationUrl === undefined ? `https://merchant.example/${input.campaignId}` : input.destinationUrl,
    trackingUrl: input.trackingUrl === undefined ? `https://track.example/${input.campaignId}` : input.trackingUrl,
    raw: input.raw ?? { CampaignId: input.campaignId },
    provenance: {
      stream: "campaigns",
      fetchSequence: input.fetchSequence,
      recordIndex: input.recordIndex ?? 0,
      sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Campaigns?Page=${input.fetchSequence}`,
      sanitizedSourceContinuationUrl: null,
      providerPage: String(input.fetchSequence),
      providerPageSize: "100",
    },
  };
}

function promotion(input: {
  promotionId: string;
  fetchSequence: number;
  recordIndex?: number;
  advertiserId?: string | null;
  advertiserName?: string | null;
  campaignId?: string | null;
  programId?: string | null;
  raw?: Record<string, unknown>;
}): RawImpactPromotionV2 {
  return {
    promotionId: input.promotionId,
    advertiserId: input.advertiserId === undefined ? "advertiser-default" : input.advertiserId,
    advertiserName: input.advertiserName === undefined ? "Presentation only" : input.advertiserName,
    campaignId: input.campaignId === undefined ? "campaign-default" : input.campaignId,
    programId: input.programId === undefined ? "program-default" : input.programId,
    raw: input.raw ?? { PromotionIds: input.promotionId },
    provenance: {
      stream: "promotions",
      fetchSequence: input.fetchSequence,
      recordIndex: input.recordIndex ?? 0,
      sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=${input.fetchSequence}`,
      sanitizedSourceContinuationUrl: null,
      providerPage: String(input.fetchSequence),
      providerPageSize: "100",
    },
  };
}

function associationFor(
  result: ReturnType<typeof ImpactMerchantResolver.resolve>,
  promotionId: string,
): StoreOfferAssociationV2 {
  const found = result.promotionAssociations.find((entry) => entry.promotionId === promotionId);
  assert.ok(found, `missing association for ${promotionId}`);
  return found.association;
}

test("resolves exact campaign IDs and records unavailable advertiser cross-checks", () => {
  const result = ImpactMerchantResolver.resolve([
    promotion({ promotionId: "promotion-exact", fetchSequence: 1, advertiserId: "advertiser-a", campaignId: "campaign-a" }),
    promotion({ promotionId: "promotion-no-advertiser", fetchSequence: 1, recordIndex: 1, advertiserId: null, campaignId: "campaign-b" }),
    promotion({ promotionId: "promotion-campaign-no-advertiser", fetchSequence: 1, recordIndex: 2, advertiserId: "advertiser-c", campaignId: "campaign-c" }),
  ], [
    campaign({ campaignId: "campaign-a", fetchSequence: 1, advertiserId: "advertiser-a" }),
    campaign({ campaignId: "campaign-b", fetchSequence: 1, recordIndex: 1, advertiserId: "advertiser-b" }),
    campaign({ campaignId: "campaign-c", fetchSequence: 1, recordIndex: 2, advertiserId: null }),
  ]);

  assert.deepEqual(associationFor(result, "promotion-exact"), {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-a" },
    matchedStoreId: null,
    matchMethod: "campaign_id",
    unresolvedReason: null,
  });
  assert.deepEqual(associationFor(result, "promotion-no-advertiser"), {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-b" },
    matchedStoreId: null,
    matchMethod: "campaign_id",
    unresolvedReason: null,
  });
  assert.deepEqual(associationFor(result, "promotion-campaign-no-advertiser"), {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-c" },
    matchedStoreId: null,
    matchMethod: "campaign_id",
    unresolvedReason: null,
  });
  assert.equal(result.merchantIdentityDiagnostics.advertiserCrossCheckUnavailableCount, 2);
  assert.equal(result.merchantIdentityDiagnostics.resolvedByCampaignId, 3);
  assert.equal(result.merchantIdentityDiagnostics.distinctResolvedProviderStoreKeys, 3);
  assert.equal(result.campaignIndexDiagnostics.campaignsMissingAdvertiserId, 1);
  assert.equal(result.merchantIdentityDiagnostics.matchMethodCounts.explicit_provider_relation, 0);
});

test("an explicit campaign ID never falls back after unknown or advertiser-conflicting campaign lookup", () => {
  const conflicting = promotion({
    promotionId: "promotion-conflict", fetchSequence: 1, advertiserId: "advertiser-a", campaignId: "campaign-a",
  });
  const unknown = promotion({
    promotionId: "promotion-unknown", fetchSequence: 1, recordIndex: 1, advertiserId: "advertiser-a", campaignId: "campaign-missing",
  });
  const matchingAdvertiserCampaign = campaign({ campaignId: "campaign-fallback", fetchSequence: 1, advertiserId: "advertiser-a" });
  const conflictingCampaign = campaign({ campaignId: "campaign-a", fetchSequence: 1, recordIndex: 1, advertiserId: "advertiser-b" });
  const result = ImpactMerchantResolver.resolve([conflicting, unknown], [matchingAdvertiserCampaign, conflictingCampaign]);

  assert.deepEqual(associationFor(result, "promotion-conflict"), {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "campaign_advertiser_conflict",
  });
  assert.deepEqual(associationFor(result, "promotion-unknown"), {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "unknown_campaign_id",
  });
  assert.deepEqual(result.merchantIdentityDiagnostics.campaignAdvertiserConflicts, [{
    promotionId: "promotion-conflict",
    promotionAdvertiserId: "advertiser-a",
    campaignId: "campaign-a",
    campaignAdvertiserId: "advertiser-b",
    promotionProvenance: conflicting.provenance,
    campaignProvenance: conflictingCampaign.provenance,
  }]);
  assert.deepEqual(result.merchantIdentityDiagnostics.unresolvedReasonCounts, {
    unknown_campaign_id: 1,
    campaign_advertiser_conflict: 1,
    unknown_advertiser_id: 0,
    ambiguous_advertiser_id: 0,
    missing_merchant_identity: 0,
  });
});

test("resolves only a unique advertiser candidate and keeps ambiguous, unknown, and missing identities unmatched", () => {
  const unique = promotion({ promotionId: "promotion-unique", fetchSequence: 1, advertiserId: "advertiser-unique", campaignId: null });
  const unknown = promotion({ promotionId: "promotion-unknown-advertiser", fetchSequence: 1, recordIndex: 1, advertiserId: "123", campaignId: null });
  const missing = promotion({
    promotionId: "promotion-missing", fetchSequence: 1, recordIndex: 2, advertiserId: null, campaignId: null,
    advertiserName: "Looks exactly like a campaign but has no identity",
  });
  const unrelatedSameTextCampaign = campaign({ campaignId: "123", fetchSequence: 1, advertiserId: "advertiser-other" });
  const result = ImpactMerchantResolver.resolve([
    unique,
    ambiguousAdvertiserPromotion,
    unknown,
    missing,
  ], [
    campaign({ campaignId: "campaign-unique", fetchSequence: 1, advertiserId: "advertiser-unique" }),
    ...ambiguousAdvertiserCampaigns,
    unrelatedSameTextCampaign,
  ]);

  assert.deepEqual(associationFor(result, "promotion-unique"), {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-unique" },
    matchedStoreId: null,
    matchMethod: "advertiser_id",
    unresolvedReason: null,
  });
  assert.deepEqual(associationFor(result, ambiguousAdvertiserPromotion.promotionId!), {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "ambiguous_advertiser_id",
  });
  assert.deepEqual(associationFor(result, "promotion-unknown-advertiser"), {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "unknown_advertiser_id",
  });
  assert.deepEqual(associationFor(result, "promotion-missing"), {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "missing_merchant_identity",
  });
  assert.equal(result.merchantIdentityDiagnostics.resolvedByAdvertiserId, 1);
  assert.equal(result.merchantIdentityDiagnostics.distinctResolvedProviderStoreKeys, 1);
  assert.equal(result.campaignIndexDiagnostics.advertisersMappingToExactlyOneCampaign, 2);
  assert.equal(result.campaignIndexDiagnostics.advertisersMappingToMultipleCampaigns, 1);
});

test("retains the first provenance-ordered duplicate campaign and reports conflicts without repairing identity", () => {
  const retained = campaign({
    campaignId: "campaign-duplicate", fetchSequence: 1, advertiserId: "advertiser-retained",
    campaignName: "First", destinationUrl: "https://first.example", trackingUrl: "https://track.example/first",
  });
  const later = campaign({
    campaignId: "campaign-duplicate", fetchSequence: 2, advertiserId: "advertiser-later",
    campaignName: "Later", destinationUrl: "https://later.example", trackingUrl: "https://track.example/later",
  });
  const promotionForRetained = promotion({
    promotionId: "promotion-duplicate-campaign", fetchSequence: 1, advertiserId: "advertiser-retained", campaignId: "campaign-duplicate",
  });
  const campaigns = [later, retained];
  const result = ImpactMerchantResolver.resolve([promotionForRetained], campaigns);

  assert.deepEqual(associationFor(result, "promotion-duplicate-campaign"), {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-duplicate" },
    matchedStoreId: null,
    matchMethod: "campaign_id",
    unresolvedReason: null,
  });
  assert.deepEqual(result.campaignIndexDiagnostics, {
    acceptedCampaignRecords: 2,
    indexedCampaigns: 1,
    duplicateCampaignRecords: 1,
    duplicatedCampaignIdentities: 1,
    campaignIdentitiesWithConflictingFields: 1,
    duplicateCampaignDetails: [{
      campaignId: "campaign-duplicate",
      retainedOccurrence: retained.provenance,
      occurrences: [retained.provenance, later.provenance],
      totalOccurrences: 2,
      duplicateOccurrenceCount: 1,
      conflictingIdentityFields: ["advertiserId", "campaignName", "destinationUrl", "trackingUrl"],
    }],
    duplicateCampaignDetailsReturned: 1,
    duplicateCampaignDetailsTruncated: false,
    advertisersMappingToExactlyOneCampaign: 1,
    advertisersMappingToMultipleCampaigns: 0,
    campaignsMissingAdvertiserId: 0,
  });
  assert.deepEqual(campaigns, [later, retained]);
});

test("keeps promotion output order and bounds diagnostic rows without losing exact counts or leaking raw payloads", () => {
  const first = promotion({
    promotionId: "promotion-first", fetchSequence: 1, advertiserId: "advertiser-one", campaignId: "campaign-one",
    raw: { PromotionIds: "promotion-first", Authorization: "secret-one" },
  });
  const second = promotion({
    promotionId: "promotion-second", fetchSequence: 2, advertiserId: "advertiser-two", campaignId: "campaign-two",
    raw: { PromotionIds: "promotion-second", token: "secret-two" },
  });
  const duplicateOne = campaign({
    campaignId: "campaign-duplicate-one", fetchSequence: 1, advertiserId: "advertiser-one",
    raw: { CampaignId: "campaign-duplicate-one", token: "secret-campaign-one" },
  });
  const duplicateOneLater = campaign({
    campaignId: "campaign-duplicate-one", fetchSequence: 2, advertiserId: "advertiser-other",
    raw: { CampaignId: "campaign-duplicate-one", token: "secret-campaign-one-later" },
  });
  const campaignOne = campaign({ campaignId: "campaign-one", fetchSequence: 1, advertiserId: "advertiser-other-one" });
  const campaignTwo = campaign({ campaignId: "campaign-two", fetchSequence: 1, recordIndex: 1, advertiserId: "advertiser-other-two" });
  const campaigns = [duplicateOneLater, campaignTwo, campaignOne, duplicateOne];
  const promotions = [second, first];
  const beforeCampaigns = structuredClone(campaigns);
  const beforePromotions = structuredClone(promotions);
  const result = ImpactMerchantResolver.resolve(promotions, campaigns, { diagnosticDetailLimit: 1 });

  assert.deepEqual(result.promotionAssociations.map((entry) => entry.promotionId), ["promotion-second", "promotion-first"]);
  assert.equal(result.merchantIdentityDiagnostics.unmatchedTotal, 2);
  assert.equal(result.merchantIdentityDiagnostics.campaignAdvertiserConflictDetailsReturned, 1);
  assert.equal(result.merchantIdentityDiagnostics.campaignAdvertiserConflictDetailsTruncated, true);
  assert.equal(result.campaignIndexDiagnostics.duplicatedCampaignIdentities, 1);
  assert.equal(result.campaignIndexDiagnostics.duplicateCampaignDetailsReturned, 1);
  assert.equal(result.campaignIndexDiagnostics.duplicateCampaignDetailsTruncated, false);
  assert.deepEqual(campaigns, beforeCampaigns);
  assert.deepEqual(promotions, beforePromotions);
  const diagnostics = JSON.stringify({
    merchant: result.merchantIdentityDiagnostics,
    campaign: result.campaignIndexDiagnostics,
  });
  assert.equal(diagnostics.includes("secret"), false);
  assert.equal(diagnostics.includes("Authorization"), false);
});
