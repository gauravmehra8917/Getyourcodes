import assert from "node:assert/strict";
import test from "node:test";
import {
  AdsPreviewPlanner,
  type AdsRecordProvenanceV2,
  type AdsShadowPolicyConfigV2,
  type ImpactAdsFetchDiagnosticsV2,
  type ImpactAdsFetchResultV2,
  type ImpactCampaignFetchResultForAdsV2,
  type RawImpactAdV2,
  type RawImpactCampaignForAdsV2,
} from "../index.ts";

const PROVENANCE: AdsRecordProvenanceV2 = {
  fetchSequence: 1,
  recordIndex: 0,
  providerPage: 1,
  providerPageSize: 100,
};

function ad(input: {
  id: string;
  campaignId?: string | null;
  advertiserId?: string | null;
  dealId?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  codeBearing?: boolean;
  recordIndex?: number;
}): RawImpactAdV2 {
  return {
    providerOfferKey: { provider: "impact", namespace: "ad", id: input.id },
    campaignId: input.campaignId ?? null,
    advertiserId: input.advertiserId ?? null,
    dealId: input.dealId ?? null,
    title: input.title === undefined ? "Valid title" : input.title,
    description: "private description",
    trackingUrl: "https://tracking.example/private",
    landingPageUrl: "https://landing.example/private",
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    codeClass: input.codeBearing ? "code_bearing" : "no_code",
    provenance: { ...PROVENANCE, recordIndex: input.recordIndex ?? 0 },
  };
}

function campaign(
  id: string,
  advertiserId: string | null = null,
  recordIndex = 0,
): RawImpactCampaignForAdsV2 {
  return {
    campaignId: id,
    advertiserId,
    campaignName: `private ${id}`,
    destinationUrl: "https://merchant.example/private",
    trackingUrl: "https://tracking.example/private",
    provenance: { ...PROVENANCE, recordIndex },
  };
}

function completeDiagnostics(
  stream: "ads" | "campaigns",
  accepted: number,
  quarantined = 0,
): ImpactAdsFetchDiagnosticsV2 {
  return {
    stream,
    complete: true,
    stopReason: "completed",
    parseFailureReason: null,
    pagesFetched: 1,
    physicalRequests: 1,
    retryCount: 0,
    rawRecords: accepted + quarantined,
    acceptedRecords: accepted,
    quarantinedRecords: quarantined,
    recordsDiscardedByLimit: 0,
    quarantineReasonCounts: {
      malformed_record: quarantined,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    },
    pages: [],
    rate: { limit: null, remaining: null, reset: null },
  };
}

function campaignFetch(
  records: RawImpactCampaignForAdsV2[],
): ImpactCampaignFetchResultForAdsV2 {
  return {
    records,
    diagnostics: completeDiagnostics("campaigns", records.length),
  };
}

function adsFetch(records: RawImpactAdV2[]): ImpactAdsFetchResultV2 {
  return { records, diagnostics: completeDiagnostics("ads", records.length) };
}

const POLICY: AdsShadowPolicyConfigV2 = {
  sourceNeutralMaxSelectedAdsPerStore: 0,
  maximumCouponsPerStore: 20,
  maximumDealsPerStore: 18,
  minimumSelectedCoupons: 0,
  minimumSelectedDeals: 0,
  minimumTotalSelectedOffers: 0,
};

function plan(input: {
  campaigns: RawImpactCampaignForAdsV2[];
  ads: RawImpactAdV2[];
  stores?: Array<{ id: string; campaignId: string }>;
  policy?: AdsShadowPolicyConfigV2;
}) {
  return AdsPreviewPlanner.plan({
    campaignFetch: campaignFetch(input.campaigns),
    adsFetch: adsFetch(input.ads),
    existingCatalogSnapshot: {
      stores: (input.stores ?? []).map((store) => ({
        id: store.id,
        providerStoreKey: {
          provider: "impact" as const,
          namespace: "campaign" as const,
          id: store.campaignId,
        },
      })),
    },
    policyConfig: input.policy ?? POLICY,
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
}

test("177 direct Campaign identities remain 177 exact provider store keys", () => {
  const campaigns = Array.from(
    { length: 177 },
    (_, index) => campaign(`Campaign-${index}`, `Advertiser-${index}`, index),
  );
  const ads = campaigns.map((entry, index) =>
    ad({
      id: `Ad-${index}`,
      campaignId: entry.campaignId,
      advertiserId: entry.advertiserId,
      recordIndex: index,
      codeBearing: index % 2 === 0,
    })
  );
  const result = plan({ campaigns, ads });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.preview.merchantIdentity.resolvedByCampaignId, 177);
  assert.equal(
    result.preview.merchantIdentity.distinctResolvedProviderStoreKeys,
    177,
  );
  assert.equal(result.preview.storeMatching.newStoreCandidates, 177);
  assert.equal(result.preview.selection.selectedAdsTotal, 177);
  assert.equal(
    result.preview.identityIntegrity.identityCollapseDetected,
    false,
  );
});

test("missing, unknown and advertiser-conflicted Campaign identities never fallback", () => {
  const result = plan({
    campaigns: [campaign("Campaign-A", "Advertiser-A")],
    ads: [
      ad({ id: "Ad-missing", advertiserId: "Advertiser-A", recordIndex: 0 }),
      ad({
        id: "Ad-unknown",
        campaignId: "Campaign-X",
        advertiserId: "Advertiser-A",
        recordIndex: 1,
      }),
      ad({
        id: "Ad-conflict",
        campaignId: "Campaign-A",
        advertiserId: "Advertiser-X",
        recordIndex: 2,
      }),
      ad({
        id: "Ad-exact",
        campaignId: "Campaign-A",
        advertiserId: "Advertiser-A",
        recordIndex: 3,
      }),
    ],
  });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.preview.merchantIdentity.unresolvedReasonCounts, {
    missing_campaign_id: 1,
    unknown_campaign_id: 1,
    campaign_advertiser_conflict: 1,
  });
  assert.equal(result.preview.merchantIdentity.resolvedByCampaignId, 1);
  assert.equal(result.preview.qualification.reasonCounts.unresolved_store, 3);
});

test("17 exact Ads under one DealId remain 17 source-neutral offers", () => {
  const ads = Array.from({ length: 17 }, (_, index) =>
    ad({
      id: `Ad-${index}`,
      campaignId: "Campaign-A",
      dealId: "Deal-shared",
      recordIndex: index,
    }));
  const result = plan({ campaigns: [campaign("Campaign-A")], ads });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.preview.deduplication.uniqueUsableAds, 17);
  assert.equal(result.preview.normalization.normalizedOffers, 17);
  assert.deepEqual(result.preview.dealCardinality, {
    adsWithDealId: 17,
    adsWithoutDealId: 0,
    distinctDealIds: 1,
    dealIdsWithOneAd: 0,
    dealIdsWithMultipleAds: 1,
    maxAdsPerDeal: 17,
  });
});

test("duplicate AdIds are removed before normalization without DealId collapse", () => {
  const duplicate = ad({
    id: "Ad-1",
    campaignId: "Campaign-A",
    dealId: "Deal-A",
  });
  const result = plan({
    campaigns: [campaign("Campaign-A")],
    ads: [
      duplicate,
      { ...duplicate, provenance: { ...PROVENANCE, fetchSequence: 2 } },
      ad({
        id: "Ad-2",
        campaignId: "Campaign-A",
        dealId: "Deal-A",
        recordIndex: 1,
      }),
    ],
  });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.preview.deduplication.duplicateRecordsRemoved, 1);
  assert.equal(result.preview.deduplication.uniqueUsableAds, 2);
  assert.equal(
    result.preview.deduplication.conflictedAdIdentitiesExcluded,
    0,
  );
  assert.equal(result.preview.normalization.normalizedOffers, 2);
});

test("eligibility, exact store matching, open end dates and zero-threshold qualification stay distinct", () => {
  const campaigns = [
    "Existing",
    "New",
    "Ambiguous",
    "Expired",
    "Future",
    "Invalid",
    "Range",
    "NoTitle",
  ]
    .map((id, index) => campaign(id, null, index));
  const ads = [
    ad({
      id: "Ad-existing",
      campaignId: "Existing",
      endDate: null,
      codeBearing: true,
      recordIndex: 0,
    }),
    ad({ id: "Ad-new", campaignId: "New", recordIndex: 1 }),
    ad({ id: "Ad-ambiguous", campaignId: "Ambiguous", recordIndex: 2 }),
    ad({
      id: "Ad-expired",
      campaignId: "Expired",
      endDate: "2026-01-01T00:00:00Z",
      recordIndex: 3,
    }),
    ad({
      id: "Ad-future",
      campaignId: "Future",
      startDate: "2027-01-01T00:00:00Z",
      recordIndex: 4,
    }),
    ad({
      id: "Ad-invalid",
      campaignId: "Invalid",
      startDate: "bad",
      recordIndex: 5,
    }),
    ad({
      id: "Ad-range",
      campaignId: "Range",
      startDate: "2026-05-02T00:00:00Z",
      endDate: "2026-05-01T00:00:00Z",
      recordIndex: 6,
    }),
    ad({ id: "Ad-title", campaignId: "NoTitle", title: null, recordIndex: 7 }),
  ];
  const result = plan({
    campaigns,
    ads,
    stores: [
      { id: "store-existing", campaignId: "Existing" },
      { id: "store-ambiguous-a", campaignId: "Ambiguous" },
      { id: "store-ambiguous-b", campaignId: "Ambiguous" },
    ],
  });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.preview.storeMatching, {
    storesEvaluated: 8,
    storesMatchedExisting: 1,
    newStoreCandidates: 6,
    ambiguousStoreSnapshotKeys: 1,
    offersMatchedToExistingStore: 1,
    offersForNewStoreCandidate: 6,
    offersHeldForAmbiguousStore: 1,
    unresolvedOffers: 0,
    existingOfferMatching: "not_evaluated",
  });
  assert.deepEqual(result.preview.qualification.reasonCounts, {
    unresolved_store: 1,
    not_started: 1,
    expired: 1,
    invalid_date: 1,
    invalid_date_range: 1,
    missing_title: 1,
  });
  assert.equal(result.preview.selection.selectedAdsTotal, 2);
  assert.equal(result.preview.selection.codeBearingSelected, 1);
  assert.equal(result.preview.selection.noCodeSelected, 1);
  assert.equal(result.preview.policy.policyQualificationPass, 8);
  assert.equal(result.preview.policy.policyPassWithoutSelectedAds, 6);
  assert.equal(result.preview.policy.storesWithSelectedAds, 2);
  assert.equal(result.preview.selection.storesWithoutSelectedAds, 6);
  assert.equal(result.preview.existingOfferMatching, "not_evaluated");
});

test("20/18 classification-dependent caps do not cap 25 selected Ads", () => {
  const ads = Array.from({ length: 25 }, (_, index) =>
    ad({
      id: `Ad-${index}`,
      campaignId: "Campaign-A",
      codeBearing: index < 21,
      recordIndex: index,
    }));
  const result = plan({ campaigns: [campaign("Campaign-A")], ads });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.preview.selection.selectedAdsTotal, 25);
  assert.deepEqual(result.preview.policy.couponCap, {
    value: 20,
    evaluation: "classification_dependent",
  });
  assert.deepEqual(result.preview.policy.dealCap, {
    value: 18,
    evaluation: "classification_dependent",
  });
});

test("nonzero coupon/deal minima remain classification-dependent", () => {
  for (
    const dimension of [
      "minimumSelectedCoupons",
      "minimumSelectedDeals",
    ] as const
  ) {
    const result = plan({
      campaigns: [campaign("Campaign-A")],
      ads: [ad({ id: "Ad-A", campaignId: "Campaign-A" })],
      policy: { ...POLICY, [dimension]: 1 },
    });
    assert.equal(result.complete, true);
    if (!result.complete) continue;
    assert.equal(result.preview.policy.policyQualificationPass, 0);
    assert.equal(
      result.preview.policy.policyQualificationClassificationDependent,
      1,
    );
    assert.equal(
      result.preview.policy[dimension].evaluation,
      "classification_dependent",
    );
  }
});

test("a settled total minimum can fail before classification-dependent dimensions", () => {
  const result = plan({
    campaigns: [campaign("Campaign-A")],
    ads: [ad({ id: "Ad-A", campaignId: "Campaign-A" })],
    policy: {
      ...POLICY,
      minimumSelectedCoupons: 1,
      minimumTotalSelectedOffers: 2,
    },
  });
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(
    result.preview.policy.minimumSelectedCoupons.evaluation,
    "classification_dependent",
  );
  assert.equal(result.preview.policy.policyQualificationPass, 0);
  assert.equal(result.preview.policy.policyQualificationFail, 1);
  assert.equal(
    result.preview.policy.policyQualificationClassificationDependent,
    0,
  );
  assert.equal(result.preview.policy.policyFailWithSelectedAds, 1);
});

test("each conflicting duplicate provider field excludes the exact Ad identity", () => {
  const cases = [
    {
      field: "CampaignId",
      duplicate: { campaignId: "Campaign-B" },
    },
    {
      field: "AdvertiserId",
      duplicate: { advertiserId: "Advertiser-B" },
    },
    { field: "DealId", duplicate: { dealId: "Deal-B" } },
    { field: "codeClass", duplicate: { codeBearing: true } },
  ] as const;

  for (const { field, duplicate: override } of cases) {
    const privateAdId = `PRIVATE-CONFLICT-${field}`;
    const first = ad({
      id: privateAdId,
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      codeBearing: false,
      recordIndex: 0,
    });
    const conflicting = ad({
      id: privateAdId,
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      codeBearing: false,
      recordIndex: 0,
      ...override,
    });
    conflicting.provenance.fetchSequence = 2;

    const result = plan({
      campaigns: [
        campaign("Campaign-A", "Advertiser-A", 0),
        campaign("Campaign-B", "Advertiser-A", 1),
      ],
      ads: [conflicting, first],
    });
    assert.equal(result.complete, true, field);
    if (!result.complete) continue;
    assert.deepEqual(result.preview.deduplication, {
      acceptedInputRecords: 2,
      uniqueUsableAds: 0,
      duplicateRecordsRemoved: 1,
      duplicatedAdIdentities: 1,
      identitiesWithConflictingProviderFields: 1,
      conflictedAdIdentitiesExcluded: 1,
    }, field);
    assert.equal(result.preview.merchantIdentity.adsEvaluated, 0, field);
    assert.equal(result.preview.normalization.normalizedOffers, 0, field);
    assert.equal(result.preview.selection.selectedAdsTotal, 0, field);
    assert.equal(
      result.preview.identityIntegrity.distinctAdIdsAfterFetch,
      1,
      field,
    );
    assert.equal(
      result.preview.identityIntegrity.distinctAdIdsAfterDeduplication,
      0,
      field,
    );
    assert.equal(
      result.preview.identityIntegrity.identityCollapseDetected,
      false,
      field,
    );
    assert.equal(JSON.stringify(result).includes(privateAdId), false, field);
  }
});

test("Campaign and Ads incomplete results block planning without partial output", () => {
  const incompleteCampaign = completeDiagnostics("campaigns", 0);
  incompleteCampaign.complete = false;
  incompleteCampaign.stopReason = "page_limit";
  const campaignBlocked = AdsPreviewPlanner.plan({
    campaignFetch: { records: [], diagnostics: incompleteCampaign },
    adsFetch: null,
    existingCatalogSnapshot: { stores: [] },
    policyConfig: POLICY,
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
  assert.deepEqual(
    {
      complete: campaignBlocked.complete,
      stage: campaignBlocked.blockedStage,
      reason: campaignBlocked.stopReason,
      preview: campaignBlocked.preview,
    },
    {
      complete: false,
      stage: "campaign_fetch",
      reason: "page_limit",
      preview: null,
    },
  );

  const incompleteAds = completeDiagnostics("ads", 0);
  incompleteAds.complete = false;
  incompleteAds.stopReason = "rate_limited";
  const adsBlocked = AdsPreviewPlanner.plan({
    campaignFetch: campaignFetch([]),
    adsFetch: { records: [], diagnostics: incompleteAds },
    existingCatalogSnapshot: { stores: [] },
    policyConfig: POLICY,
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
  assert.equal(adsBlocked.complete, false);
  assert.equal(adsBlocked.blockedStage, "ads_fetch");
  assert.equal(adsBlocked.stopReason, "rate_limited");
  assert.equal(adsBlocked.preview, null);
});

test("a completed but quarantined Campaign stream blocks Ads planning", () => {
  const diagnostics = completeDiagnostics("campaigns", 0, 1);
  const result = AdsPreviewPlanner.plan({
    campaignFetch: { records: [], diagnostics },
    adsFetch: null,
    existingCatalogSnapshot: { stores: [] },
    policyConfig: POLICY,
    evaluationTimestamp: "2026-06-01T00:00:00Z",
  });
  assert.equal(result.complete, false);
  assert.equal(result.stopReason, "campaign_records_quarantined");
  assert.equal(result.blockedStage, "campaign_fetch");
});

test("completed public DTO is aggregate-only and contains no provider values", () => {
  const sentinels = [
    "Ad-private",
    "Campaign-private",
    "Advertiser-private",
    "Deal-private",
    "private description",
    "tracking.example",
    "landing.example",
    "store-private",
  ];
  const result = plan({
    campaigns: [campaign(sentinels[1]!, sentinels[2]!)],
    ads: [
      ad({
        id: sentinels[0]!,
        campaignId: sentinels[1]!,
        advertiserId: sentinels[2]!,
        dealId: sentinels[3]!,
        codeBearing: true,
      }),
    ],
    stores: [{ id: sentinels[7]!, campaignId: sentinels[1]! }],
  });
  const serialized = JSON.stringify(result);
  for (const sentinel of sentinels) {
    assert.equal(serialized.includes(sentinel), false);
  }
  assert.equal(serialized.includes("promo"), false);
});
