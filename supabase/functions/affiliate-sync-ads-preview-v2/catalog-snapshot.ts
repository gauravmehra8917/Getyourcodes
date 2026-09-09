import type {
  AdsShadowPolicyConfigV2,
  ExistingAdsCatalogSnapshotV2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import type {
  AdsCatalogStoreIdentityRowV2,
  StoredAdsPublishingPolicyRowV2,
} from "./types.ts";

function exactNonemptyText(value: unknown, errorCode: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.trim() !== value
  ) throw new Error(errorCode);
  return value;
}

function nonnegativeInteger(value: unknown, errorCode: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(errorCode);
  }
  return value as number;
}

/**
 * Maps only exact persisted Impact Campaign identities. Duplicate keys remain in
 * the snapshot so the planner can report ambiguity instead of adopting a row.
 */
export function mapExistingAdsCatalogSnapshotV2(
  rows: readonly AdsCatalogStoreIdentityRowV2[],
): ExistingAdsCatalogSnapshotV2 {
  return {
    stores: rows.map((row) => ({
      id: exactNonemptyText(row.id, "catalog_store_id_invalid"),
      providerStoreKey: {
        provider: "impact" as const,
        namespace: "campaign" as const,
        id: exactNonemptyText(
          row.providerEntityNamespace === "campaign"
            ? row.providerEntityId
            : null,
          "catalog_store_provider_entity_id_invalid",
        ),
      },
    })),
  };
}

/** A11-S3 has no final coupon/deal classification and therefore applies no cap. */
export function resolveAdsShadowPolicyConfigV2(
  row: StoredAdsPublishingPolicyRowV2 | null,
): AdsShadowPolicyConfigV2 {
  if (row === null) {
    return {
      sourceNeutralMaxSelectedAdsPerStore: 0,
      maximumCouponsPerStore: 0,
      maximumDealsPerStore: 0,
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 0,
    };
  }
  if (typeof row.enabled !== "boolean") {
    throw new Error("publishing_policy_enabled_invalid");
  }
  const values = {
    maximumCouponsPerStore: nonnegativeInteger(
      row.maximumCouponsPerStore,
      "publishing_policy_maximum_coupons_invalid",
    ),
    maximumDealsPerStore: nonnegativeInteger(
      row.maximumDealsPerStore,
      "publishing_policy_maximum_deals_invalid",
    ),
    minimumSelectedCoupons: nonnegativeInteger(
      row.minimumCouponsPerStore,
      "publishing_policy_minimum_coupons_invalid",
    ),
    minimumSelectedDeals: nonnegativeInteger(
      row.minimumDealsPerStore,
      "publishing_policy_minimum_deals_invalid",
    ),
  };

  if (!row.enabled) {
    return {
      sourceNeutralMaxSelectedAdsPerStore: 0,
      maximumCouponsPerStore: 0,
      maximumDealsPerStore: 0,
      minimumSelectedCoupons: 0,
      minimumSelectedDeals: 0,
      minimumTotalSelectedOffers: 0,
    };
  }
  return {
    sourceNeutralMaxSelectedAdsPerStore: 0,
    ...values,
    // The persisted policy schema has no independent total-minimum column.
    minimumTotalSelectedOffers: 0,
  };
}
