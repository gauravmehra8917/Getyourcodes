import assert from "node:assert/strict";
import test from "node:test";
import {
  mapExistingAdsCatalogSnapshotV2,
  resolveAdsShadowPolicyConfigV2,
} from "../catalog-snapshot.ts";

test("catalog mapping preserves exact Campaign identities and duplicate ambiguity evidence", () => {
  const snapshot = mapExistingAdsCatalogSnapshotV2([
    { id: "store-a", providerEntityId: "Campaign-A" },
    { id: "store-b", providerEntityId: "Campaign-A" },
    { id: "store-c", providerEntityId: "campaign-a" },
  ]);
  assert.deepEqual(snapshot, {
    stores: [
      {
        id: "store-a",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "Campaign-A",
        },
      },
      {
        id: "store-b",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "Campaign-A",
        },
      },
      {
        id: "store-c",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "campaign-a",
        },
      },
    ],
  });
});

test("catalog mapping fails closed instead of trimming or dropping malformed rows", () => {
  for (
    const row of [
      { id: " store-a", providerEntityId: "campaign-a" },
      { id: "store-a", providerEntityId: " campaign-a" },
      { id: "store-a", providerEntityId: "" },
      { id: null, providerEntityId: "campaign-a" },
    ]
  ) {
    assert.throws(() => mapExistingAdsCatalogSnapshotV2([row]));
  }
});

test("enabled policy reports production dimensions but keeps Ads selection uncapped", () => {
  assert.deepEqual(
    resolveAdsShadowPolicyConfigV2({
      enabled: true,
      minimumCouponsPerStore: 0,
      maximumCouponsPerStore: 20,
      minimumDealsPerStore: 0,
      maximumDealsPerStore: 18,
    }),
    {
      sourceNeutralMaxSelectedAdsPerStore: 0,
      maximumCouponsPerStore: 20,
      maximumDealsPerStore: 18,
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 0,
    },
  );
});

test("disabled or absent policy settles to zero without an implicit minimum", () => {
  assert.deepEqual(resolveAdsShadowPolicyConfigV2(null), {
    sourceNeutralMaxSelectedAdsPerStore: 0,
    maximumCouponsPerStore: 0,
    maximumDealsPerStore: 0,
    minimumSelectedCoupons: 0,
    minimumSelectedDeals: 0,
    minimumTotalSelectedOffers: 0,
  });
  assert.deepEqual(
    resolveAdsShadowPolicyConfigV2({
      enabled: false,
      minimumCouponsPerStore: 7,
      maximumCouponsPerStore: 20,
      minimumDealsPerStore: 9,
      maximumDealsPerStore: 18,
    }),
    resolveAdsShadowPolicyConfigV2(null),
  );
});

test("policy mapping rejects malformed or negative stored values", () => {
  const valid = {
    enabled: true,
    minimumCouponsPerStore: 0,
    maximumCouponsPerStore: 20,
    minimumDealsPerStore: 0,
    maximumDealsPerStore: 18,
  };
  assert.throws(() =>
    resolveAdsShadowPolicyConfigV2({ ...valid, enabled: "true" })
  );
  for (
    const key of [
      "minimumCouponsPerStore",
      "maximumCouponsPerStore",
      "minimumDealsPerStore",
      "maximumDealsPerStore",
    ] as const
  ) {
    assert.throws(() =>
      resolveAdsShadowPolicyConfigV2({ ...valid, [key]: -1 })
    );
    assert.throws(() =>
      resolveAdsShadowPolicyConfigV2({ ...valid, [key]: 1.5 })
    );
  }
});
