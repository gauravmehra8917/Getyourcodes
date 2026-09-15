import assert from "node:assert/strict";
import test from "node:test";

import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
} from "../ads-persistence-models.ts";

import type {
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "../ads-persistence-models.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsProviderManagedOfferDesiredStateV2,
  type AdsProviderManagedStoreDesiredStateV2,
  type AdsRefreshCanonicalPersistencePlanMaterialV2,
  type AdsRefreshPersistencePlanCountsV2,
  type AdsUpdateOfferInstructionV2,
  type AdsUpdateStoreInstructionV2,
} from "../ads-persistence-refresh-models.ts";

const STORE_ID =
  "11111111-1111-4111-8111-111111111111";

const OFFER_ID =
  "22222222-2222-4222-8222-222222222222";

const INTEGRATION_ID =
  "33333333-3333-4333-8333-333333333333";

function currentStoreState(): AdsProviderManagedStoreStateV2 {
  return {
    affiliateUrl: "https://old.example/campaign",
    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: null,
      campaignName: "Old Campaign",
      destinationUrl: "https://old.example/campaign",
      trackingUrl: "https://track.example/old-campaign",
    },
  };
}

function desiredStoreState(): AdsProviderManagedStoreDesiredStateV2 {
  return {
    affiliateUrl: "https://new.example/campaign",
    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: "Campaign-A",
      campaignName: "Campaign A",
      destinationUrl: "https://new.example/campaign",
      trackingUrl: "https://track.example/new-campaign",
    },
  };
}

function currentOfferState(): AdsProviderManagedOfferStateV2 {
  return {
    couponCode: "OLD20",
    affiliateUrl: "https://track.example/old-ad",
    landingPageUrl: "https://old.example/ad",
    startDate: "2026-01-01",
    expiryDate: "2026-10-01",
    status: "active",
    terms: "Old provider terms",
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
    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Campaign A",
      adName: "Provider Ad",
      dealStartDate: "2026-01-01T00:00:00Z",
      dealEndDate: "2026-10-01T23:59:59Z",
      startDate: "2026-01-01",
      endDate: "2026-10-01",
    },
  };
}

function desiredOfferState(): AdsProviderManagedOfferDesiredStateV2 {
  return {
    couponCode: "SAVE25",
    affiliateUrl: "https://track.example/new-ad",
    landingPageUrl: "https://new.example/ad",
    startDate: "2026-01-01",
    expiryDate: "2026-12-31",
    status: "active",
    terms: "New provider terms",
    discountType: "percentage",
    discountValue: 25,
    structuredTerms: {
      minimumPurchase: 50,
      maximumSavings: 25,
      purchaseLimit: 1,
      scope: "Sitewide",
      currency: "USD",
      text: null,
    },
    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Campaign A",
      adName: "Provider Ad",
      dealStartDate: "2026-01-01T00:00:00Z",
      dealEndDate: "2026-12-31T23:59:59Z",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  };
}

function storeUpdate(): AdsUpdateStoreInstructionV2 {
  return {
    action: "update_existing",
    providerStoreKey: {
      provider: "impact",
      namespace: "campaign",
      id: "Campaign-A",
    },
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: "Campaign-A",
    expectedExistingStoreId: STORE_ID,
    qualified: true,
    expectedCurrentManagedState: currentStoreState(),
    desiredManagedState: desiredStoreState(),
  };
}

function offerUpdate(): AdsUpdateOfferInstructionV2 {
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
    parentProviderEntityNamespace: "campaign",
    parentProviderEntityId: "Campaign-A",
    expectedParentStoreId: STORE_ID,
    expectedCurrentManagedState: currentOfferState(),
    desiredManagedState: desiredOfferState(),
  };
}

test("ads-1 legacy version is preserved and ads-2 is additive", () => {
  assert.equal(
    ADS_PERSISTENCE_CONTRACT_VERSION_V2,
    "v2-a11-ads-1",
  );

  assert.equal(
    ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
    "v2-a11-ads-2",
  );

  assert.notEqual(
    ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
    ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  );
});

test("Campaign UPDATE contains only identity, concurrency and managed state", () => {
  const instruction = storeUpdate();

  assert.deepEqual(
    Object.keys(instruction).sort(),
    [
      "action",
      "desiredManagedState",
      "expectedCurrentManagedState",
      "expectedExistingStoreId",
      "provider",
      "providerEntityId",
      "providerEntityNamespace",
      "providerStoreKey",
      "qualified",
    ].sort(),
  );

  assert.equal(
    "projection" in instruction,
    false,
  );

  const serialized = JSON.stringify(instruction);

  for (
    const forbidden of [
      "seoTitle",
      "seoDescription",
      "seoCanonicalUrl",
      "description",
      "slugCandidate",
      "logoSourceUrl",
      "country",
      "shippingRegions",
      "lifecycleHidden",
      "lastQualifiedAt",
    ]
  ) {
    assert.equal(
      serialized.includes(`"${forbidden}"`),
      false,
      forbidden,
    );
  }
});

test("Ad UPDATE contains exact immutable parent evidence and no presentation projection", () => {
  const instruction = offerUpdate();

  assert.deepEqual(
    Object.keys(instruction).sort(),
    [
      "action",
      "desiredManagedState",
      "existingOfferId",
      "expectedCurrentManagedState",
      "expectedParentStoreId",
      "kind",
      "parentProviderEntityId",
      "parentProviderEntityNamespace",
      "parentProviderStoreKey",
      "provider",
      "providerEntityId",
      "providerEntityNamespace",
      "providerOfferKey",
    ].sort(),
  );

  assert.equal(
    instruction.parentProviderEntityId,
    instruction.parentProviderStoreKey.id,
  );

  assert.equal(
    "projection" in instruction,
    false,
  );

  const serialized = JSON.stringify(instruction);

  for (
    const forbidden of [
      "seoTitle",
      "seoDescription",
      "seoCanonicalUrl",
      "\"title\"",
      "\"description\"",
      "importedAt",
      "storeId",
    ]
  ) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      forbidden,
    );
  }
});

test("ads-2 canonical material has an explicit UPDATE count dimension", () => {
  const counts: AdsRefreshPersistencePlanCountsV2 = {
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
  };

  const material: AdsRefreshCanonicalPersistencePlanMaterialV2 = {
    persistenceContractVersion:
      ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
    provider: "impact",
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: "2026-09-15T07:30:00.000Z",
    mode: "full",
    canaryAdId: null,
    status: "ready",
    blockers: [],
    preconditions: [],
    storeInstructions: [storeUpdate()],
    offerInstructions: [offerUpdate()],
    counts,
  };

  assert.equal(
    material.persistenceContractVersion,
    "v2-a11-ads-2",
  );

  assert.equal(
    material.storeInstructions[0]?.action,
    "update_existing",
  );

  assert.equal(
    material.offerInstructions[0]?.action,
    "update_existing",
  );

  assert.equal(
    material.counts.writableStores,
    material.counts.stores.create +
      material.counts.stores.updateExisting,
  );

  assert.equal(
    material.counts.writableOffers,
    material.counts.offers.create +
      material.counts.offers.updateExisting,
  );

  assert.equal(
    material.counts.writableEntities,
    material.counts.writableStores +
      material.counts.writableOffers,
  );
});

test("historical nullable Campaign metadata is permitted only as expected current evidence", () => {
  const instruction = storeUpdate();

  assert.equal(
    instruction.expectedCurrentManagedState.metadata.campaignId,
    null,
  );

  assert.equal(
    instruction.desiredManagedState.metadata.campaignId,
    "Campaign-A",
  );
});
