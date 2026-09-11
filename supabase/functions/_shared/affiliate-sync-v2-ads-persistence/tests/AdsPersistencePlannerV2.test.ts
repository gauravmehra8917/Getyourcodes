import assert from "node:assert/strict";
import test from "node:test";
import type {
  AdsRecordProvenanceV2,
  ImpactAdsFetchDiagnosticsV2,
  ImpactAdsFetchResultV2,
  ImpactCampaignFetchResultForAdsV2,
  RawImpactAdV2,
  RawImpactCampaignForAdsV2,
} from "../../affiliate-sync-v2-ads/index.ts";
import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  type AdsCatalogPlanningContextV2,
  AdsPersistencePlannerV2,
} from "../index.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OFFER_ID = "44444444-4444-4444-8444-444444444444";
const EVALUATION = "2026-06-01T00:00:00.000Z";
const PROVENANCE: AdsRecordProvenanceV2 = {
  fetchSequence: 1,
  recordIndex: 0,
  providerPage: 1,
  providerPageSize: 100,
};

function diagnostics(
  stream: "campaigns" | "ads",
  accepted: number,
): ImpactAdsFetchDiagnosticsV2 {
  return {
    stream,
    complete: true,
    stopReason: "completed",
    parseFailureReason: null,
    pagesFetched: 1,
    physicalRequests: 1,
    retryCount: 0,
    rawRecords: accepted,
    acceptedRecords: accepted,
    quarantinedRecords: 0,
    recordsDiscardedByLimit: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    },
    pages: [],
    rate: { limit: null, remaining: null, reset: null },
  };
}

function campaign(
  campaignId = "Campaign-A",
  name = "Acme & Co.",
): RawImpactCampaignForAdsV2 {
  return {
    campaignId,
    advertiserId: "Advertiser-A",
    campaignName: name,
    destinationUrl: "https://acme.example/sale",
    trackingUrl: "https://track.example/campaign",
    provenance: PROVENANCE,
  };
}

function ad(
  input: Partial<RawImpactAdV2> & { id?: string } = {},
): RawImpactAdV2 {
  const suppliedCode = input.validatedCouponCode;
  const code: string | null = suppliedCode === undefined
    ? "SAVE-20"
    : suppliedCode;
  const codeFields = code === null
    ? { codeClass: "no_code" as const, validatedCouponCode: null }
    : { codeClass: "code_bearing" as const, validatedCouponCode: code };
  return {
    providerOfferKey: {
      provider: "impact",
      namespace: "ad",
      id: input.id ?? input.providerOfferKey?.id ?? "Ad-A",
    },
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    dealId: "Deal-A",
    dealState: "ACTIVE",
    title: "Save 20% – Summer",
    description: "Twenty percent off selected products.",
    trackingUrl: "https://track.example/ad",
    landingPageUrl: "https://acme.example/coupon",
    dealStartDate: "2026-05-01T00:00:00Z",
    dealEndDate: "2026-12-31T23:59:59Z",
    startDate: "2026-01-01",
    endDate: "2027-01-31",
    dateFieldsValid: true,
    discountType: "percentage",
    discountValue: 20,
    structuredTerms: {
      minimumPurchase: 50,
      maximumSavings: 20,
      purchaseLimit: 1,
      scope: "Sitewide",
      currency: "USD",
      text: null,
    },
    provenance: PROVENANCE,
    ...input,
    ...codeFields,
  };
}

function fetches(input: {
  campaigns?: RawImpactCampaignForAdsV2[];
  ads?: RawImpactAdV2[];
} = {}): {
  campaignFetch: ImpactCampaignFetchResultForAdsV2;
  adsFetch: ImpactAdsFetchResultV2;
} {
  const campaigns = input.campaigns ?? [campaign()];
  const ads = input.ads ?? [ad()];
  return {
    campaignFetch: {
      records: campaigns,
      diagnostics: diagnostics("campaigns", campaigns.length),
    },
    adsFetch: {
      records: ads,
      diagnostics: diagnostics("ads", ads.length),
    },
  };
}

function plan(input: {
  campaigns?: RawImpactCampaignForAdsV2[];
  ads?: RawImpactAdV2[];
  catalog?: AdsCatalogPlanningContextV2;
  mode?: "full" | "canary";
  canaryAdId?: string | null;
} = {}) {
  return AdsPersistencePlannerV2.plan({
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl: "https://getyourcodes.com/admin/path",
    mode: input.mode ?? "full",
    canaryAdId: input.canaryAdId ?? null,
    ...fetches({ campaigns: input.campaigns, ads: input.ads }),
    catalog: input.catalog ?? { stores: [], offers: [] },
  });
}

function existingCampaignStore(): AdsCatalogPlanningContextV2["stores"][
  number
] {
  return {
    storeId: STORE_ID,
    slug: "curated-acme",
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: "Campaign-A",
  };
}

test("new exact Campaign and exact Ad produce deterministic CREATE projections", () => {
  const result = plan();
  assert.equal(result.status, "ready");
  assert.equal(
    result.persistenceContractVersion,
    ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  );
  assert.deepEqual(result.counts, {
    stores: {
      create: 1,
      noopExisting: 0,
      blockedAmbiguous: 0,
      noopUnmatched: 0,
    },
    offers: {
      create: 1,
      noopExisting: 0,
      noopHeld: 0,
      noopUnresolved: 0,
    },
    writableStores: 1,
    writableOffers: 1,
    writableEntities: 2,
  });
  const store = result.storeInstructions[0];
  assert.equal(store?.action, "create");
  if (store?.action !== "create") return;
  assert.equal(store.providerEntityNamespace, "campaign");
  assert.equal(store.projection.slugCandidate, "acme-and-co");
  assert.equal(store.projection.affiliateUrl, "https://acme.example/sale");
  assert.equal(
    store.projection.metadata.trackingUrl,
    "https://track.example/campaign",
  );
  assert.equal(
    store.projection.seoTitle,
    "Acme & Co. Coupons, Promo Codes & Deals 2026 | GetYourCodes",
  );
  assert.equal(
    store.projection.seoCanonicalUrl,
    "https://getyourcodes.com/acme-and-co-coupons",
  );

  const offer = result.offerInstructions[0];
  assert.equal(offer?.action, "create");
  if (offer?.action !== "create") return;
  assert.equal(offer.providerEntityNamespace, "ad");
  assert.equal(offer.projection.couponCode, "SAVE-20");
  assert.equal(offer.projection.couponType, "code");
  assert.equal(offer.projection.startDate, "2026-05-01");
  assert.equal(offer.projection.expiryDate, "2026-12-31");
  assert.equal(offer.projection.affiliateUrl, "https://track.example/ad");
  assert.equal(offer.projection.landingPageUrl, "https://acme.example/coupon");
  assert.equal(
    offer.projection.seoCanonicalUrl,
    "https://getyourcodes.com/acme-and-co-coupons#save-20-summer",
  );
  assert.deepEqual(Object.keys(offer.projection.metadata).sort(), [
    "adId",
    "adName",
    "advertiserId",
    "campaignId",
    "campaignName",
    "dealEndDate",
    "dealId",
    "dealStartDate",
    "endDate",
    "startDate",
  ]);
  assert.match(offer.projection.terms ?? "", /Minimum purchase of \$50\.00/);
  assert.equal(
    result.canonicalPlanMaterialString,
    JSON.stringify(result.canonicalPlanMaterial),
  );
  assert.deepEqual(result, plan());
});

test("exact existing Campaign and Ad are NOOP and curated content is absent", () => {
  const result = plan({
    catalog: {
      stores: [existingCampaignStore()],
      offers: [{
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.storeInstructions[0]?.action, "noop_existing");
  assert.equal(result.storeInstructions[0]?.projection, null);
  assert.equal(result.offerInstructions[0]?.action, "noop_existing");
  assert.equal(result.offerInstructions[0]?.projection, null);
  assert.equal(result.counts.stores.create, 0);
  assert.equal(result.counts.offers.create, 0);
  assert.equal(result.counts.stores.noopExisting, 1);
  assert.equal(result.counts.offers.noopExisting, 1);
});

test("same literal Promotion identity does not block an Ad CREATE", () => {
  const result = plan({
    catalog: {
      stores: [existingCampaignStore()],
      offers: [{
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "promotion",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.offerInstructions[0]?.action, "create");
});

test("store legacy identity and manual slug collisions block without adoption", () => {
  const legacy = plan({
    catalog: {
      stores: [{
        storeId: STORE_ID,
        slug: "historical-acme",
        provider: "impact",
        providerEntityNamespace: "legacy",
        providerEntityId: "Campaign-A",
      }],
      offers: [],
    },
  });
  assert.equal(legacy.status, "blocked");
  assert.equal(legacy.storeInstructions[0]?.action, "blocked");
  assert.equal(legacy.blockers[0]?.reason, "legacy_identity_collision");

  const slug = plan({
    catalog: {
      stores: [{
        storeId: STORE_ID,
        slug: "acme-and-co",
        provider: null,
        providerEntityNamespace: null,
        providerEntityId: null,
      }],
      offers: [],
    },
  });
  assert.equal(slug.status, "blocked");
  assert.equal(slug.storeInstructions[0]?.action, "blocked");
  assert.ok(
    slug.blockers.some((entry) =>
      entry.reason === "store_slug_collision" && entry.entity === "store"
    ),
  );
});

test("different provider store is never adopted by slug", () => {
  const result = plan({
    catalog: {
      stores: [{
        storeId: STORE_ID,
        slug: "acme-and-co",
        provider: "other-provider",
        providerEntityNamespace: "campaign",
        providerEntityId: "Campaign-A",
      }],
      offers: [],
    },
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.blockers.some((entry) =>
      entry.reason === "store_slug_collision" && entry.entity === "store"
    ),
  );
});

test("legacy Ad and incompatible exact Ad parent block", () => {
  const legacy = plan({
    catalog: {
      stores: [existingCampaignStore()],
      offers: [{
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "legacy",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(legacy.status, "blocked");
  assert.ok(
    legacy.blockers.some((entry) =>
      entry.reason === "legacy_identity_collision" && entry.entity === "offer"
    ),
  );

  const wrongParent = plan({
    catalog: {
      stores: [
        existingCampaignStore(),
        {
          storeId: OTHER_STORE_ID,
          slug: "other",
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: "Campaign-B",
        },
      ],
      offers: [{
        offerId: OFFER_ID,
        storeId: OTHER_STORE_ID,
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(wrongParent.status, "blocked");
  assert.ok(
    wrongParent.blockers.some((entry) =>
      entry.reason === "incompatible_parent"
    ),
  );
});

test("no-code and unresolved Ads are retained as non-writable dispositions", () => {
  const result = plan({
    ads: [
      ad({ id: "Ad-no-code", validatedCouponCode: null }),
      ad({
        id: "Ad-missing-campaign",
        campaignId: null,
        validatedCouponCode: "VALID",
        provenance: { ...PROVENANCE, recordIndex: 1 },
      }),
      ad({
        id: "Ad-unresolved",
        campaignId: "Campaign-unknown",
        validatedCouponCode: "VALID",
        provenance: { ...PROVENANCE, recordIndex: 2 },
      }),
      ad({
        id: "Ad-advertiser-conflict",
        advertiserId: "Advertiser-B",
        validatedCouponCode: "VALID",
        provenance: { ...PROVENANCE, recordIndex: 3 },
      }),
    ],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.counts.writableEntities, 0);
  assert.equal(result.counts.offers.noopHeld, 1);
  assert.equal(result.counts.offers.noopUnresolved, 3);
  assert.deepEqual(
    result.offerInstructions.map((entry) =>
      entry.action === "noop_held" || entry.action === "noop_unresolved"
        ? entry.holdReason
        : null
    ).sort(),
    [
      "identity_conflict",
      "missing_coupon_code",
      "unresolved_store",
      "unresolved_store",
    ],
  );
});

test("exact-code duplicate conflict is excluded and canary fails closed", () => {
  const first = ad({ id: "Ad-A", validatedCouponCode: "SAVE10" });
  const second = ad({
    id: "Ad-A",
    validatedCouponCode: "SAVE20",
    provenance: { ...PROVENANCE, fetchSequence: 2 },
  });
  const full = plan({ ads: [first, second] });
  assert.equal(full.status, "ready");
  assert.equal(full.counts.writableEntities, 0);
  assert.equal(full.offerInstructions[0]?.action, "noop_unresolved");
  assert.equal(
    full.offerInstructions[0]?.action === "noop_unresolved"
      ? full.offerInstructions[0].holdReason
      : null,
    "duplicate_identity_conflict",
  );

  const canary = plan({
    ads: [first, second],
    mode: "canary",
    canaryAdId: "Ad-A",
  });
  assert.equal(canary.status, "blocked");
  assert.deepEqual(canary.blockers.map((entry) => entry.reason), [
    "canary_ad_conflicted",
  ]);
  assert.equal(canary.counts.writableEntities, 0);
});

test("canary is exact, bounded, and permits at most one coupon", () => {
  const ads = [
    ad({ id: "Ad-A" }),
    ad({
      id: "Ad-B",
      provenance: { ...PROVENANCE, recordIndex: 1 },
    }),
  ];
  const selected = plan({ ads, mode: "canary", canaryAdId: "Ad-B" });
  assert.equal(selected.status, "ready");
  assert.equal(selected.offerInstructions.length, 1);
  assert.equal(selected.offerInstructions[0]?.providerEntityId, "Ad-B");
  assert.equal(selected.counts.offers.create, 1);

  const unknown = plan({ ads, mode: "canary", canaryAdId: "Ad-X" });
  assert.equal(unknown.status, "blocked");
  assert.equal(unknown.blockers[0]?.reason, "canary_ad_not_found");
  assert.equal(unknown.counts.writableEntities, 0);

  const noCode = plan({
    ads: [ad({ id: "Ad-A", validatedCouponCode: null })],
    mode: "canary",
    canaryAdId: "Ad-A",
  });
  assert.equal(noCode.status, "blocked");
  assert.equal(noCode.blockers[0]?.reason, "canary_ad_ineligible");
  assert.equal(noCode.counts.writableEntities, 0);
});

test("canary exact existing Ad is a zero-create NOOP", () => {
  const result = plan({
    mode: "canary",
    canaryAdId: "Ad-A",
    catalog: {
      stores: [existingCampaignStore()],
      offers: [{
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.counts.stores.create, 0);
  assert.equal(result.counts.offers.create, 0);
  assert.equal(result.counts.stores.noopExisting, 1);
  assert.equal(result.counts.offers.noopExisting, 1);
  assert.equal(result.offerInstructions[0]?.action, "noop_existing");
});

test("canary unresolved Campaign blocks with zero writable instructions", () => {
  const result = plan({
    ads: [ad({ campaignId: "Campaign-missing" })],
    mode: "canary",
    canaryAdId: "Ad-A",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.counts.writableEntities, 0);
  assert.equal(result.offerInstructions[0]?.action, "noop_unresolved");
  assert.ok(
    result.blockers.some((entry) => entry.reason === "canary_ad_ineligible"),
  );
});

test("a post-create exact catalog snapshot deterministically transitions to NOOP", () => {
  const first = plan({ mode: "canary", canaryAdId: "Ad-A" });
  assert.equal(first.status, "ready");
  assert.equal(first.counts.stores.create, 1);
  assert.equal(first.counts.offers.create, 1);

  const replay = plan({
    mode: "canary",
    canaryAdId: "Ad-A",
    catalog: {
      stores: [existingCampaignStore()],
      offers: [{
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: "Ad-A",
        couponType: "code",
      }],
    },
  });
  assert.equal(replay.status, "ready");
  assert.equal(replay.counts.stores.create, 0);
  assert.equal(replay.counts.offers.create, 0);
  assert.equal(replay.counts.stores.noopExisting, 1);
  assert.equal(replay.counts.offers.noopExisting, 1);
});

test("invalid full/canary selector combinations block before planning", () => {
  const full = plan({ mode: "full", canaryAdId: "Ad-A" });
  assert.equal(full.status, "blocked");
  assert.equal(full.blockers[0]?.reason, "invalid_context");

  const canary = plan({ mode: "canary", canaryAdId: null });
  assert.equal(canary.status, "blocked");
  assert.equal(canary.blockers[0]?.reason, "invalid_context");
});

test("Deal dates take precedence and invalid preferred dates never fall through", () => {
  const precedence = plan({
    ads: [ad({
      dealStartDate: "2026-05-01T00:30:00+02:00",
      startDate: "2026-02-01",
      dealEndDate: "2026-12-31T23:30:00-02:00",
      endDate: "2026-11-01",
    })],
  });
  const instruction = precedence.offerInstructions[0];
  assert.equal(instruction?.action, "create");
  if (instruction?.action === "create") {
    assert.equal(instruction.projection.startDate, "2026-04-30");
    assert.equal(instruction.projection.expiryDate, "2027-01-01");
  }

  const invalid = plan({
    ads: [ad({
      dealStartDate: "not-a-date",
      startDate: "2026-02-01",
      dateFieldsValid: false,
    })],
  });
  assert.equal(invalid.counts.offers.create, 0);
  assert.equal(invalid.offerInstructions[0]?.action, "noop_held");
  assert.equal(
    invalid.offerInstructions[0]?.action === "noop_held"
      ? invalid.offerInstructions[0].holdReason
      : null,
    "invalid_date",
  );
});

test("incomplete retrieval and quarantined Campaigns block all writes", () => {
  const base = fetches();
  base.adsFetch.diagnostics.complete = false;
  base.adsFetch.diagnostics.stopReason = "provider_error";
  const incomplete = AdsPersistencePlannerV2.plan({
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl: "https://getyourcodes.com",
    mode: "full",
    canaryAdId: null,
    ...base,
    catalog: { stores: [], offers: [] },
  });
  assert.equal(incomplete.status, "blocked");
  assert.equal(incomplete.blockers[0]?.reason, "ads_fetch_incomplete");

  const quarantined = fetches();
  quarantined.campaignFetch.diagnostics.rawRecords = 2;
  quarantined.campaignFetch.diagnostics.quarantinedRecords = 1;
  quarantined.campaignFetch.diagnostics.quarantineReasonCounts
    .missing_campaign_id = 1;
  const blocked = AdsPersistencePlannerV2.plan({
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl: "https://getyourcodes.com",
    mode: "full",
    canaryAdId: null,
    ...quarantined,
    catalog: { stores: [], offers: [] },
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockers[0]?.reason, "campaign_records_quarantined");
});
