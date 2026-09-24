import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAdsRefreshJsonV2 } from "../../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-finalizer.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsRefreshCanonicalPersistencePlanMaterialV2,
  type AdsRefreshPersistencePlanV2,
} from "../../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-models.ts";

import {
  adsRefreshPersistenceRpcArgsV2,
  prepareAdsRefreshPersistenceExecutionV2,
  type PreparedAdsRefreshPersistenceExecutionV2,
} from "../persistence-refresh-execution.ts";

import {
  parseAdsRefreshPersistenceSuccessV2,
} from "../persistence-refresh-result.ts";

const INTEGRATION_ID =
  "11111111-1111-4111-8111-111111111111";

const USER_ID =
  "22222222-2222-4222-8222-222222222222";

const STORE_ID =
  "33333333-3333-4333-8333-333333333333";

const OFFER_ID =
  "44444444-4444-4444-8444-444444444444";

const OTHER_ID =
  "55555555-5555-4555-8555-555555555555";

const RUN_ID =
  "66666666-6666-4666-8666-666666666666";

const EVALUATION =
  "2026-09-16T00:00:00.000Z";

function updateMaterial():
  AdsRefreshCanonicalPersistencePlanMaterialV2 {
  return {
    persistenceContractVersion:
      ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,

    provider:
      "impact",

    integrationId:
      INTEGRATION_ID,

    evaluationTimestamp:
      EVALUATION,

    mode:
      "full",

    canaryAdId:
      null,

    status:
      "ready",

    blockers:
      [],

    preconditions:
      [],

    storeInstructions: [
      {
        action:
          "update_existing",

        providerStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-A",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "campaign",

        providerEntityId:
          "Campaign-A",

        expectedExistingStoreId:
          STORE_ID,

        qualified:
          true,

        expectedCurrentManagedState: {
          affiliateUrl:
            "https://old.example/campaign",

          metadata: {
            advertiserId:
              "Advertiser-A",

            campaignId:
              "Campaign-A",

            campaignName:
              "Campaign A",

            destinationUrl:
              "https://old.example/store",

            trackingUrl:
              "https://track.example/old-store",
          },
        },

        desiredManagedState: {
          affiliateUrl:
            "https://new.example/campaign",

          metadata: {
            advertiserId:
              "Advertiser-A",

            campaignId:
              "Campaign-A",

            campaignName:
              "Campaign A",

            destinationUrl:
              "https://new.example/store",

            trackingUrl:
              "https://track.example/new-store",
          },
        },
      },
    ],

    offerInstructions: [
      {
        action:
          "update_existing",

        providerOfferKey: {
          provider:
            "impact",
          namespace:
            "ad",
          id:
            "Ad-A",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "ad",

        providerEntityId:
          "Ad-A",

        kind:
          "coupon",

        existingOfferId:
          OFFER_ID,

        parentProviderStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-A",
        },

        parentProviderEntityNamespace:
          "campaign",

        parentProviderEntityId:
          "Campaign-A",

        expectedParentStoreId:
          STORE_ID,

        expectedCurrentManagedState: {
          couponCode:
            "OLD-CODE",

          affiliateUrl:
            "https://old.example/ad",

          landingPageUrl:
            "https://old.example/coupon",

          startDate:
            "2026-01-01",

          expiryDate:
            "2026-12-31",

          status:
            "active",

          terms:
            "Old provider terms",

          discountType:
            "percentage",

          discountValue:
            10,

          structuredTerms:
            null,

          metadata: {
            adId:
              "Ad-A",

            campaignId:
              "Campaign-A",

            advertiserId:
              "Advertiser-A",

            dealId:
              "Deal-A",

            campaignName:
              "Campaign A",

            adName:
              "Campaign A coupon",

            dealStartDate:
              "2026-01-01T00:00:00Z",

            dealEndDate:
              "2026-12-31T23:59:59Z",

            startDate:
              "2026-01-01",

            endDate:
              "2026-12-31",
          },
        },

        desiredManagedState: {
          couponCode:
            "NEW-CODE",

          affiliateUrl:
            "https://new.example/ad",

          landingPageUrl:
            "https://new.example/coupon",

          startDate:
            "2026-01-01",

          expiryDate:
            "2026-12-31",

          status:
            "active",

          terms:
            "New provider terms",

          discountType:
            "percentage",

          discountValue:
            20,

          structuredTerms:
            null,

          metadata: {
            adId:
              "Ad-A",

            campaignId:
              "Campaign-A",

            advertiserId:
              "Advertiser-A",

            dealId:
              "Deal-A",

            campaignName:
              "Campaign A",

            adName:
              "Campaign A coupon",

            dealStartDate:
              "2026-01-01T00:00:00Z",

            dealEndDate:
              "2026-12-31T23:59:59Z",

            startDate:
              "2026-01-01",

            endDate:
              "2026-12-31",
          },
        },
      },
    ],

    counts: {
      stores: {
        create:
          0,

        updateExisting:
          1,

        noopExisting:
          0,

        blockedAmbiguous:
          0,

        noopUnmatched:
          0,
      },

      offers: {
        create:
          0,

        updateExisting:
          1,

        noopExisting:
          0,

        noopHeld:
          0,

        noopUnresolved:
          0,
      },

      writableStores:
        1,

      writableOffers:
        1,

      writableEntities:
        2,
    },
  };
}

function finalize(
  material:
    AdsRefreshCanonicalPersistencePlanMaterialV2,
): AdsRefreshPersistencePlanV2 {
  const canonical =
    structuredClone(
      material,
    );

  return {
    ...structuredClone(
      material,
    ),

    canonicalPlanMaterial:
      canonical,

    canonicalPlanMaterialString: canonicalAdsRefreshJsonV2(
      canonical,
    ),
  };
}

async function preparedUpdate():
  Promise<PreparedAdsRefreshPersistenceExecutionV2> {
  return await prepareAdsRefreshPersistenceExecutionV2(
    finalize(
      updateMaterial(),
    ),
    USER_ID,
  );
}

function validSuccess(
  prepared:
    PreparedAdsRefreshPersistenceExecutionV2,

  status:
    | "committed"
    | "replayed_existing" =
      "committed",
) {
  const args =
    adsRefreshPersistenceRpcArgsV2(
      prepared,
    );

  const store =
    args
      ._store_instructions[0];

  const offer =
    args
      ._offer_instructions[0];

  if (
    store?.action !==
      "update_existing" ||
    offer?.action !==
      "update_existing"
  ) {
    throw new Error(
      "invalid_update_fixture",
    );
  }

  return {
    status,

    runId:
      RUN_ID,

    persistenceContractVersion:
      "v2-a11-ads-2",

    planFingerprintAlgorithm:
      args
        ._plan_fingerprint_algorithm,

    planFingerprint:
      args
        ._plan_fingerprint,

    evaluationTimestamp:
      args
        ._evaluation_timestamp,

    counts: {
      expected:
        structuredClone(
          args
            ._expected_counts,
        ),

      actual: {
        storesCreated:
          0,

        storesUpdatedExisting:
          1,

        storesNoopExisting:
          0,

        offersCreated:
          0,

        offersUpdatedExisting:
          1,

        offersNoopExisting:
          0,

        ledgerRows:
          2,
      },
    },

    createdStores:
      [],

    createdOffers:
      [],

    noops: {
      stores:
        0,

      offers:
        0,
    },

    ledger: [
      {
        instructionOrdinal:
          0,

        entityKind:
          "store",

        plannedAction:
          "update_existing",

        outcome:
          "updated_existing",

        provider:
          "impact",

        providerEntityNamespace:
          "campaign",

        providerEntityId:
          store
            .providerEntityId,

        entityId:
          store
            .expectedExistingStoreId,

        expectedEntityId:
          store
            .expectedExistingStoreId,

        parentProviderEntityNamespace:
          null,

        parentProviderEntityId:
          null,

        parentEntityId:
          null,

        offerKind:
          null,
      },

      {
        instructionOrdinal:
          1,

        entityKind:
          "offer",

        plannedAction:
          "update_existing",

        outcome:
          "updated_existing",

        provider:
          "impact",

        providerEntityNamespace:
          "ad",

        providerEntityId:
          offer
            .providerEntityId,

        entityId:
          offer
            .existingOfferId,

        expectedEntityId:
          offer
            .existingOfferId,

        parentProviderEntityNamespace:
          "campaign",

        parentProviderEntityId:
          offer
            .parentProviderEntityId,

        parentEntityId:
          offer
            .expectedParentStoreId,

        offerKind:
          "coupon",
      },
    ],
  };
}

test(
  "accepts exact committed Ads-2 UPDATE evidence and returns an immutable result",
  async () => {
    const prepared =
      await preparedUpdate();

    const parsed =
      parseAdsRefreshPersistenceSuccessV2(
        validSuccess(
          prepared,
        ),
        prepared,
      );

    assert.ok(
      parsed,
    );

    assert.equal(
      parsed.status,
      "committed",
    );

    assert.equal(
      parsed
        .persistenceContractVersion,
      "v2-a11-ads-2",
    );

    assert.equal(
      parsed
        .counts
        .actual
        .storesUpdatedExisting,
      1,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .offersUpdatedExisting,
      1,
    );

    assert.equal(
      parsed.ledger.length,
      2,
    );

    assert.equal(
      parsed
        .ledger[0]
        ?.outcome,
      "updated_existing",
    );

    assert.equal(
      parsed
        .ledger[1]
        ?.outcome,
      "updated_existing",
    );

    assert.equal(
      Object.isFrozen(
        parsed,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        parsed.counts,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        parsed.ledger,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        parsed.ledger[0],
      ),
      true,
    );
  },
);

test(
  "accepts replayed_existing only when the evidence still exactly binds to the prepared plan",
  async () => {
    const prepared =
      await preparedUpdate();

    const parsed =
      parseAdsRefreshPersistenceSuccessV2(
        validSuccess(
          prepared,
          "replayed_existing",
        ),
        prepared,
      );

    assert.ok(
      parsed,
    );

    assert.equal(
      parsed.status,
      "replayed_existing",
    );

    assert.equal(
      parsed
        .counts
        .actual
        .storesUpdatedExisting,
      1,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .offersUpdatedExisting,
      1,
    );
  },
);

test(
  "accepts an equivalent explicit timezone representation of the evaluation instant",
  async () => {
    const prepared =
      await preparedUpdate();

    const value =
      validSuccess(
        prepared,
      );

    value.evaluationTimestamp =
      "2026-09-16T05:30:00+05:30";

    const parsed =
      parseAdsRefreshPersistenceSuccessV2(
        value,
        prepared,
      );

    assert.ok(
      parsed,
    );

    assert.equal(
      Date.parse(
        parsed
          .evaluationTimestamp,
      ),
      Date.parse(
        EVALUATION,
      ),
    );
  },
);

test(
  "rejects date-only and timezone-less success timestamps",
  async () => {
    const prepared =
      await preparedUpdate();

    const dateOnly =
      validSuccess(
        prepared,
      );

    dateOnly.evaluationTimestamp =
      "2026-09-16";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        dateOnly,
        prepared,
      ),
      null,
    );

    const noTimezone =
      validSuccess(
        prepared,
      );

    noTimezone.evaluationTimestamp =
      "2026-09-16T00:00:00";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        noTimezone,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects an UPDATE ledger entry reported as noop or created",
  async () => {
    const prepared =
      await preparedUpdate();

    const noop =
      validSuccess(
        prepared,
      );

    noop.ledger[0]!.outcome =
      "noop_existing";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        noop,
        prepared,
      ),
      null,
    );

    const created =
      validSuccess(
        prepared,
      );

    created.ledger[1]!.outcome =
      "created";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        created,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects stale or substituted expected entity IDs",
  async () => {
    const prepared =
      await preparedUpdate();

    const stale =
      validSuccess(
        prepared,
      );

    stale
      .ledger[0]!
      .expectedEntityId =
        OTHER_ID;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        stale,
        prepared,
      ),
      null,
    );

    const substituted =
      validSuccess(
        prepared,
      );

    substituted
      .ledger[1]!
      .entityId =
        OTHER_ID;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        substituted,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects offer parent movement even when the rest of the UPDATE evidence is valid",
  async () => {
    const prepared =
      await preparedUpdate();

    const moved =
      validSuccess(
        prepared,
      );

    moved
      .ledger[1]!
      .parentEntityId =
        OTHER_ID;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        moved,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects actual UPDATE count drift from the mutation ledger",
  async () => {
    const prepared =
      await preparedUpdate();

    const drift =
      validSuccess(
        prepared,
      );

    drift
      .counts
      .actual
      .storesUpdatedExisting =
        0;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        drift,
        prepared,
      ),
      null,
    );

    const rows =
      validSuccess(
        prepared,
      );

    rows
      .counts
      .actual
      .ledgerRows =
        1;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        rows,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects a coherent but forged expected-count object that differs from the prepared capability",
  async () => {
    const prepared =
      await preparedUpdate();

    const forged =
      validSuccess(
        prepared,
      );

    forged
      .counts
      .expected
      .stores
      .updateExisting =
        0;

    forged
      .counts
      .expected
      .writableStores =
        0;

    forged
      .counts
      .expected
      .writableEntities =
        1;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        forged,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects ledger reordering instead of trusting supplied ordinals",
  async () => {
    const prepared =
      await preparedUpdate();

    const reordered =
      validSuccess(
        prepared,
      );

    reordered.ledger.reverse();

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        reordered,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects duplicate DB entity evidence across store and offer ledger rows",
  async () => {
    const prepared =
      await preparedUpdate();

    const duplicate =
      validSuccess(
        prepared,
      );

    duplicate
      .ledger[1]!
      .entityId =
        STORE_ID;

    duplicate
      .ledger[1]!
      .expectedEntityId =
        STORE_ID;

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        duplicate,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects fingerprint and contract-version substitution",
  async () => {
    const prepared =
      await preparedUpdate();

    const fingerprint =
      validSuccess(
        prepared,
      );

    fingerprint.planFingerprint =
      "0".repeat(
        64,
      );

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        fingerprint,
        prepared,
      ),
      null,
    );

    const contract =
      validSuccess(
        prepared,
      );

    contract.persistenceContractVersion =
      "v2-a11-ads-1";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        contract,
        prepared,
      ),
      null,
    );
  },
);

test(
  "rejects extra root and ledger keys instead of widening the result contract",
  async () => {
    const prepared =
      await preparedUpdate();

    const root = {
      ...validSuccess(
        prepared,
      ),

      extraRoot:
        "forbidden",
    };

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        root,
        prepared,
      ),
      null,
    );

    const ledger =
      validSuccess(
        prepared,
      );

    (
      ledger
        .ledger[0] as
          unknown as
          Record<string, unknown>
    ).extraLedger =
      "forbidden";

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        ledger,
        prepared,
      ),
      null,
    );
  },
);

const CREATED_STORE_ID =
  "77777777-7777-4777-8777-777777777777";

const CREATED_OFFER_ID =
  "88888888-8888-4888-8888-888888888888";

function noopMaterial():
  AdsRefreshCanonicalPersistencePlanMaterialV2 {
  return {
    persistenceContractVersion:
      ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,

    provider:
      "impact",

    integrationId:
      INTEGRATION_ID,

    evaluationTimestamp:
      EVALUATION,

    mode:
      "full",

    canaryAdId:
      null,

    status:
      "ready",

    blockers:
      [],

    preconditions:
      [],

    storeInstructions: [
      {
        action:
          "noop_existing",

        providerStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-A",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "campaign",

        providerEntityId:
          "Campaign-A",

        expectedExistingStoreId:
          STORE_ID,

        qualified:
          true,

        projection:
          null,
      },
    ],

    offerInstructions: [
      {
        action:
          "noop_existing",

        providerOfferKey: {
          provider:
            "impact",
          namespace:
            "ad",
          id:
            "Ad-A",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "ad",

        providerEntityId:
          "Ad-A",

        kind:
          "coupon",

        existingOfferId:
          OFFER_ID,

        parentProviderStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-A",
        },

        parentProviderEntityNamespace:
          "campaign",

        parentProviderEntityId:
          "Campaign-A",

        expectedParentStoreId:
          STORE_ID,

        projection:
          null,
      },
    ],

    counts: {
      stores: {
        create:
          0,

        updateExisting:
          0,

        noopExisting:
          1,

        blockedAmbiguous:
          0,

        noopUnmatched:
          0,
      },

      offers: {
        create:
          0,

        updateExisting:
          0,

        noopExisting:
          1,

        noopHeld:
          0,

        noopUnresolved:
          0,
      },

      writableStores:
        0,

      writableOffers:
        0,

      writableEntities:
        0,
    },
  };
}

function createMaterial():
  AdsRefreshCanonicalPersistencePlanMaterialV2 {
  return {
    persistenceContractVersion:
      ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,

    provider:
      "impact",

    integrationId:
      INTEGRATION_ID,

    evaluationTimestamp:
      EVALUATION,

    mode:
      "full",

    canaryAdId:
      null,

    status:
      "ready",

    blockers:
      [],

    preconditions:
      [],

    storeInstructions: [
      {
        action:
          "create",

        providerStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-C",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "campaign",

        providerEntityId:
          "Campaign-C",

        expectedExistingStoreId:
          null,

        qualified:
          true,

        projection: {
          name:
            "Campaign C",

          slugCandidate:
            "campaign-c",

          description:
            null,

          affiliateUrl:
            "https://track.example/campaign-c",

          destinationUrl:
            "https://example.com/campaign-c",

          country:
            null,

          shippingRegions:
            [],

          logoSourceUrl:
            null,

          metadata: {
            advertiserId:
              "Advertiser-C",

            campaignId:
              "Campaign-C",

            campaignName:
              "Campaign C",

            destinationUrl:
              "https://example.com/campaign-c",

            trackingUrl:
              "https://track.example/campaign-c",
          },

          importOrigin:
            "provider",

          lifecycleManaged:
            true,

          lifecycleHidden:
            false,

          lastQualificationResult:
            "qualified",

          lastQualifiedAt:
            EVALUATION,

          seoTitle:
            "Campaign C Coupons",

          seoDescription:
            "Campaign C coupon codes.",

          seoCanonicalUrl:
            "https://getyourcodes.com/campaign-c-coupons",
        },
      },
    ],

    offerInstructions: [
      {
        action:
          "create",

        providerOfferKey: {
          provider:
            "impact",
          namespace:
            "ad",
          id:
            "Ad-C",
        },

        provider:
          "impact",

        providerEntityNamespace:
          "ad",

        providerEntityId:
          "Ad-C",

        kind:
          "coupon",

        existingOfferId:
          null,

        parentProviderStoreKey: {
          provider:
            "impact",
          namespace:
            "campaign",
          id:
            "Campaign-C",
        },

        parentProviderEntityNamespace:
          "campaign",

        parentProviderEntityId:
          "Campaign-C",

        expectedParentStoreId:
          null,

        projection: {
          title:
            "Campaign C 20% Off",

          description:
            null,

          couponCode:
            "SAVE20",

          couponType:
            "code",

          affiliateUrl:
            "https://track.example/ad-c",

          landingPageUrl:
            "https://example.com/ad-c",

          startDate:
            "2026-01-01",

          expiryDate:
            "2026-12-31",

          status:
            "active",

          terms:
            "Provider terms",

          discountType:
            "percentage",

          discountValue:
            20,

          structuredTerms:
            null,

          metadata: {
            adId:
              "Ad-C",

            campaignId:
              "Campaign-C",

            advertiserId:
              "Advertiser-C",

            dealId:
              "Deal-C",

            campaignName:
              "Campaign C",

            adName:
              "Campaign C 20% Off",

            dealStartDate:
              "2026-01-01T00:00:00Z",

            dealEndDate:
              "2026-12-31T23:59:59Z",

            startDate:
              "2026-01-01",

            endDate:
              "2026-12-31",
          },

          seoTitle:
            "Campaign C 20% Off Coupon",

          seoDescription:
            "Campaign C 20% off coupon code.",

          seoCanonicalUrl:
            "https://getyourcodes.com/campaign-c-coupons/ad-c",
        },
      },
    ],

    counts: {
      stores: {
        create:
          1,

        updateExisting:
          0,

        noopExisting:
          0,

        blockedAmbiguous:
          0,

        noopUnmatched:
          0,
      },

      offers: {
        create:
          1,

        updateExisting:
          0,

        noopExisting:
          0,

        noopHeld:
          0,

        noopUnresolved:
          0,
      },

      writableStores:
        1,

      writableOffers:
        1,

      writableEntities:
        2,
    },
  };
}

test(
  "accepts exact NOOP_EXISTING evidence and reconciles no-op counts",
  async () => {
    const prepared =
      await prepareAdsRefreshPersistenceExecutionV2(
        finalize(
          noopMaterial(),
        ),
        USER_ID,
      );

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    const store =
      args._store_instructions[0]!;

    const offer =
      args._offer_instructions[0]!;

    assert.equal(
      store.action,
      "noop_existing",
    );

    assert.equal(
      offer.action,
      "noop_existing",
    );

    const value = {
      status:
        "committed",

      runId:
        RUN_ID,

      persistenceContractVersion:
        "v2-a11-ads-2",

      planFingerprintAlgorithm:
        args._plan_fingerprint_algorithm,

      planFingerprint:
        args._plan_fingerprint,

      evaluationTimestamp:
        args._evaluation_timestamp,

      counts: {
        expected:
          structuredClone(
            args._expected_counts,
          ),

        actual: {
          storesCreated:
            0,

          storesUpdatedExisting:
            0,

          storesNoopExisting:
            1,

          offersCreated:
            0,

          offersUpdatedExisting:
            0,

          offersNoopExisting:
            1,

          ledgerRows:
            2,
        },
      },

      createdStores:
        [],

      createdOffers:
        [],

      noops: {
        stores:
          1,

        offers:
          1,
      },

      ledger: [
        {
          instructionOrdinal:
            0,

          entityKind:
            "store",

          plannedAction:
            "noop_existing",

          outcome:
            "noop_existing",

          provider:
            "impact",

          providerEntityNamespace:
            "campaign",

          providerEntityId:
            "Campaign-A",

          entityId:
            STORE_ID,

          expectedEntityId:
            STORE_ID,

          parentProviderEntityNamespace:
            null,

          parentProviderEntityId:
            null,

          parentEntityId:
            null,

          offerKind:
            null,
        },

        {
          instructionOrdinal:
            1,

          entityKind:
            "offer",

          plannedAction:
            "noop_existing",

          outcome:
            "noop_existing",

          provider:
            "impact",

          providerEntityNamespace:
            "ad",

          providerEntityId:
            "Ad-A",

          entityId:
            OFFER_ID,

          expectedEntityId:
            OFFER_ID,

          parentProviderEntityNamespace:
            "campaign",

          parentProviderEntityId:
            "Campaign-A",

          parentEntityId:
            STORE_ID,

          offerKind:
            "coupon",
        },
      ],
    };

    const parsed =
      parseAdsRefreshPersistenceSuccessV2(
        value,
        prepared,
      );

    assert.ok(
      parsed,
    );

    assert.equal(
      parsed.noops.stores,
      1,
    );

    assert.equal(
      parsed.noops.offers,
      1,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .storesNoopExisting,
      1,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .offersNoopExisting,
      1,
    );
  },
);

test(
  "rejects NOOP count drift from otherwise valid evidence",
  async () => {
    const prepared =
      await prepareAdsRefreshPersistenceExecutionV2(
        finalize(
          noopMaterial(),
        ),
        USER_ID,
      );

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    const value = {
      status:
        "committed",

      runId:
        RUN_ID,

      persistenceContractVersion:
        "v2-a11-ads-2",

      planFingerprintAlgorithm:
        args._plan_fingerprint_algorithm,

      planFingerprint:
        args._plan_fingerprint,

      evaluationTimestamp:
        args._evaluation_timestamp,

      counts: {
        expected:
          structuredClone(
            args._expected_counts,
          ),

        actual: {
          storesCreated:
            0,

          storesUpdatedExisting:
            0,

          storesNoopExisting:
            1,

          offersCreated:
            0,

          offersUpdatedExisting:
            0,

          offersNoopExisting:
            1,

          ledgerRows:
            2,
        },
      },

      createdStores:
        [],

      createdOffers:
        [],

      noops: {
        stores:
          0,

        offers:
          1,
      },

      ledger: [
        {
          instructionOrdinal:
            0,

          entityKind:
            "store",

          plannedAction:
            "noop_existing",

          outcome:
            "noop_existing",

          provider:
            "impact",

          providerEntityNamespace:
            "campaign",

          providerEntityId:
            "Campaign-A",

          entityId:
            STORE_ID,

          expectedEntityId:
            STORE_ID,

          parentProviderEntityNamespace:
            null,

          parentProviderEntityId:
            null,

          parentEntityId:
            null,

          offerKind:
            null,
        },

        {
          instructionOrdinal:
            1,

          entityKind:
            "offer",

          plannedAction:
            "noop_existing",

          outcome:
            "noop_existing",

          provider:
            "impact",

          providerEntityNamespace:
            "ad",

          providerEntityId:
            "Ad-A",

          entityId:
            OFFER_ID,

          expectedEntityId:
            OFFER_ID,

          parentProviderEntityNamespace:
            "campaign",

          parentProviderEntityId:
            "Campaign-A",

          parentEntityId:
            STORE_ID,

          offerKind:
            "coupon",
        },
      ],
    };

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        value,
        prepared,
      ),
      null,
    );
  },
);

test(
  "accepts exact CREATE evidence and binds created entities to the mutation ledger",
  async () => {
    const prepared =
      await prepareAdsRefreshPersistenceExecutionV2(
        finalize(
          createMaterial(),
        ),
        USER_ID,
      );

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    assert.equal(
      args
        ._store_instructions[0]
        ?.action,
      "create",
    );

    assert.equal(
      args
        ._offer_instructions[0]
        ?.action,
      "create",
    );

    const value = {
      status:
        "committed",

      runId:
        RUN_ID,

      persistenceContractVersion:
        "v2-a11-ads-2",

      planFingerprintAlgorithm:
        args._plan_fingerprint_algorithm,

      planFingerprint:
        args._plan_fingerprint,

      evaluationTimestamp:
        args._evaluation_timestamp,

      counts: {
        expected:
          structuredClone(
            args._expected_counts,
          ),

        actual: {
          storesCreated:
            1,

          storesUpdatedExisting:
            0,

          storesNoopExisting:
            0,

          offersCreated:
            1,

          offersUpdatedExisting:
            0,

          offersNoopExisting:
            0,

          ledgerRows:
            2,
        },
      },

      createdStores: [
        {
          entityId:
            CREATED_STORE_ID,

          providerEntityId:
            "Campaign-C",
        },
      ],

      createdOffers: [
        {
          entityId:
            CREATED_OFFER_ID,

          providerEntityId:
            "Ad-C",
        },
      ],

      noops: {
        stores:
          0,

        offers:
          0,
      },

      ledger: [
        {
          instructionOrdinal:
            0,

          entityKind:
            "store",

          plannedAction:
            "create",

          outcome:
            "created",

          provider:
            "impact",

          providerEntityNamespace:
            "campaign",

          providerEntityId:
            "Campaign-C",

          entityId:
            CREATED_STORE_ID,

          expectedEntityId:
            null,

          parentProviderEntityNamespace:
            null,

          parentProviderEntityId:
            null,

          parentEntityId:
            null,

          offerKind:
            null,
        },

        {
          instructionOrdinal:
            1,

          entityKind:
            "offer",

          plannedAction:
            "create",

          outcome:
            "created",

          provider:
            "impact",

          providerEntityNamespace:
            "ad",

          providerEntityId:
            "Ad-C",

          entityId:
            CREATED_OFFER_ID,

          expectedEntityId:
            null,

          parentProviderEntityNamespace:
            "campaign",

          parentProviderEntityId:
            "Campaign-C",

          parentEntityId:
            CREATED_STORE_ID,

          offerKind:
            "coupon",
        },
      ],
    };

    const parsed =
      parseAdsRefreshPersistenceSuccessV2(
        value,
        prepared,
      );

    assert.ok(
      parsed,
    );

    assert.deepEqual(
      parsed.createdStores,
      value.createdStores,
    );

    assert.deepEqual(
      parsed.createdOffers,
      value.createdOffers,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .storesCreated,
      1,
    );

    assert.equal(
      parsed
        .counts
        .actual
        .offersCreated,
      1,
    );
  },
);

test(
  "rejects forged created-entity evidence even when aggregate counts match",
  async () => {
    const prepared =
      await prepareAdsRefreshPersistenceExecutionV2(
        finalize(
          createMaterial(),
        ),
        USER_ID,
      );

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    const value = {
      status:
        "committed",

      runId:
        RUN_ID,

      persistenceContractVersion:
        "v2-a11-ads-2",

      planFingerprintAlgorithm:
        args._plan_fingerprint_algorithm,

      planFingerprint:
        args._plan_fingerprint,

      evaluationTimestamp:
        args._evaluation_timestamp,

      counts: {
        expected:
          structuredClone(
            args._expected_counts,
          ),

        actual: {
          storesCreated:
            1,

          storesUpdatedExisting:
            0,

          storesNoopExisting:
            0,

          offersCreated:
            1,

          offersUpdatedExisting:
            0,

          offersNoopExisting:
            0,

          ledgerRows:
            2,
        },
      },

      createdStores: [
        {
          entityId:
            OTHER_ID,

          providerEntityId:
            "Campaign-C",
        },
      ],

      createdOffers: [
        {
          entityId:
            CREATED_OFFER_ID,

          providerEntityId:
            "Ad-C",
        },
      ],

      noops: {
        stores:
          0,

        offers:
          0,
      },

      ledger: [
        {
          instructionOrdinal:
            0,

          entityKind:
            "store",

          plannedAction:
            "create",

          outcome:
            "created",

          provider:
            "impact",

          providerEntityNamespace:
            "campaign",

          providerEntityId:
            "Campaign-C",

          entityId:
            CREATED_STORE_ID,

          expectedEntityId:
            null,

          parentProviderEntityNamespace:
            null,

          parentProviderEntityId:
            null,

          parentEntityId:
            null,

          offerKind:
            null,
        },

        {
          instructionOrdinal:
            1,

          entityKind:
            "offer",

          plannedAction:
            "create",

          outcome:
            "created",

          provider:
            "impact",

          providerEntityNamespace:
            "ad",

          providerEntityId:
            "Ad-C",

          entityId:
            CREATED_OFFER_ID,

          expectedEntityId:
            null,

          parentProviderEntityNamespace:
            "campaign",

          parentProviderEntityId:
            "Campaign-C",

          parentEntityId:
            CREATED_STORE_ID,

          offerKind:
            "coupon",
        },
      ],
    };

    assert.equal(
      parseAdsRefreshPersistenceSuccessV2(
        value,
        prepared,
      ),
      null,
    );
  },
);
