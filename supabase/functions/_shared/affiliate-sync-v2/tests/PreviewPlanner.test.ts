import assert from "node:assert/strict";
import test from "node:test";
import { PreviewPlanner, type AffiliateSyncPreviewInputV2 } from "../PreviewPlanner.ts";
import type {
  ImpactStreamFetchDiagnosticsV2,
  QuarantinedImpactRecordV2,
} from "../diagnostics.ts";
import type {
  ExistingCatalogSnapshotV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
} from "../models.ts";
import {
  ambiguousAdvertiserCampaigns,
  ambiguousAdvertiserPromotion,
} from "./fixtures/ambiguous-advertiser.ts";
import {
  healthyMultiBrandCampaigns,
  healthyMultiBrandPromotions,
  healthyMultiBrandSnapshot,
} from "./fixtures/healthy-multi-brand.ts";
import {
  overlappingPageCampaigns,
  overlappingPagePromotions,
} from "./fixtures/overlapping-pages.ts";

const EVALUATION_TIMESTAMP = "2026-06-01T00:00:00Z";

function streamDiagnostics(
  stream: "promotions" | "campaigns",
  acceptedRecords: number,
  quarantinedRecords: readonly QuarantinedImpactRecordV2[] = [],
): ImpactStreamFetchDiagnosticsV2 {
  const quarantineReasonCounts = {
    malformed_record: quarantinedRecords.filter((entry) => entry.reason === "malformed_record").length,
    missing_promotion_id: quarantinedRecords.filter((entry) => entry.reason === "missing_promotion_id").length,
    missing_campaign_id: quarantinedRecords.filter((entry) => entry.reason === "missing_campaign_id").length,
  };
  return {
    stream,
    pagesFetched: acceptedRecords + quarantinedRecords.length > 0 ? 1 : 0,
    rawRecordCount: acceptedRecords + quarantinedRecords.length,
    acceptedRecordCount: acceptedRecords,
    quarantinedRecordCount: quarantinedRecords.length,
    quarantineReasonCounts,
    stopReason: "completed",
    parseFailureReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  };
}

function plannerInput(input: {
  promotions: readonly RawImpactPromotionV2[];
  campaigns: readonly RawImpactCampaignV2[];
  snapshot?: ExistingCatalogSnapshotV2;
  quarantinedRecords?: readonly QuarantinedImpactRecordV2[];
  diagnosticDetailLimit?: number;
  storeQualificationConfig?: AffiliateSyncPreviewInputV2["storeQualificationConfig"];
}): AffiliateSyncPreviewInputV2 {
  const quarantined = input.quarantinedRecords ?? [];
  const promotionQuarantine = quarantined.filter((entry) => entry.stream === "promotions");
  const campaignQuarantine = quarantined.filter((entry) => entry.stream === "campaigns");
  return {
    acceptedPromotions: input.promotions,
    acceptedCampaigns: input.campaigns,
    fetchDiagnostics: {
      promotions: streamDiagnostics("promotions", input.promotions.length, promotionQuarantine),
      campaigns: streamDiagnostics("campaigns", input.campaigns.length, campaignQuarantine),
    },
    quarantinedRecords: quarantined,
    existingCatalogSnapshot: input.snapshot ?? { stores: [], offers: [] },
    publishingPolicyConfig: { maxCouponsPerStore: 0, maxDealsPerStore: 0 },
    storeQualificationConfig: input.storeQualificationConfig ?? {
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 1,
    },
    evaluationTimestamp: EVALUATION_TIMESTAMP,
    ...(input.diagnosticDetailLimit === undefined
      ? {}
      : { diagnosticDetailLimit: input.diagnosticDetailLimit }),
  };
}

function actionByPromotion(preview: ReturnType<typeof PreviewPlanner.plan>) {
  return new Map(preview.proposedActions.offers.map((action) => [action.promotionId, action]));
}

function promotionWith(
  promotionId: string,
  recordIndex: number,
  fields: Partial<RawImpactPromotionV2>,
): RawImpactPromotionV2 {
  const source = healthyMultiBrandPromotions[0]!;
  return {
    ...structuredClone(source),
    promotionId,
    raw: { ...source.raw, PromotionIds: promotionId },
    provenance: { ...source.provenance, recordIndex },
    ...fields,
  };
}

const ZERO_QUALIFICATION_THRESHOLDS: AffiliateSyncPreviewInputV2["storeQualificationConfig"] = {
  minimumSelectedCoupons: 0,
  minimumSelectedDeals: 0,
  minimumTotalSelectedOffers: 0,
};

test("healthy multi-brand planning preserves independent stores from raw input through qualification", () => {
  const input = plannerInput({
    promotions: healthyMultiBrandPromotions,
    campaigns: healthyMultiBrandCampaigns,
    snapshot: healthyMultiBrandSnapshot,
  });
  const before = structuredClone(input);
  const preview = PreviewPlanner.plan(input);

  assert.equal(new Set(healthyMultiBrandCampaigns.map((campaign) => campaign.campaignId)).size, 2);
  assert.equal(preview.merchantIdentityDiagnostics.advertiserCount, 2);
  assert.equal(preview.merchantIdentityDiagnostics.campaignCount, 2);
  assert.deepEqual(preview.normalizedStores.map((store) => store.providerStoreKey.id), [
    "campaign-acme",
    "campaign-bravo",
  ]);
  assert.equal(new Set(preview.normalizedStores.map((store) => JSON.stringify(store.providerStoreKey))).size, 2);
  assert.deepEqual(preview.normalizedCoupons.map((offer) => offer.promotionId), ["promotion-acme-coupon"]);
  assert.deepEqual(preview.normalizedDeals.map((offer) => offer.promotionId), ["promotion-bravo-deal"]);
  assert.deepEqual(preview.publishingPolicy.stores.map((store) => ({
    key: store.providerStoreKey.id,
    offers: [...store.selectedCoupons, ...store.selectedDeals].map((offer) => offer.promotionId),
  })), [
    { key: "campaign-acme", offers: ["promotion-acme-coupon"] },
    { key: "campaign-bravo", offers: ["promotion-bravo-deal"] },
  ]);
  assert.equal(preview.storeQualification.length, 2);
  assert.ok(preview.storeQualification.every((store) => store.qualified));
  assert.deepEqual(preview.identityIntegrityDiagnostics, {
    distinctResolvedProviderStoreKeys: 2,
    normalizedProviderStoreKeys: 2,
    matchedProviderStoreKeys: 2,
    policyProviderStoreKeys: 2,
    qualificationProviderStoreKeys: 2,
    identityCollapseDetected: false,
  });
  assert.deepEqual(preview.storeCoverage, {
    campaignBackedStoresDiscovered: 2,
    providerStoreKeysReferencedByPromotions: 2,
    storesWithResolvedOffers: 2,
    storesMatchedToExisting: 1,
    newStoreCandidates: 1,
    storesWithSelectedOffers: 2,
    qualifiedStores: 2,
    unresolvedOffers: 0,
    ambiguousSnapshotKeys: 0,
  });
  assert.deepEqual(preview.proposedActions.stores.map((action) => action.action), ["existing", "create"]);
  assert.deepEqual(preview.proposedActions.offers.map((action) => action.action), ["existing", "create"]);
  assert.deepEqual(preview.proposedActions.counts.offers, {
    normalized: 2,
    selected: 2,
    held: 0,
    unresolved: 0,
    existing: 1,
    proposedCreate: 1,
    duplicateRecordsRemoved: 0,
    quarantined: 0,
  });
  assert.deepEqual(input, before);
});

test("complete preview is deterministic for logically identical reordered inputs", () => {
  const forward = plannerInput({
    promotions: healthyMultiBrandPromotions,
    campaigns: healthyMultiBrandCampaigns,
    snapshot: healthyMultiBrandSnapshot,
  });
  const reversed: AffiliateSyncPreviewInputV2 = {
    ...structuredClone(forward),
    acceptedPromotions: [...healthyMultiBrandPromotions].reverse(),
    acceptedCampaigns: [...healthyMultiBrandCampaigns].reverse(),
    existingCatalogSnapshot: {
      stores: [...healthyMultiBrandSnapshot.stores].reverse(),
      offers: [...healthyMultiBrandSnapshot.offers].reverse(),
    },
  };

  assert.deepEqual(PreviewPlanner.plan(forward), PreviewPlanner.plan(reversed));
});

test("overlapping pages retain duplicate provenance and normalize each PromotionId once", () => {
  const preview = PreviewPlanner.plan(plannerInput({
    promotions: overlappingPagePromotions,
    campaigns: overlappingPageCampaigns,
  }));
  const normalizedIds = [...preview.normalizedCoupons, ...preview.normalizedDeals]
    .map((offer) => offer.promotionId);
  const duplicate = preview.deduplicationDiagnostics.duplicateDetails[0];

  assert.equal(preview.rawFetchDiagnostics.promotions.acceptedRecordCount, 6);
  assert.equal(preview.deduplicationDiagnostics.uniquePromotions, 5);
  assert.equal(preview.deduplicationDiagnostics.duplicateRecordsRemoved, 1);
  assert.equal(preview.deduplicationDiagnostics.duplicatedIdentities, 1);
  assert.equal(normalizedIds.filter((promotionId) => promotionId === "C").length, 1);
  assert.equal(new Set(normalizedIds).size, 5);
  assert.equal(duplicate?.promotionId, "C");
  assert.deepEqual(duplicate?.occurrences.map((entry) => entry.fetchSequence), [1, 2]);
  assert.deepEqual(preview.rawFetchDiagnostics.duplicates, preview.deduplicationDiagnostics.duplicateDetails);
  assert.equal(preview.proposedActions.counts.offers.normalized, 5);
  assert.equal(preview.proposedActions.counts.offers.held, 5);
  assert.equal(preview.proposedActions.counts.offers.duplicateRecordsRemoved, 1);
  assert.equal(preview.publishingPolicy.diagnostics.selectedOffers, 0);
  assert.equal(preview.publishingPolicy.diagnostics.heldOffers, 5);
});

test("zero qualification thresholds allow a deterministic held-only resolved store to qualify", () => {
  const promotions = [
    promotionWith("expired-coupon", 0, {
      endDate: "2026-05-31T23:59:59Z",
    }),
    promotionWith("expired-deal", 1, {
      genericRedemptionCode: null,
      endDate: "2026-05-31T23:59:59Z",
    }),
  ];
  const input = plannerInput({
    promotions,
    campaigns: [healthyMultiBrandCampaigns[0]!],
    storeQualificationConfig: ZERO_QUALIFICATION_THRESHOLDS,
  });
  const before = structuredClone(input);
  const preview = PreviewPlanner.plan(input);
  const reordered = PreviewPlanner.plan({
    ...structuredClone(input),
    acceptedPromotions: [...input.acceptedPromotions].reverse(),
  });

  assert.deepEqual(reordered, preview);
  assert.deepEqual(input, before);
  assert.equal(preview.publishingPolicy.diagnostics.selectedOffers, 0);
  assert.equal(preview.publishingPolicy.diagnostics.heldOffers, 2);
  assert.equal(preview.publishingPolicy.diagnostics.holdReasonCounts.expired, 2);
  assert.deepEqual(preview.storeQualification, [{
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
    matchedStoreId: null,
    selectedCouponCount: 0,
    selectedDealCount: 0,
    selectedTotal: 0,
    qualified: true,
    reasons: ["qualified"],
  }]);
  assert.equal(preview.storeCoverage.storesWithSelectedOffers, 0);
  assert.equal(preview.storeCoverage.qualifiedStores, 1);
  assert.ok(
    preview.storeCoverage.qualifiedStores > preview.storeCoverage.storesWithSelectedOffers,
  );
  assert.equal(preview.identityIntegrityDiagnostics.identityCollapseDetected, false);
  assert.deepEqual(
    preview.proposedActions.offers.map((action) => [action.action, action.holdReason]),
    [["held", "expired"], ["held", "expired"]],
  );

  const nonzeroMinimum = PreviewPlanner.plan(plannerInput({
    promotions,
    campaigns: [healthyMultiBrandCampaigns[0]!],
    storeQualificationConfig: {
      ...ZERO_QUALIFICATION_THRESHOLDS,
      minimumTotalSelectedOffers: 1,
    },
  }));
  assert.deepEqual(nonzeroMinimum.storeQualification[0], {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
    matchedStoreId: null,
    selectedCouponCount: 0,
    selectedDealCount: 0,
    selectedTotal: 0,
    qualified: false,
    reasons: ["insufficient_total_offers"],
  });
  assert.equal(nonzeroMinimum.storeCoverage.qualifiedStores, 0);
});

test("held-only eligibility reasons remain intact with zero qualification thresholds", () => {
  const cases: Array<{
    reason: "missing_title" | "invalid_date" | "expired" | "not_started";
    fields: Partial<RawImpactPromotionV2>;
  }> = [
    { reason: "missing_title", fields: { promotionTitle: null } },
    { reason: "invalid_date", fields: { startDate: "not-a-date" } },
    { reason: "expired", fields: { endDate: "2026-05-31T23:59:59Z" } },
    {
      reason: "not_started",
      fields: { startDate: "2027-01-01T00:00:00Z", endDate: null },
    },
  ];

  for (const [recordIndex, { reason, fields }] of cases.entries()) {
    const preview = PreviewPlanner.plan(plannerInput({
      promotions: [promotionWith(`held-${reason}`, recordIndex, fields)],
      campaigns: [healthyMultiBrandCampaigns[0]!],
      storeQualificationConfig: ZERO_QUALIFICATION_THRESHOLDS,
    }));

    assert.equal(preview.offerQualificationDiagnostics.ineligibleReasonCounts[reason], 1);
    assert.equal(preview.publishingPolicy.diagnostics.holdReasonCounts[reason], 1);
    assert.equal(preview.publishingPolicy.diagnostics.selectedOffers, 0);
    assert.equal(preview.publishingPolicy.diagnostics.heldOffers, 1);
    assert.equal(preview.storeQualification[0]?.qualified, true);
    assert.equal(preview.storeQualification[0]?.selectedTotal, 0);
    assert.equal(preview.storeCoverage.storesWithSelectedOffers, 0);
    assert.equal(preview.storeCoverage.qualifiedStores, 1);
    assert.equal(preview.identityIntegrityDiagnostics.identityCollapseDetected, false);
  }
});

test("ambiguous advertiser remains unresolved through every downstream preview stage", () => {
  const preview = PreviewPlanner.plan(plannerInput({
    promotions: [ambiguousAdvertiserPromotion],
    campaigns: ambiguousAdvertiserCampaigns,
  }));
  const association = preview.associations[0]?.association;
  const offerAction = actionByPromotion(preview).get("promotion-ambiguous-advertiser");

  assert.equal(preview.merchantIdentityDiagnostics.unresolvedReasonCounts.ambiguous_advertiser_id, 1);
  assert.deepEqual(association, {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: "ambiguous_advertiser_id",
  });
  assert.equal(preview.publishingPolicy.selectedDeals.length, 0);
  assert.equal(preview.publishingPolicy.unresolvedHeldDeals[0]?.reason, "unresolved_store");
  assert.equal(offerAction?.action, "unresolved");
  assert.equal(offerAction?.providerStoreKey, null);
  assert.deepEqual(preview.proposedActions.stores.map((action) => action.action), ["unmatched"]);
  assert.deepEqual(preview.proposedActions.counts.offers, {
    normalized: 1,
    selected: 0,
    held: 0,
    unresolved: 1,
    existing: 0,
    proposedCreate: 0,
    duplicateRecordsRemoved: 0,
    quarantined: 0,
  });
  assert.deepEqual(preview.storeCoverage, {
    campaignBackedStoresDiscovered: 2,
    providerStoreKeysReferencedByPromotions: 0,
    storesWithResolvedOffers: 0,
    storesMatchedToExisting: 0,
    newStoreCandidates: 0,
    storesWithSelectedOffers: 0,
    qualifiedStores: 0,
    unresolvedOffers: 1,
    ambiguousSnapshotKeys: 0,
  });
});

test("ambiguous exact snapshot keys are reported without choosing a store", () => {
  const snapshot: ExistingCatalogSnapshotV2 = {
    ...healthyMultiBrandSnapshot,
    stores: [
      ...healthyMultiBrandSnapshot.stores,
      {
        id: "store-acme-conflict",
        providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
      },
    ],
  };
  const preview = PreviewPlanner.plan(plannerInput({
    promotions: healthyMultiBrandPromotions,
    campaigns: healthyMultiBrandCampaigns,
    snapshot,
  }));
  const acme = preview.proposedActions.stores.find((action) =>
    action.providerStoreKey?.id === "campaign-acme");

  assert.equal(acme?.action, "ambiguous_snapshot");
  assert.equal(acme?.matchedStoreId, null);
  assert.equal(preview.storeCoverage.ambiguousSnapshotKeys, 1);
  assert.equal(preview.proposedActions.counts.stores.ambiguousSnapshot, 1);
  assert.equal(preview.proposedActions.counts.stores.matchedExisting, 0);
});

test("quarantine and diagnostic detail bounds preserve exact aggregate counts", () => {
  const base = healthyMultiBrandPromotions[0]!.provenance;
  const quarantinedRecords: QuarantinedImpactRecordV2[] = [
    { stream: "promotions", reason: "malformed_record", provenance: { ...base, recordIndex: 8 } },
    {
      stream: "campaigns",
      reason: "missing_campaign_id",
      provenance: { ...base, stream: "campaigns", recordIndex: 9 },
    },
  ];
  const preview = PreviewPlanner.plan(plannerInput({
    promotions: healthyMultiBrandPromotions,
    campaigns: healthyMultiBrandCampaigns,
    snapshot: healthyMultiBrandSnapshot,
    quarantinedRecords,
    diagnosticDetailLimit: 1,
  }));

  assert.equal(preview.parserDiagnostics.quarantinedRecords, 2);
  assert.deepEqual(preview.parserDiagnostics.quarantineDetails, []);
  assert.equal(preview.parserDiagnostics.quarantineDetailsReturned, 0);
  assert.equal(preview.parserDiagnostics.quarantineDetailsTruncated, true);
  assert.deepEqual(preview.rawFetchDiagnostics.quarantinedRecords, []);
  assert.equal(preview.rawFetchDiagnostics.quarantinedDetailsReturned, 0);
  assert.equal(preview.rawFetchDiagnostics.quarantinedDetailsTruncated, true);
  assert.deepEqual(preview.rawFetchDiagnostics.promotions.quarantineReasonCounts, {
    malformed_record: 1,
    missing_promotion_id: 0,
    missing_campaign_id: 0,
  });
  assert.deepEqual(preview.rawFetchDiagnostics.campaigns.quarantineReasonCounts, {
    malformed_record: 0,
    missing_promotion_id: 0,
    missing_campaign_id: 1,
  });
  assert.equal(preview.proposedActions.counts.offers.quarantined, 2);
  assert.equal(preview.advertiserDistributionTotal, 2);
  assert.equal(preview.advertiserDistributionDetailsReturned, 1);
  assert.equal(preview.advertiserDistributionDetailsTruncated, true);
});

test("quarantine reason aggregates must be non-negative integers and reconcile", () => {
  const negative = plannerInput({ promotions: [], campaigns: [] });
  negative.fetchDiagnostics.promotions.quarantineReasonCounts.malformed_record = -1;
  assert.throws(
    () => PreviewPlanner.plan(negative),
    /quarantine reason counts must be non-negative integers/,
  );

  const fractional = plannerInput({ promotions: [], campaigns: [] });
  fractional.fetchDiagnostics.campaigns.quarantineReasonCounts.missing_campaign_id = 0.5;
  assert.throws(
    () => PreviewPlanner.plan(fractional),
    /quarantine reason counts must be non-negative integers/,
  );

  const unreconciled = plannerInput({ promotions: [], campaigns: [] });
  unreconciled.fetchDiagnostics.promotions.quarantineReasonCounts.missing_promotion_id = 1;
  assert.throws(
    () => PreviewPlanner.plan(unreconciled),
    /quarantine reason counts do not reconcile/,
  );
});
