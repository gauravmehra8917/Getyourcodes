import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsRecordProvenanceV2,
  ImpactAdsFetchDiagnosticsV2,
  RawImpactAdV2,
  RawImpactCampaignForAdsV2,
} from "../../affiliate-sync-v2-ads/index.ts";

import type {
  AdsCatalogPlanningContextV2,
} from "../ads-persistence-models.ts";

import {
  AdsPersistencePlannerV2,
  type AdsPersistencePlannerInputV2,
} from "../AdsPersistencePlannerV2.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
} from "../ads-persistence-refresh-models.ts";

import {
  materializeAdsRefreshPersistencePlanV2,
} from "../ads-persistence-refresh-materializer.ts";

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

const PROVENANCE:
  AdsRecordProvenanceV2 = {
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

function campaign():
  RawImpactCampaignForAdsV2 {
  return {
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    campaignName: "Acme & Co.",
    destinationUrl:
      "https://acme.example/sale",
    trackingUrl:
      "https://track.example/campaign",
    provenance: PROVENANCE,
  };
}

function ad(
  overrides:
    Partial<RawImpactAdV2> = {},
): RawImpactAdV2 {
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
    description:
      "Twenty percent off selected products.",
    trackingUrl:
      "https://track.example/ad",
    landingPageUrl:
      "https://acme.example/coupon",
    dealStartDate:
      "2026-05-01T00:00:00Z",
    dealEndDate:
      "2026-12-31T23:59:59Z",
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
    validatedCouponCode:
      "SAVE-20",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function plannerInput(
  catalog:
    AdsCatalogPlanningContextV2,
  rawAds:
    readonly RawImpactAdV2[] = [ad()],
): AdsPersistencePlannerInputV2 {
  return {
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl:
      "https://getyourcodes.com/admin/path",
    mode: "full",
    canaryAdId: null,
    campaignFetch: {
      records: [campaign()],
      diagnostics:
        diagnostics("campaigns", 1),
    },
    adsFetch: {
      records: [...rawAds],
      diagnostics:
        diagnostics(
          "ads",
          rawAds.length,
        ),
    },
    catalog,
  };
}

function matchingExistingCatalog():
  AdsCatalogPlanningContextV2 {
  const seed =
    AdsPersistencePlannerV2.plan(
      plannerInput({
        stores: [],
        offers: [],
      }),
    );

  assert.equal(
    seed.status,
    "ready",
  );

  const store =
    seed.storeInstructions[0];

  const offer =
    seed.offerInstructions[0];

  assert.equal(
    store?.action,
    "create",
  );

  assert.equal(
    offer?.action,
    "create",
  );

  if (
    store?.action !== "create" ||
    offer?.action !== "create"
  ) {
    throw new Error(
      "seed projections unavailable",
    );
  }

  return {
    stores: [{
      storeId: STORE_ID,
      slug:
        store.projection
          .slugCandidate,
      provider: "impact",
      providerEntityNamespace:
        "campaign",
      providerEntityId:
        "Campaign-A",
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
      providerEntityNamespace:
        "ad",
      providerEntityId: "Ad-A",
      couponType: "code",
      providerManagedState:
        providerManagedOfferStateFromProjectionV2(
          offer.projection,
        ),
    }],
  };
}

function refreshBlockerReasons(
  plan:
    ReturnType<
      typeof materializeAdsRefreshPersistencePlanV2
    >,
): string[] {
  return plan.blockers
    .filter(
      (entry) =>
        "source" in entry &&
        entry.source ===
          "provider_refresh",
    )
    .map((entry) => entry.reason);
}

test(
  "matching exact provider state remains one Campaign NOOP and one Ad NOOP",
  () => {
    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(
          matchingExistingCatalog(),
        ),
      );

    assert.equal(
      result.persistenceContractVersion,
      ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
    );

    assert.equal(
      result.status,
      "ready",
    );

    assert.equal(
      result.storeInstructions.length,
      1,
    );

    assert.equal(
      result.offerInstructions.length,
      1,
    );

    assert.equal(
      result.storeInstructions[0]?.action,
      "noop_existing",
    );

    assert.equal(
      result.offerInstructions[0]?.action,
      "noop_existing",
    );

    assert.equal(
      result.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );
  },
);

test(
  "changed current provider-managed state materializes exact Campaign and Ad UPDATE instructions",
  () => {
    const catalog =
      matchingExistingCatalog();

    const storeState =
      catalog.stores[0]!
        .providerManagedState!;

    const offerState =
      catalog.offers[0]!
        .providerManagedState!;

    catalog.stores[0]!
      .providerManagedState = {
        ...storeState,
        affiliateUrl:
          "https://old.example/campaign",
        metadata: {
          ...storeState.metadata,
        },
      };

    catalog.offers[0]!
      .providerManagedState = {
        ...offerState,
        couponCode: "OLD-CODE",
        metadata: {
          ...offerState.metadata,
        },
      };

    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(catalog),
      );

    assert.equal(
      result.status,
      "ready",
    );

    const store =
      result.storeInstructions[0];

    const offer =
      result.offerInstructions[0];

    assert.equal(
      store?.action,
      "update_existing",
    );

    assert.equal(
      offer?.action,
      "update_existing",
    );

    if (
      store?.action !==
        "update_existing" ||
      offer?.action !==
        "update_existing"
    ) {
      return;
    }

    assert.equal(
      store.expectedExistingStoreId,
      STORE_ID,
    );

    assert.equal(
      store
        .expectedCurrentManagedState
        .affiliateUrl,
      "https://old.example/campaign",
    );

    assert.equal(
      store
        .desiredManagedState
        .affiliateUrl,
      "https://acme.example/sale",
    );

    assert.equal(
      offer.existingOfferId,
      OFFER_ID,
    );

    assert.equal(
      offer.expectedParentStoreId,
      STORE_ID,
    );

    assert.equal(
      offer
        .expectedCurrentManagedState
        .couponCode,
      "OLD-CODE",
    );

    assert.equal(
      offer
        .desiredManagedState
        .couponCode,
      "SAVE-20",
    );

    assert.equal(
      "projection" in store,
      false,
    );

    assert.equal(
      "projection" in offer,
      false,
    );

    assert.equal(
      "seoTitle" in
        store.desiredManagedState,
      false,
    );

    assert.equal(
      "title" in
        offer.desiredManagedState,
      false,
    );

    assert.equal(
      result.counts.stores.updateExisting,
      1,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      1,
    );
  },
);

test(
  "exact existing future Ad replaces Ads-1 noop_held with exactly one UPDATE",
  () => {
    const catalog =
      matchingExistingCatalog();

    const input =
      plannerInput(
        catalog,
        [ad({
          dealStartDate:
            "2026-07-01T00:00:00Z",
          dealEndDate:
            "2026-12-31T23:59:59Z",
        })],
      );

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.offerInstructions[0]?.action,
      "noop_held",
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    const matching =
      result.offerInstructions.filter(
        (entry) =>
          entry.providerEntityId ===
            "Ad-A",
      );

    assert.equal(
      matching.length,
      1,
    );

    assert.equal(
      matching[0]?.action,
      "update_existing",
    );

    assert.equal(
      result.counts.offers.noopHeld,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      1,
    );
  },
);

test(
  "exact existing expired Ad replaces Ads-1 noop_held with exactly one UPDATE",
  () => {
    const catalog =
      matchingExistingCatalog();

    const input =
      plannerInput(
        catalog,
        [ad({
          dealStartDate:
            "2026-01-01T00:00:00Z",
          dealEndDate:
            "2026-05-31T23:59:59Z",
        })],
      );

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.offerInstructions[0]?.action,
      "noop_held",
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    const matching =
      result.offerInstructions.filter(
        (entry) =>
          entry.providerEntityId ===
            "Ad-A",
      );

    assert.equal(
      matching.length,
      1,
    );

    assert.equal(
      matching[0]?.action,
      "update_existing",
    );

    assert.equal(
      result.counts.offers.noopHeld,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      1,
    );
  },
);

test(
  "new future Ad remains held and is never converted into UPDATE",
  () => {
    const input =
      plannerInput(
        {
          stores: [],
          offers: [],
        },
        [ad({
          dealStartDate:
            "2026-07-01T00:00:00Z",
          dealEndDate:
            "2026-12-31T23:59:59Z",
        })],
      );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    assert.equal(
      result.offerInstructions.length,
      1,
    );

    assert.equal(
      result.offerInstructions[0]?.action,
      "noop_held",
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );

    assert.equal(
      result.counts.writableEntities,
      0,
    );
  },
);

test(
  "new active Campaign and Ad preserve Ads-1 CREATE instructions unchanged",
  () => {
    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput({
          stores: [],
          offers: [],
        }),
      );

    assert.equal(
      result.status,
      "ready",
    );

    assert.equal(
      result.storeInstructions[0]?.action,
      "create",
    );

    assert.equal(
      result.offerInstructions[0]?.action,
      "create",
    );

    assert.equal(
      result.counts.stores.create,
      1,
    );

    assert.equal(
      result.counts.offers.create,
      1,
    );

    assert.equal(
      result.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );
  },
);

test(
  "missing current snapshot blocks refresh and never emits UPDATE",
  () => {
    const catalog =
      matchingExistingCatalog();

    catalog.offers[0]!
      .providerManagedState = null;

    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(catalog),
      );

    assert.equal(
      result.status,
      "blocked",
    );

    assert.ok(
      refreshBlockerReasons(result)
        .includes("missing_snapshot"),
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );
  },
);

test(
  "non-provider-managed parent blocks Campaign and child Ad refresh",
  () => {
    const catalog =
      matchingExistingCatalog();

    catalog.stores[0]!
      .importOrigin = null;

    catalog.stores[0]!
      .lifecycleManaged = false;

    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(catalog),
      );

    assert.equal(
      result.status,
      "blocked",
    );

    const reasons =
      refreshBlockerReasons(result);

    assert.ok(
      reasons.includes(
        "ownership_not_provider_managed",
      ),
    );

    assert.equal(
      result.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );
  },
);

test(
  "invalid existing provider source is blocked without destructive fallback",
  () => {
    const catalog =
      matchingExistingCatalog();

    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(
          catalog,
          [ad({
            codeClass: "no_code",
            validatedCouponCode: null,
          })],
        ),
      );

    assert.equal(
      result.status,
      "blocked",
    );

    assert.ok(
      refreshBlockerReasons(result)
        .includes(
          "missing_coupon_code",
        ),
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );

    assert.equal(
      result.offerInstructions.some(
        (entry) =>
          entry.action ===
            "update_existing",
      ),
      false,
    );
  },
);

test(
  "provider absence produces no refresh instruction and no delete or hide action",
  () => {
    const result =
      materializeAdsRefreshPersistencePlanV2(
        plannerInput(
          matchingExistingCatalog(),
          [],
        ),
      );

    assert.equal(
      result.status,
      "ready",
    );

    assert.deepEqual(
      result.storeInstructions,
      [],
    );

    assert.deepEqual(
      result.offerInstructions,
      [],
    );

    assert.equal(
      result.counts.writableEntities,
      0,
    );

    assert.deepEqual(
      refreshBlockerReasons(result),
      [],
    );
  },
);

test(
  "blocked Ads-1 canary plan is preserved without Ads-2 refresh materialization",
  () => {
    const catalog =
      matchingExistingCatalog();

    const input:
      AdsPersistencePlannerInputV2 = {
        ...plannerInput(
          catalog,
          [ad({
            codeClass: "no_code",
            validatedCouponCode: null,
          })],
        ),
        mode: "canary",
        canaryAdId: "Ad-A",
      };

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.status,
      "blocked",
    );

    assert.ok(
      base.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    assert.equal(
      base.counts.writableEntities,
      0,
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    assert.equal(
      result.status,
      "blocked",
    );

    assert.ok(
      result.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    /*
     * A pre-blocked Ads-1 plan is canonical input evidence,
     * not an invitation for Ads-2 to reinterpret source state.
     */
    assert.deepEqual(
      result.storeInstructions,
      base.storeInstructions,
    );

    assert.deepEqual(
      result.offerInstructions,
      base.offerInstructions,
    );

    assert.equal(
      result.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );

    assert.equal(
      result.counts.writableEntities,
      0,
    );
  },
);

test(
  "canary exact existing future Ad remains ineligible and zero-write",
  () => {
    const catalog =
      matchingExistingCatalog();

    const input:
      AdsPersistencePlannerInputV2 = {
        ...plannerInput(
          catalog,
          [ad({
            dealStartDate:
              "2026-07-01T00:00:00Z",
            dealEndDate:
              "2026-12-31T23:59:59Z",
          })],
        ),
        mode: "canary",
        canaryAdId: "Ad-A",
      };

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.status,
      "blocked",
    );

    assert.ok(
      base.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    assert.equal(
      base.offerInstructions.length,
      1,
    );

    assert.equal(
      base.offerInstructions[0]?.action,
      "noop_held",
    );

    assert.equal(
      base.offerInstructions[0]?.action ===
          "noop_held"
        ? base.offerInstructions[0]
            .holdReason
        : null,
      "not_started",
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    assert.equal(
      result.status,
      "blocked",
    );

    assert.ok(
      result.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    const matching =
      result.offerInstructions.filter(
        (entry) =>
          entry.providerEntityId ===
            "Ad-A",
      );

    assert.equal(
      matching.length,
      1,
    );

    assert.equal(
      matching[0]?.action,
      "noop_held",
    );

    assert.equal(
      matching[0]?.action ===
          "noop_held"
        ? matching[0].holdReason
        : null,
      "not_started",
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );

    assert.equal(
      result.counts.writableEntities,
      0,
    );
  },
);

test(
  "canary exact existing expired Ad remains ineligible and zero-write",
  () => {
    const catalog =
      matchingExistingCatalog();

    const input:
      AdsPersistencePlannerInputV2 = {
        ...plannerInput(
          catalog,
          [ad({
            dealStartDate:
              "2026-01-01T00:00:00Z",
            dealEndDate:
              "2026-05-31T23:59:59Z",
          })],
        ),
        mode: "canary",
        canaryAdId: "Ad-A",
      };

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.status,
      "blocked",
    );

    assert.ok(
      base.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    assert.equal(
      base.offerInstructions.length,
      1,
    );

    assert.equal(
      base.offerInstructions[0]?.action,
      "noop_held",
    );

    assert.equal(
      base.offerInstructions[0]?.action ===
          "noop_held"
        ? base.offerInstructions[0]
            .holdReason
        : null,
      "expired",
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    assert.equal(
      result.status,
      "blocked",
    );

    assert.ok(
      result.blockers.some(
        (entry) =>
          entry.reason ===
            "canary_ad_ineligible",
      ),
    );

    const matching =
      result.offerInstructions.filter(
        (entry) =>
          entry.providerEntityId ===
            "Ad-A",
      );

    assert.equal(
      matching.length,
      1,
    );

    assert.equal(
      matching[0]?.action,
      "noop_held",
    );

    assert.equal(
      matching[0]?.action ===
          "noop_held"
        ? matching[0].holdReason
        : null,
      "expired",
    );

    assert.equal(
      result.counts.offers.updateExisting,
      0,
    );

    assert.equal(
      result.counts.writableEntities,
      0,
    );
  },
);

test(
  "canary exact existing active Ad can materialize one provider UPDATE",
  () => {
    const catalog =
      matchingExistingCatalog();

    const current =
      catalog.offers[0]!
        .providerManagedState!;

    /*
     * Simulate one stale provider-owned field in the DB.
     * Source remains a valid active exact Ad.
     */
    catalog.offers[0]!
      .providerManagedState = {
        ...current,
        couponCode: "OLD-CODE",
        metadata: {
          ...current.metadata,
        },
      };

    const input:
      AdsPersistencePlannerInputV2 = {
        ...plannerInput(
          catalog,
          [ad()],
        ),
        mode: "canary",
        canaryAdId: "Ad-A",
      };

    const base =
      AdsPersistencePlannerV2.plan(
        input,
      );

    assert.equal(
      base.status,
      "ready",
    );

    assert.equal(
      base.storeInstructions.length,
      1,
    );

    assert.equal(
      base.offerInstructions.length,
      1,
    );

    assert.equal(
      base.storeInstructions[0]?.action,
      "noop_existing",
    );

    assert.equal(
      base.offerInstructions[0]?.action,
      "noop_existing",
    );

    const result =
      materializeAdsRefreshPersistencePlanV2(
        input,
      );

    assert.equal(
      result.status,
      "ready",
    );

    assert.equal(
      result.storeInstructions.length,
      1,
    );

    assert.equal(
      result.offerInstructions.length,
      1,
    );

    assert.equal(
      result.storeInstructions[0]?.action,
      "noop_existing",
    );

    const offer =
      result.offerInstructions[0];

    assert.equal(
      offer?.action,
      "update_existing",
    );

    if (
      offer?.action !==
        "update_existing"
    ) {
      return;
    }

    assert.equal(
      offer.providerEntityId,
      "Ad-A",
    );

    assert.equal(
      offer.existingOfferId,
      OFFER_ID,
    );

    assert.equal(
      offer.expectedParentStoreId,
      STORE_ID,
    );

    assert.equal(
      offer
        .expectedCurrentManagedState
        .couponCode,
      "OLD-CODE",
    );

    assert.equal(
      offer
        .desiredManagedState
        .couponCode,
      "SAVE-20",
    );

    assert.equal(
      result.counts.stores.updateExisting,
      0,
    );

    assert.equal(
      result.counts.offers.updateExisting,
      1,
    );

    assert.equal(
      result.counts.writableEntities,
      1,
    );
  },
);
