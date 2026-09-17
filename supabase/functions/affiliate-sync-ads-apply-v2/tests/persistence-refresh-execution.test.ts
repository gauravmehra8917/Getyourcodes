import assert from "node:assert/strict";
import test from "node:test";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsRefreshCanonicalPersistencePlanMaterialV2,
  type AdsRefreshPersistencePlanV2,
} from "../../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-models.ts";

import {
  ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2,
  adsRefreshPersistenceRpcArgsV2,
  prepareAdsRefreshPersistenceExecutionV2,
} from "../persistence-refresh-execution.ts";

const INTEGRATION_ID =
  "11111111-1111-4111-8111-111111111111";

const MUTATED_INTEGRATION_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const USER_ID =
  "22222222-2222-4222-8222-222222222222";

const STORE_ID =
  "33333333-3333-4333-8333-333333333333";

const OFFER_ID =
  "44444444-4444-4444-8444-444444444444";

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

    canonicalPlanMaterialString:
      JSON.stringify(
        canonical,
      ),
  };
}

async function sha256Hex(
  value: string,
): Promise<string> {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        value,
      ),
    );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte.toString(16)
        .padStart(2, "0"),
  ).join("");
}

test(
  "prepares a closed deterministic Ads-2 UPDATE RPC capability",
  async () => {
    const plan =
      finalize(
        updateMaterial(),
      );

    const one =
      await prepareAdsRefreshPersistenceExecutionV2(
        plan,
        USER_ID,
      );

    const two =
      await prepareAdsRefreshPersistenceExecutionV2(
        plan,
        USER_ID,
      );

    const oneArgs =
      adsRefreshPersistenceRpcArgsV2(
        one,
      );

    const twoArgs =
      adsRefreshPersistenceRpcArgsV2(
        two,
      );

    assert.deepEqual(
      Object.keys(
        oneArgs,
      ).sort(),
      [
        "_integration_id",
        "_provider",
        "_persistence_contract_version",
        "_plan_fingerprint_algorithm",
        "_plan_fingerprint",
        "_evaluation_timestamp",
        "_triggered_by",
        "_expected_counts",
        "_store_instructions",
        "_offer_instructions",
      ].sort(),
    );

    assert.equal(
      oneArgs
        ._persistence_contract_version,
      "v2-a11-ads-2",
    );

    assert.equal(
      oneArgs
        ._plan_fingerprint_algorithm,
      ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2,
    );

    assert.equal(
      oneArgs
        ._plan_fingerprint,
      twoArgs
        ._plan_fingerprint,
    );

    assert.equal(
      oneArgs
        ._plan_fingerprint,
      await sha256Hex(
        plan
          .canonicalPlanMaterialString,
      ),
    );

    assert.deepEqual(
      oneArgs
        ._expected_counts,
      plan.counts,
    );

    assert.equal(
      oneArgs
        ._store_instructions
        .length,
      1,
    );

    assert.equal(
      oneArgs
        ._offer_instructions
        .length,
      1,
    );

    const store =
      oneArgs
        ._store_instructions[0]!;

    const offer =
      oneArgs
        ._offer_instructions[0]!;

    assert.equal(
      store
        .instructionOrdinal,
      0,
    );

    assert.equal(
      offer
        .instructionOrdinal,
      1,
    );

    assert.equal(
      store.action,
      "update_existing",
    );

    assert.equal(
      offer.action,
      "update_existing",
    );

    if (
      store.action !==
        "update_existing" ||
      offer.action !==
        "update_existing"
    ) {
      throw new Error(
        "unexpected_fixture_action",
      );
    }

    assert.equal(
      store
        .expectedExistingStoreId,
      STORE_ID,
    );

    assert.equal(
      offer
        .existingOfferId,
      OFFER_ID,
    );

    assert.equal(
      offer
        .expectedParentStoreId,
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
      "https://new.example/campaign",
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
      "NEW-CODE",
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
      "title" in
        offer
          .desiredManagedState,
      false,
    );

    assert.equal(
      "description" in
        offer
          .desiredManagedState,
      false,
    );

    assert.equal(
      "seoTitle" in
        offer
          .desiredManagedState,
      false,
    );
  },
);

test(
  "captures every RPC value before the SHA-256 await boundary",
  async () => {
    const plan =
      finalize(
        updateMaterial(),
      );

    const originalCanonical =
      plan
        .canonicalPlanMaterialString;

    const expectedFingerprint =
      await sha256Hex(
        originalCanonical,
      );

    /*
     * Calling an async function executes synchronously
     * until its first await. The preparer must therefore
     * capture its complete RPC snapshot before returning
     * this pending Promise to the caller.
     */
    const pending =
      prepareAdsRefreshPersistenceExecutionV2(
        plan,
        USER_ID,
      );

    const mutablePlan =
      plan as unknown as {
        integrationId:
          string;

        evaluationTimestamp:
          string;

        counts: {
          writableEntities:
            number;
        };

        storeInstructions:
          Array<{
            action:
              string;

            desiredManagedState?: {
              affiliateUrl?:
                string | null;
            };
          }>;

        offerInstructions:
          Array<{
            action:
              string;

            desiredManagedState?: {
              couponCode?:
                string;
            };
          }>;
      };

    mutablePlan.integrationId =
      MUTATED_INTEGRATION_ID;

    mutablePlan.evaluationTimestamp =
      "2026-09-17T12:34:56.000Z";

    mutablePlan
      .counts
      .writableEntities =
        999;

    mutablePlan
      .storeInstructions[0]!
      .desiredManagedState!
      .affiliateUrl =
        "https://tampered.example/store";

    mutablePlan
      .offerInstructions[0]!
      .desiredManagedState!
      .couponCode =
        "TAMPERED-CODE";

    const prepared =
      await pending;

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    assert.equal(
      args._integration_id,
      INTEGRATION_ID,
    );

    assert.equal(
      args._evaluation_timestamp,
      EVALUATION,
    );

    assert.equal(
      args
        ._expected_counts
        .writableEntities,
      2,
    );

    assert.equal(
      args
        ._plan_fingerprint,
      expectedFingerprint,
    );

    const store =
      args
        ._store_instructions[0]!;

    const offer =
      args
        ._offer_instructions[0]!;

    assert.equal(
      store.action,
      "update_existing",
    );

    assert.equal(
      offer.action,
      "update_existing",
    );

    if (
      store.action !==
        "update_existing" ||
      offer.action !==
        "update_existing"
    ) {
      throw new Error(
        "unexpected_fixture_action",
      );
    }

    assert.equal(
      store
        .desiredManagedState
        .affiliateUrl,
      "https://new.example/campaign",
    );

    assert.equal(
      offer
        .desiredManagedState
        .couponCode,
      "NEW-CODE",
    );
  },
);

test(
  "prepared RPC material is deeply immutable",
  async () => {
    const plan =
      finalize(
        updateMaterial(),
      );

    const prepared =
      await prepareAdsRefreshPersistenceExecutionV2(
        plan,
        USER_ID,
      );

    const args =
      adsRefreshPersistenceRpcArgsV2(
        prepared,
      );

    assert.equal(
      Object.isFrozen(
        args,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        args
          ._expected_counts,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        args
          ._store_instructions,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        args
          ._offer_instructions,
      ),
      true,
    );

    const store =
      args
        ._store_instructions[0]!;

    const offer =
      args
        ._offer_instructions[0]!;

    assert.equal(
      store.action,
      "update_existing",
    );

    assert.equal(
      offer.action,
      "update_existing",
    );

    if (
      store.action !==
        "update_existing" ||
      offer.action !==
        "update_existing"
    ) {
      throw new Error(
        "unexpected_fixture_action",
      );
    }

    assert.equal(
      Object.isFrozen(
        store
          .expectedCurrentManagedState,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        store
          .desiredManagedState,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        store
          .desiredManagedState
          .metadata,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        offer
          .expectedCurrentManagedState,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        offer
          .desiredManagedState,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        offer
          .desiredManagedState
          .metadata,
      ),
      true,
    );
  },
);

test(
  "blocked Ads-2 plans never become execution capabilities",
  async () => {
    const material =
      updateMaterial();

    material.status =
      "blocked";

    const plan =
      finalize(
        material,
      );

    await assert.rejects(
      () =>
        prepareAdsRefreshPersistenceExecutionV2(
          plan,
          USER_ID,
        ),
      /ads_refresh_execution_invalid_plan/,
    );
  },
);

test(
  "tampered canonical material fails closed",
  async () => {
    const plan =
      finalize(
        updateMaterial(),
      );

    const malformed = {
      ...plan,

      canonicalPlanMaterialString:
        "{}",
    };

    await assert.rejects(
      () =>
        prepareAdsRefreshPersistenceExecutionV2(
          malformed,
          USER_ID,
        ),
      /ads_refresh_execution_invalid_canonical_material/,
    );
  },
);

test(
  "extra root material cannot cross the RPC boundary",
  async () => {
    const plan =
      finalize(
        updateMaterial(),
      );

    const malformed = {
      ...plan,

      privatePayload:
        "must-not-cross-boundary",
    };

    await assert.rejects(
      () =>
        prepareAdsRefreshPersistenceExecutionV2(
          malformed,
          USER_ID,
        ),
      /ads_refresh_execution_invalid_plan_shape/,
    );
  },
);

test(
  "instruction counts must exactly match the Ads-2 count contract",
  async () => {
    const material =
      updateMaterial();

    material
      .counts
      .offers
      .updateExisting =
        0;

    material
      .counts
      .writableOffers =
        0;

    material
      .counts
      .writableEntities =
        1;

    const plan =
      finalize(
        material,
      );

    await assert.rejects(
      () =>
        prepareAdsRefreshPersistenceExecutionV2(
          plan,
          USER_ID,
        ),
      /ads_refresh_execution_count_mismatch/,
    );
  },
);

test(
  "offer parent Campaign must exist in the same exact plan",
  async () => {
    const material =
      updateMaterial();

    const offer =
      material
        .offerInstructions[0];

    assert.equal(
      offer?.action,
      "update_existing",
    );

    if (
      offer?.action !==
        "update_existing"
    ) {
      throw new Error(
        "unexpected_fixture_action",
      );
    }

    offer.parentProviderStoreKey = {
      provider:
        "impact",

      namespace:
        "campaign",

      id:
        "Campaign-B",
    };

    offer.parentProviderEntityId =
      "Campaign-B";

    const plan =
      finalize(
        material,
      );

    await assert.rejects(
      () =>
        prepareAdsRefreshPersistenceExecutionV2(
          plan,
          USER_ID,
        ),
      /ads_refresh_execution_parent_not_in_plan/,
    );
  },
);

test(
  "raw caller objects cannot masquerade as prepared capabilities",
  () => {
    assert.throws(
      () =>
        adsRefreshPersistenceRpcArgsV2(
          {} as never,
        ),
      /ads_refresh_execution_not_prepared/,
    );
  },
);
