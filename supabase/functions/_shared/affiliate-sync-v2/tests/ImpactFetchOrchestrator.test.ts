import assert from "node:assert/strict";
import test from "node:test";
import { ImpactFetchOrchestrator } from "../ImpactFetchOrchestrator.ts";
import { PreviewPlanner } from "../PreviewPlanner.ts";
import type { ImpactContinuationPolicy } from "../impact-url-safety.ts";
import { FixtureImpactTransport, type FixtureTransportStep } from "./fixture-transport.ts";

const continuationPolicy: ImpactContinuationPolicy = {
  approvedBaseUrl: "https://api.impact.com",
  allowedOrigins: ["https://api.impact.com"],
  accountSidPathSegments: ["2303074"],
};

const limits = {
  maxPages: 10,
  maxRecords: 100,
  maxResponseBytes: 20_000,
  maxAttempts: 2,
  baseBackoffMs: 1,
  maxBackoffMs: 10,
  maxRetryAfterMs: 10,
};

function response(body: unknown): FixtureTransportStep {
  return {
    result: {
      kind: "response",
      status: 200,
      bodyText: JSON.stringify(body),
      retryAfterMs: null,
    },
  };
}

test("fetch composition preserves both streams, exact continuation evidence, and quarantines", async () => {
  const continuation = "/Mediapartners/2303074/Promotions?Page=2&cursor=opaque-secret";
  const transport = new FixtureImpactTransport([
    response({
      "@page": "1",
      "@pagesize": "2",
      Promotions: [null, {
        PromotionId: "promotion-one",
        PromotionIds: "promotion-one",
        CampaignId: "campaign-one",
      }],
      "@nextpageuri": continuation,
    }),
    response({
      "@page": "2",
      "@pagesize": "2",
      Promotions: [{
        PromotionId: "promotion-two",
        PromotionIds: "promotion-two",
        CampaignId: "campaign-two",
      }],
    }),
    response({
      "@page": "1",
      "@pagesize": "2",
      Campaigns: [null, { CampaignId: "campaign-one", AdvertiserId: "advertiser-one" }],
    }),
  ]);
  const result = await ImpactFetchOrchestrator.retrieve({
    transport,
    continuationPolicy,
    limits,
    requestTimeoutMs: 1_000,
    promotionsInitialUrl: "/Mediapartners/2303074/Promotions?Page=1",
    campaignsInitialUrl: "/Mediapartners/2303074/Campaigns?Page=1",
  });

  assert.deepEqual(result.acceptedPromotions.map((record) => record.promotionId), [
    "promotion-one",
    "promotion-two",
  ]);
  assert.deepEqual(result.acceptedCampaigns.map((record) => record.campaignId), ["campaign-one"]);
  assert.equal(result.fetchDiagnostics.promotions.pagesFetched, 2);
  assert.equal(result.fetchDiagnostics.campaigns.pagesFetched, 1);
  assert.equal(result.fetchDiagnostics.promotions.parseFailureReason, null);
  assert.equal(result.fetchDiagnostics.campaigns.parseFailureReason, null);
  assert.equal(result.fetchDiagnostics.promotions.rawRecordCount, 3);
  assert.equal(result.fetchDiagnostics.promotions.acceptedRecordCount, 2);
  assert.equal(result.fetchDiagnostics.promotions.quarantinedRecordCount, 1);
  assert.equal(result.fetchDiagnostics.campaigns.quarantinedRecordCount, 1);
  assert.deepEqual(result.fetchDiagnostics.promotions.quarantineReasonCounts, {
    malformed_record: 1,
    missing_promotion_id: 0,
    missing_campaign_id: 0,
  });
  assert.deepEqual(result.fetchDiagnostics.promotions.promotionIdShapeCounts, {
    missing: 0,
    null: 0,
    nonempty_string: 2,
    empty_or_whitespace_string: 0,
    number: 0,
    array: 0,
    object: 0,
    boolean: 0,
    other: 0,
  });
  assert.deepEqual(
    result.fetchDiagnostics.promotions
      .promotionIdentifierCarrierDiagnostics,
    {
      promotionFileId: {
        missing: 2,
        null: 0,
        validOpaqueScalar: 0,
        invalidShape: 0,
        distinctValidOpaqueValues: 0,
      },
      uri: {
        missing: 2,
        null: 0,
        nonemptyString: 0,
        invalidShape: 0,
        distinctNonemptyValues: 0,
        promotionRetrievePathShape: 0,
        distinctPromotionRetrieveTerminalSegments: 0,
      },
      promotionIdSingular: {
        missing: 0,
        null: 0,
        validOpaqueScalar: 2,
        invalidShape: 0,
        distinctValidOpaqueValues: 2,
      },
      id: {
        missing: 2,
        null: 0,
        validOpaqueScalar: 0,
        invalidShape: 0,
        distinctValidOpaqueValues: 0,
      },
    },
  );
  assert.deepEqual(
    result.fetchDiagnostics.promotions
      .promotionIdentityEquivalenceDiagnostics,
    {
      structurallyValidPromotionRecords: 2,
      promotionIdAndRetrieveUriPresent: 0,
      exactPromotionIdEqualsUriTerminal: 0,
      promotionIdDiffersFromUriTerminal: 0,
      promotionIdPresentWithoutRetrieveUri: 2,
      retrieveUriPresentWithoutPromotionId: 0,
      neitherPresent: 0,
      distinctPromotionIds: 2,
      distinctRetrieveUriTerminalSegments: 0,
      promotionIdsMappingToMultipleUriTerminals: 0,
      uriTerminalsMappingToMultiplePromotionIds: 0,
      duplicatePromotionIdRecords: 0,
    },
  );
  assert.deepEqual(result.fetchDiagnostics.campaigns.quarantineReasonCounts, {
    malformed_record: 1,
    missing_promotion_id: 0,
    missing_campaign_id: 0,
  });
  assert.equal("promotionIdShapeCounts" in result.fetchDiagnostics.campaigns, false);
  assert.equal(
    "promotionIdentifierCarrierDiagnostics" in
      result.fetchDiagnostics.campaigns,
    false,
  );
  assert.equal(
    "promotionIdentityEquivalenceDiagnostics" in
      result.fetchDiagnostics.campaigns,
    false,
  );
  assert.deepEqual(result.quarantinedRecords.map((entry) => [entry.stream, entry.reason]), [
    ["promotions", "malformed_record"],
    ["campaigns", "malformed_record"],
  ]);
  assert.equal(
    result.acceptedPromotions[1]?.provenance.sanitizedSourceContinuationUrl?.includes("opaque-secret"),
    false,
  );
  assert.equal(
    result.acceptedPromotions[1]?.provenance.sanitizedSourceContinuationUrl?.includes("%5BREDACTED%5D"),
    true,
  );
  assert.deepEqual(transport.requests.map((request) => request.url), [
    "https://api.impact.com/Mediapartners/2303074/Promotions?Page=1",
    "https://api.impact.com/Mediapartners/2303074/Promotions?Page=2&cursor=opaque-secret",
    "https://api.impact.com/Mediapartners/2303074/Campaigns?Page=1",
  ]);
});

test("fetch composition propagates malformed-page diagnostics without partial records", async () => {
  const transport = new FixtureImpactTransport([
    response({ Promotions: [{ PromotionId: "promotion-one" }] }),
    response({ NotCampaigns: [] }),
  ]);
  const result = await ImpactFetchOrchestrator.retrieve({
    transport,
    continuationPolicy,
    limits,
    requestTimeoutMs: 1_000,
    promotionsInitialUrl: "/Mediapartners/2303074/Promotions",
    campaignsInitialUrl: "/Mediapartners/2303074/Campaigns",
  });

  assert.equal(result.acceptedPromotions.length, 1);
  assert.equal(result.acceptedCampaigns.length, 0);
  assert.equal(result.fetchDiagnostics.promotions.stopReason, "completed");
  assert.equal(result.fetchDiagnostics.campaigns.stopReason, "malformed_page");
  assert.equal(result.fetchDiagnostics.promotions.parseFailureReason, null);
  assert.equal(result.fetchDiagnostics.campaigns.parseFailureReason, "missing_collection");
  assert.deepEqual(result.fetchDiagnostics.campaigns.pageErrors.map((error) => error.code), [
    "malformed_page",
  ]);
  assert.equal(result.fetchDiagnostics.campaigns.pages[0]?.accepted, false);
});

test("preserves the live-like 312/141/171 singular PromotionId identity distribution", async () => {
  const promotionRecords = Array.from({ length: 312 }, (_, index) => {
    const promotionId = `synthetic-promotion-${index % 141}`;
    return {
      PromotionId: promotionId,
      Uri: `/Mediapartners/2303074/Promotions/${promotionId}`,
      PromotionTitle: `Synthetic promotion ${index}`,
    };
  });
  const transport = new FixtureImpactTransport([
    response({ Promotions: promotionRecords }),
    response({ Campaigns: [] }),
  ]);
  const result = await ImpactFetchOrchestrator.retrieve({
    transport,
    continuationPolicy,
    limits: { ...limits, maxRecords: 400, maxResponseBytes: 1_000_000 },
    requestTimeoutMs: 1_000,
    promotionsInitialUrl: "/Mediapartners/2303074/Promotions",
    campaignsInitialUrl: "/Mediapartners/2303074/Campaigns",
  });

  assert.equal(result.acceptedPromotions.length, 312);
  assert.equal(result.quarantinedRecords.length, 0);
  assert.deepEqual(result.fetchDiagnostics.promotions.promotionIdShapeCounts, {
    missing: 312,
    null: 0,
    nonempty_string: 0,
    empty_or_whitespace_string: 0,
    number: 0,
    array: 0,
    object: 0,
    boolean: 0,
    other: 0,
  });
  assert.equal(
    result.fetchDiagnostics.promotions.promotionIdentifierCarrierDiagnostics
      ?.promotionIdSingular.validOpaqueScalar,
    312,
  );
  assert.equal(
    result.fetchDiagnostics.promotions.promotionIdentifierCarrierDiagnostics
      ?.promotionIdSingular.distinctValidOpaqueValues,
    141,
  );
  assert.equal(
    result.fetchDiagnostics.promotions.promotionIdentityEquivalenceDiagnostics
      ?.exactPromotionIdEqualsUriTerminal,
    312,
  );
  assert.equal(
    result.fetchDiagnostics.promotions.promotionIdentityEquivalenceDiagnostics
      ?.duplicatePromotionIdRecords,
    171,
  );

  const preview = PreviewPlanner.plan({
    ...result,
    existingCatalogSnapshot: { stores: [], offers: [] },
    publishingPolicyConfig: { maxCouponsPerStore: 0, maxDealsPerStore: 0 },
    storeQualificationConfig: {
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 0,
    },
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
  assert.equal(preview.deduplicationDiagnostics.acceptedInputRecords, 312);
  assert.equal(preview.deduplicationDiagnostics.uniquePromotions, 141);
  assert.equal(preview.deduplicationDiagnostics.duplicateRecordsRemoved, 171);
  assert.equal(preview.identityIntegrityDiagnostics.identityCollapseDetected, false);
});
