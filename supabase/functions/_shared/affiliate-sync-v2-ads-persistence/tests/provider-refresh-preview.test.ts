import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsRecordProvenanceV2,
  ImpactAdsFetchDiagnosticsV2,
  RawImpactAdV2,
  RawImpactCampaignForAdsV2,
} from "../../affiliate-sync-v2-ads/index.ts";

import {
  type AdsCatalogPlanningContextV2,
  type AdsPersistencePlannerInputV2,
  AdsPersistencePlannerV2,
} from "../AdsPersistencePlannerV2.ts";

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

function ad(): RawImpactAdV2 {
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
  };
}

function plannerInput(
  catalog: AdsCatalogPlanningContextV2,
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
      records: [ad()],
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
