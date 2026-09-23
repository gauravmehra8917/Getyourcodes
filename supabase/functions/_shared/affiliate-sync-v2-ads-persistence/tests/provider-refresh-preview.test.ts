import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsRecordProvenanceV2,
  ImpactAdsFetchDiagnosticsV2,
  RawImpactAdV2,
  RawImpactCampaignForAdsV2,
} from "../../affiliate-sync-v2-ads/index.ts";

import {
  type AdsPersistencePlannerInputV2,
  AdsPersistencePlannerV2,
} from "../AdsPersistencePlannerV2.ts";

import type { AdsCatalogPlanningContextV2 } from "../ads-persistence-models.ts";

import {
  providerManagedOfferStateFromProjectionV2,
  providerManagedStoreStateFromProjectionV2,
} from "../provider-managed-state.ts";

const INTEGRATION_ID =
  "11111111-1111-4111-8111-111111111111";

const STORE_ID =
  "22222222-2222-4222-8222-222222222222";

const OFFER_ID =
  "33333333-3333-4333-8333-333333333333";

const EVALUATION =
  "2026-06-01T00:00:00.000Z";

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
    rate: {
      limit: null,
      remaining: null,
      reset: null,
    },
  };
}

function campaign(): RawImpactCampaignForAdsV2 {
  return {
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    campaignName: "Acme & Co.",
    destinationUrl: "https://acme.example/sale",
    trackingUrl: "https://track.example/campaign",
    provenance: PROVENANCE,
  };
}

type CodeBearingAd = Extract<RawImpactAdV2, { codeClass: "code_bearing" }>;
type NoCodeAd = Extract<RawImpactAdV2, { codeClass: "no_code" }>;

function ad(
  overrides: Partial<CodeBearingAd> = {},
): CodeBearingAd {
  return {
    providerOfferKey: {
      provider: "impact",
      namespace: "ad",
      id: "Ad-A",
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
    codeClass: "code_bearing",
    validatedCouponCode: "SAVE-20",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function noCodeAd(): NoCodeAd {
  return {
    ...ad(),
    codeClass: "no_code",
    validatedCouponCode: null,
  };
}

function plannerInput(
  catalog: AdsCatalogPlanningContextV2,
  rawAd: RawImpactAdV2 = ad(),
): AdsPersistencePlannerInputV2 {
  return {
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl: "https://getyourcodes.com/admin/path",
    mode: "full",
    canaryAdId: null,
    campaignFetch: {
      records: [campaign()],
      diagnostics: diagnostics("campaigns", 1),
    },
    adsFetch: {
      records: [rawAd],
      diagnostics: diagnostics("ads", 1),
    },
    catalog,
  };
}

function matchingExistingCatalog(): AdsCatalogPlanningContextV2 {
  const seed = AdsPersistencePlannerV2.plan(
    plannerInput({
      stores: [],
      offers: [],
    }),
  );

  assert.equal(seed.status, "ready");

  const store = seed.storeInstructions[0];
  const offer = seed.offerInstructions[0];

  assert.equal(store?.action, "create");
  assert.equal(offer?.action, "create");

  if (
    store?.action !== "create" ||
    offer?.action !== "create"
  ) {
    throw new Error("seed projections unavailable");
  }

  return {
    stores: [{
      storeId: STORE_ID,
      slug: store.projection.slugCandidate,
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Campaign-A",
      importOrigin: "provider",
      lifecycleManaged: true,

      providerManagedState:
        providerManagedStoreStateFromProjectionV2(
          store.projection,
        ),
    }],
    offers: [{
      offerId: OFFER_ID,
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: "Ad-A",
      couponType: "code",
      providerManagedState:
        providerManagedOfferStateFromProjectionV2(
          offer.projection,
        ),
    }],
  };
}

test("matching exact existing Campaign and Ad preview as NOOP", () => {
  const catalog = matchingExistingCatalog();

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      plannerInput(catalog),
    );

  assert.equal(preview.status, "ready");

  assert.deepEqual(preview.counts, {
    stores: {
      noopExisting: 1,
      updateExisting: 0,
      blocked: 0,
    },
    offers: {
      noopExisting: 1,
      updateExisting: 0,
      blocked: 0,
    },
  });

  assert.equal(
    preview.stores[0]?.action,
    "noop_existing",
  );

  assert.equal(
    preview.offers[0]?.action,
    "noop_existing",
  );
});

test("changed provider-managed Campaign and Ad preview as UPDATE", () => {
  const catalog = structuredClone(
    matchingExistingCatalog(),
  );

  const storeState =
    catalog.stores[0]?.providerManagedState;

  const offerState =
    catalog.offers[0]?.providerManagedState;

  assert.ok(storeState);
  assert.ok(offerState);

  storeState.metadata.trackingUrl =
    "https://track.example/historical";

  offerState.couponCode = "OLD-CODE";
  offerState.expiryDate = "2026-10-31";

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      plannerInput(catalog),
    );

  assert.equal(preview.status, "ready");

  assert.equal(
    preview.stores[0]?.action,
    "update_existing",
  );

  assert.equal(
    preview.offers[0]?.action,
    "update_existing",
  );

  assert.deepEqual(preview.counts, {
    stores: {
      noopExisting: 0,
      updateExisting: 1,
      blocked: 0,
    },
    offers: {
      noopExisting: 0,
      updateExisting: 1,
      blocked: 0,
    },
  });
});

test("missing managed snapshots block refresh preview closed", () => {
  const catalog = matchingExistingCatalog();

  catalog.stores[0]!.providerManagedState = null;
  catalog.offers[0]!.providerManagedState = null;

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      plannerInput(catalog),
    );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.stores[0]?.action,
    "blocked",
  );

  assert.equal(
    preview.stores[0]?.reason,
    "missing_snapshot",
  );

  assert.equal(
    preview.offers[0]?.action,
    "blocked",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "missing_snapshot",
  );

  assert.equal(preview.counts.stores.blocked, 1);
  assert.equal(preview.counts.offers.blocked, 1);
});

test("executable v2-a11-ads-1 plan remains NOOP despite preview UPDATE intent", () => {
  const catalog = structuredClone(
    matchingExistingCatalog(),
  );

  const storeState =
    catalog.stores[0]?.providerManagedState;

  const offerState =
    catalog.offers[0]?.providerManagedState;

  assert.ok(storeState);
  assert.ok(offerState);

  storeState.metadata.trackingUrl =
    "https://track.example/old";

  offerState.couponCode = "OLD-CODE";

  const input = plannerInput(catalog);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  assert.equal(
    preview.stores[0]?.action,
    "update_existing",
  );

  assert.equal(
    preview.offers[0]?.action,
    "update_existing",
  );

  assert.equal(
    executable.storeInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );
});

test("exact existing future Ad is refreshable but executable planner still holds it", () => {
  const catalog = matchingExistingCatalog();

  const future = ad({
    dealStartDate: "2026-07-01T00:00:00Z",
    dealEndDate: "2026-12-31T23:59:59Z",
  });

  const input = plannerInput(
    catalog,
    future,
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_held",
  );

  assert.equal(
    executable.offerInstructions[0]?.action === "noop_held"
      ? executable.offerInstructions[0].holdReason
      : null,
    "not_started",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "ready");

  assert.equal(
    preview.stores[0]?.action,
    "noop_existing",
  );

  assert.equal(
    preview.offers[0]?.action,
    "update_existing",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    1,
  );
});

test("exact existing expired Ad is refreshable but executable planner still holds it", () => {
  const catalog = matchingExistingCatalog();

  const expired = ad({
    dealStartDate: "2026-01-01T00:00:00Z",
    dealEndDate: "2026-05-31T23:59:59Z",
  });

  const input = plannerInput(
    catalog,
    expired,
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_held",
  );

  assert.equal(
    executable.offerInstructions[0]?.action === "noop_held"
      ? executable.offerInstructions[0].holdReason
      : null,
    "expired",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "ready");

  assert.equal(
    preview.stores[0]?.action,
    "noop_existing",
  );

  assert.equal(
    preview.offers[0]?.action,
    "update_existing",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    1,
  );
});

test("new future and expired Ads remain excluded from refresh preview", () => {
  for (
    const rawAd of [
      ad({
        dealStartDate: "2026-07-01T00:00:00Z",
        dealEndDate: "2026-12-31T23:59:59Z",
      }),
      ad({
        dealStartDate: "2026-01-01T00:00:00Z",
        dealEndDate: "2026-05-31T23:59:59Z",
      }),
    ]
  ) {
    const input = plannerInput(
      {
        stores: [],
        offers: [],
      },
      rawAd,
    );

    const executable =
      AdsPersistencePlannerV2.plan(input);

    const preview =
      AdsPersistencePlannerV2.planProviderRefreshPreview(
        input,
      );

    assert.equal(
      executable.counts.writableEntities,
      0,
    );

    assert.equal(preview.status, "ready");

    assert.deepEqual(preview.stores, []);
    assert.deepEqual(preview.offers, []);

    assert.equal(
      preview.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      preview.counts.offers.updateExisting,
      0,
    );
  }
});
test("exact existing no-code Ad is explicitly blocked and never updated", () => {
  const catalog = matchingExistingCatalog();

  const noCode = noCodeAd();

  const input = plannerInput(
    catalog,
    noCode,
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.offers[0]?.action,
    "blocked",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "missing_coupon_code",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});

test("exact existing invalid date and date range Ads are explicitly blocked", () => {
  const cases = [
    {
      rawAd: ad({
        dateFieldsValid: false,
      }),
      expectedReason: "invalid_date",
    },
    {
      rawAd: ad({
        dealStartDate: "2026-12-31T00:00:00Z",
        dealEndDate: "2026-01-01T00:00:00Z",
        dateFieldsValid: true,
      }),
      expectedReason: "invalid_date_range",
    },
  ] as const;

  for (const entry of cases) {
    const catalog = matchingExistingCatalog();

    const input = plannerInput(
      catalog,
      entry.rawAd,
    );

    const executable =
      AdsPersistencePlannerV2.plan(input);

    const preview =
      AdsPersistencePlannerV2.planProviderRefreshPreview(
        input,
      );

    assert.equal(
      executable.counts.writableEntities,
      0,
    );

    assert.equal(preview.status, "blocked");

    assert.equal(
      preview.offers[0]?.action,
      "blocked",
    );

    assert.equal(
      preview.offers[0]?.reason,
      entry.expectedReason,
    );

    assert.equal(
      preview.counts.offers.updateExisting,
      0,
    );
  }
});

test("exact existing missing-title Ad is explicitly blocked", () => {
  const catalog = matchingExistingCatalog();

  const input = plannerInput(
    catalog,
    ad({
      title: null,
    }),
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.offers[0]?.action,
    "blocked",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "missing_title",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});

test("exact existing unresolved Campaign and advertiser conflict are explicitly blocked", () => {
  const cases = [
    {
      rawAd: ad({
        campaignId: "Unknown-Campaign",
      }),
      expectedReason: "unresolved_store",
    },
    {
      rawAd: ad({
        advertiserId: "Different-Advertiser",
      }),
      expectedReason: "identity_conflict",
    },
  ] as const;

  for (const entry of cases) {
    const catalog = matchingExistingCatalog();

    const input = plannerInput(
      catalog,
      entry.rawAd,
    );

    const executable =
      AdsPersistencePlannerV2.plan(input);

    const preview =
      AdsPersistencePlannerV2.planProviderRefreshPreview(
        input,
      );

    assert.equal(
      executable.counts.writableEntities,
      0,
    );

    assert.equal(preview.status, "blocked");

    assert.equal(
      preview.offers[0]?.action,
      "blocked",
    );

    assert.equal(
      preview.offers[0]?.reason,
      entry.expectedReason,
    );

    assert.equal(
      preview.counts.offers.updateExisting,
      0,
    );
  }
});

test("new invalid or no-code Ads remain outside provider refresh preview", () => {
  const cases = [
    noCodeAd(),
    ad({
      dateFieldsValid: false,
    }),
    ad({
      title: null,
    }),
    ad({
      campaignId: "Unknown-Campaign",
    }),
  ];

  for (const rawAd of cases) {
    const input = plannerInput(
      {
        stores: [],
        offers: [],
      },
      rawAd,
    );

    const preview =
      AdsPersistencePlannerV2.planProviderRefreshPreview(
        input,
      );

    assert.deepEqual(
      preview.stores,
      [],
    );

    assert.deepEqual(
      preview.offers,
      [],
    );

    assert.equal(
      preview.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      preview.counts.offers.updateExisting,
      0,
    );
  }
});

test("missing parent ownership evidence blocks Campaign and Ad refresh preview", () => {
  const catalog = matchingExistingCatalog();

  delete catalog.stores[0]!.importOrigin;
  delete catalog.stores[0]!.lifecycleManaged;

  const input = plannerInput(catalog);

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.storeInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.stores[0]?.reason,
    "missing_ownership_evidence",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "missing_ownership_evidence",
  );

  assert.equal(
    preview.counts.stores.updateExisting,
    0,
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});

test("non-provider-managed parent blocks Campaign and Ad refresh preview", () => {
  const catalog = matchingExistingCatalog();

  catalog.stores[0]!.importOrigin = null;
  catalog.stores[0]!.lifecycleManaged = false;

  const input = plannerInput(catalog);

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.storeInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_existing",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.stores[0]?.reason,
    "ownership_not_provider_managed",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "ownership_not_provider_managed",
  );

  assert.equal(
    preview.counts.stores.updateExisting,
    0,
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});

test("parent ownership outranks invalid provider source reason", () => {
  const catalog = matchingExistingCatalog();

  catalog.stores[0]!.importOrigin = null;
  catalog.stores[0]!.lifecycleManaged = false;

  const input = plannerInput(
    catalog,
    noCodeAd(),
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.offers[0]?.action,
    "blocked",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "ownership_not_provider_managed",
  );

  assert.notEqual(
    preview.offers[0]?.reason,
    "missing_coupon_code",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});

test("expired existing Ad cannot refresh beneath non-provider-managed parent", () => {
  const catalog = matchingExistingCatalog();

  catalog.stores[0]!.importOrigin = null;
  catalog.stores[0]!.lifecycleManaged = false;

  const input = plannerInput(
    catalog,
    ad({
      dealStartDate:
        "2026-01-01T00:00:00Z",
      dealEndDate:
        "2026-05-31T23:59:59Z",
    }),
  );

  const executable =
    AdsPersistencePlannerV2.plan(input);

  const preview =
    AdsPersistencePlannerV2.planProviderRefreshPreview(
      input,
    );

  assert.equal(
    executable.offerInstructions[0]?.action,
    "noop_held",
  );

  assert.equal(
    executable.offerInstructions[0]?.action ===
        "noop_held"
      ? executable.offerInstructions[0].holdReason
      : null,
    "expired",
  );

  assert.equal(
    executable.counts.writableEntities,
    0,
  );

  assert.equal(preview.status, "blocked");

  assert.equal(
    preview.stores[0]?.reason,
    "ownership_not_provider_managed",
  );

  assert.equal(
    preview.offers[0]?.reason,
    "ownership_not_provider_managed",
  );

  assert.equal(
    preview.counts.offers.updateExisting,
    0,
  );
});
