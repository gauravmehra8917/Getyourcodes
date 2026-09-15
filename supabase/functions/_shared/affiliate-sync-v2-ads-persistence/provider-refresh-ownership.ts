import type {
  AdsCatalogStoreFactV2,
} from "./ads-persistence-models.ts";

export type AdsProviderRefreshOwnershipBlockReasonV2 =
  | "missing_ownership_evidence"
  | "ownership_not_provider_managed";

export type AdsProviderRefreshOwnershipDecisionV2 =
  | {
    action: "eligible";
    reason: null;
  }
  | {
    action: "blocked";
    reason: AdsProviderRefreshOwnershipBlockReasonV2;
  };

/**
 * Determines only whether an already-exact Campaign store is provider-owned
 * strongly enough to participate in provider-managed refresh.
 *
 * Exact provider identity / parent matching remains the caller's separate
 * responsibility.
 *
 * Missing evidence fails closed.
 */
export function classifyProviderManagedStoreOwnershipV2(
  store: Pick<
    AdsCatalogStoreFactV2,
    "importOrigin" | "lifecycleManaged"
  >,
): AdsProviderRefreshOwnershipDecisionV2 {
  if (
    store.importOrigin === undefined ||
    store.lifecycleManaged === undefined
  ) {
    return {
      action: "blocked",
      reason: "missing_ownership_evidence",
    };
  }

  if (
    store.importOrigin === "provider" &&
    store.lifecycleManaged === true
  ) {
    return {
      action: "eligible",
      reason: null,
    };
  }

  return {
    action: "blocked",
    reason: "ownership_not_provider_managed",
  };
}
