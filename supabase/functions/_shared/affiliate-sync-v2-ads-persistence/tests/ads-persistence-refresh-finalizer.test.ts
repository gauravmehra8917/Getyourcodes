import assert from "node:assert/strict";
import test from "node:test";

import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  type AdsPersistencePlanV2,
  type AdsProviderManagedOfferStateV2,
  type AdsProviderManagedStoreStateV2,
} from "../ads-persistence-models.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsProviderManagedOfferDesiredStateV2,
  type AdsProviderManagedStoreDesiredStateV2,
  type AdsRefreshPersistenceBlockerV2,
  type AdsUpdateOfferInstructionV2,
  type AdsUpdateStoreInstructionV2,
} from "../ads-persistence-refresh-models.ts";

import {
  canonicalAdsRefreshJsonV2,
  finalizeAdsRefreshPersistencePlanV2,
} from "../ads-persistence-refresh-finalizer.ts";

const STORE_ID =
  "11111111-1111-4111-8111-111111111111";

const OFFER_ID =
  "22222222-2222-4222-8222-222222222222";

const INTEGRATION_ID =
  "33333333-3333-4333-8333-333333333333";

const EVALUATION =
  "2026-09-15T07:30:00.000Z";

function basePlan():
  AdsPersistencePlanV2 {
  const material = {
    persistenceContractVersion:
      ADS_PERSISTENCE_CONTRACT_VERSION_V2,

    provider: "impact" as const,

    integrationId: INTEGRATION_ID,

    evaluationTimestamp: EVALUATION,

    mode: "full" as const,

    canaryAdId: null,

    status: "ready" as const,

    blockers: [],

    preconditions: [],

    storeInstructions: [],

    offerInstructions: [],

    counts: {
      stores: {
        create: 0,
        noopExisting: 0,
        blockedAmbiguous: 0,
        noopUnmatched: 0,
      },

      offers: {
        create: 0,
        noopExisting: 0,
        noopHeld: 0,
        noopUnresolved: 0,
      },

      writableStores: 0,
      writableOffers: 0,
      writableEntities: 0,
    },
  };

  return {
    ...material,
    canonicalPlanMaterial: material,
    canonicalPlanMaterialString:
      "legacy-test-material",
  };
}

function currentStoreState():
  AdsProviderManagedStoreStateV2 {
  return {
    affiliateUrl:
      "https://old.example/campaign",

    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: null,
      campaignName: "Old Campaign",
      destinationUrl:
        "https://old.example/campaign",
      trackingUrl:
        "https://track.example/old-campaign",
    },
  };
}

function desiredStoreState():
  AdsProviderManagedStoreDesiredStateV2 {
  return {
    affiliateUrl:
      "https://new.example/campaign",

    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: "Campaign-A",
      campaignName: "Campaign A",
      destinationUrl:
        "https://new.example/campaign",
      trackingUrl:
        "https://track.example/new-campaign",
    },
  };
}

function currentOfferState():
  AdsProviderManagedOfferStateV2 {
  return {
    couponCode: "OLD20",

    affiliateUrl:
      "https://track.example/old-ad",

    landingPageUrl:
      "https://old.example/ad",

    startDate: "2026-01-01",

    expiryDate: "2026-10-01",

    status: "active",

    terms: "Old provider terms",

    discountType: "percentage",

    discountValue: 20,

    structuredTerms: null,

    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Campaign A",
      adName: "Provider Ad",
      dealStartDate:
        "2026-01-01T00:00:00Z",
      dealEndDate:
        "2026-10-01T23:59:59Z",
      startDate: "2026-01-01",
      endDate: "2026-10-01",
    },
  };
}

function desiredOfferState():
  AdsProviderManagedOfferDesiredStateV2 {
  return {
    couponCode: "SAVE25",

    affiliateUrl:
      "https://track.example/new-ad",

    landingPageUrl:
      "https://new.example/ad",

    startDate: "2026-01-01",

    expiryDate: "2026-12-31",

    status: "active",

    terms: "New provider terms",

    discountType: "percentage",

    discountValue: 25,

    structuredTerms: null,

    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Campaign A",
      adName: "Provider Ad",
      dealStartDate:
        "2026-01-01T00:00:00Z",
      dealEndDate:
        "2026-12-31T23:59:59Z",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  };
}

function storeUpdate():
  AdsUpdateStoreInstructionV2 {
  return {
    action: "update_existing",

    providerStoreKey: {
      provider: "impact",
      namespace: "campaign",
      id: "Campaign-A",
    },

    provider: "impact",

    providerEntityNamespace:
      "campaign",

    providerEntityId:
      "Campaign-A",

    expectedExistingStoreId:
      STORE_ID,

    qualified: true,

    expectedCurrentManagedState:
      currentStoreState(),

    desiredManagedState:
      desiredStoreState(),
  };
}

function offerUpdate():
  AdsUpdateOfferInstructionV2 {
  return {
    action: "update_existing",

    providerOfferKey: {
      provider: "impact",
      namespace: "ad",
      id: "Ad-A",
    },

    provider: "impact",

    providerEntityNamespace: "ad",

    providerEntityId: "Ad-A",

    kind: "coupon",

    existingOfferId: OFFER_ID,

    parentProviderStoreKey: {
      provider: "impact",
      namespace: "campaign",
      id: "Campaign-A",
    },

    parentProviderEntityNamespace:
      "campaign",

    parentProviderEntityId:
      "Campaign-A",

    expectedParentStoreId:
      STORE_ID,

    expectedCurrentManagedState:
      currentOfferState(),

    desiredManagedState:
      desiredOfferState(),
  };
}

test("finalizer upgrades canonical version only and leaves ads-1 base untouched", () => {
  const base = basePlan();

  const before =
    JSON.stringify(base);

  const result =
    finalizeAdsRefreshPersistencePlanV2({
      basePlan: base,

      storeInstructions: [
        storeUpdate(),
      ],

      offerInstructions: [
        offerUpdate(),
      ],
    });

  assert.equal(
    result.persistenceContractVersion,
    ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  );

  assert.equal(
    ADS_PERSISTENCE_CONTRACT_VERSION_V2,
    "v2-a11-ads-1",
  );

  assert.equal(
    JSON.stringify(base),
    before,
  );
});

test("UPDATE instructions are writable and counted independently from CREATE", () => {
  const result =
    finalizeAdsRefreshPersistencePlanV2({
      basePlan: basePlan(),

      storeInstructions: [
        storeUpdate(),
      ],

      offerInstructions: [
        offerUpdate(),
      ],
    });

  assert.deepEqual(
    result.counts,
    {
      stores: {
        create: 0,
        updateExisting: 1,
        noopExisting: 0,
        blockedAmbiguous: 0,
        noopUnmatched: 0,
      },

      offers: {
        create: 0,
        updateExisting: 1,
        noopExisting: 0,
        noopHeld: 0,
        noopUnresolved: 0,
      },

      writableStores: 1,
      writableOffers: 1,
      writableEntities: 2,
    },
  );

  assert.equal(
    result.status,
    "ready",
  );
});

test("refresh blocker evidence makes the detached plan blocked without altering instructions", () => {
  const blocker:
    AdsRefreshPersistenceBlockerV2 = {
      source: "provider_refresh",
      scope: "offer",
      reason: "invalid_date",
      providerEntityNamespace: "ad",
      providerEntityId: "Ad-A",
    };

  const result =
    finalizeAdsRefreshPersistencePlanV2({
      basePlan: basePlan(),

      storeInstructions: [
        storeUpdate(),
      ],

      offerInstructions: [
        offerUpdate(),
      ],

      additionalBlockers: [
        blocker,
      ],
    });

  assert.equal(
    result.status,
    "blocked",
  );

  assert.equal(
    result.blockers.length,
    1,
  );

  assert.deepEqual(
    result.blockers[0],
    blocker,
  );

  assert.equal(
    result.counts.writableEntities,
    2,
  );
});

test("canonical JSON is independent of object insertion order", () => {
  const first =
    desiredOfferState();

  const reversedMetadata =
    Object.fromEntries(
      Object.entries(
        first.metadata,
      ).reverse(),
    ) as typeof first.metadata;

  const second = {
    ...first,
    metadata: reversedMetadata,
  };

  assert.equal(
    canonicalAdsRefreshJsonV2(
      first,
    ),
    canonicalAdsRefreshJsonV2(
      second,
    ),
  );

  const one =
    finalizeAdsRefreshPersistencePlanV2({
      basePlan: basePlan(),

      storeInstructions: [
        storeUpdate(),
      ],

      offerInstructions: [
        offerUpdate(),
      ],
    });

  const reorderedOffer = {
    ...offerUpdate(),

    desiredManagedState:
      second,
  };

  const two =
    finalizeAdsRefreshPersistencePlanV2({
      basePlan: basePlan(),

      storeInstructions: [
        storeUpdate(),
      ],

      offerInstructions: [
        reorderedOffer,
      ],
    });

  assert.equal(
    one.canonicalPlanMaterialString,
    two.canonicalPlanMaterialString,
  );
});

test("duplicate exact provider identities fail closed before canonical material exists", () => {
  assert.throws(
    () =>
      finalizeAdsRefreshPersistencePlanV2({
        basePlan: basePlan(),

        storeInstructions: [
          storeUpdate(),
          storeUpdate(),
        ],

        offerInstructions: [],
      }),
    /ads2_duplicate_store_provider_id/,
  );

  assert.throws(
    () =>
      finalizeAdsRefreshPersistencePlanV2({
        basePlan: basePlan(),

        storeInstructions: [],

        offerInstructions: [
          offerUpdate(),
          offerUpdate(),
        ],
      }),
    /ads2_duplicate_offer_provider_id/,
  );
});

test("non-JSON or non-finite canonical values fail closed", () => {
  assert.throws(
    () =>
      canonicalAdsRefreshJsonV2({
        value: Number.NaN,
      }),
    /ads2_non_finite_number/,
  );

  assert.throws(
    () =>
      canonicalAdsRefreshJsonV2({
        value: undefined,
      }),
    /ads2_undefined_value/,
  );
});
