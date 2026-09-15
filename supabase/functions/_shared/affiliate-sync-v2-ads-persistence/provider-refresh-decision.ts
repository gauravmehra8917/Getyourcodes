import type {
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "./ads-persistence-models.ts";

import {
  sameProviderManagedOfferStateV2,
  sameProviderManagedStoreStateV2,
} from "./provider-managed-state.ts";

export type AdsProviderRefreshDecisionV2 =
  | "noop_existing"
  | "update_existing"
  | "blocked_missing_snapshot";

export function decideProviderManagedStoreRefreshV2(
  current: AdsProviderManagedStoreStateV2 | null | undefined,
  desired: AdsProviderManagedStoreStateV2,
): AdsProviderRefreshDecisionV2 {
  if (current === null || current === undefined) {
    return "blocked_missing_snapshot";
  }

  return sameProviderManagedStoreStateV2(current, desired)
    ? "noop_existing"
    : "update_existing";
}

export function decideProviderManagedOfferRefreshV2(
  current: AdsProviderManagedOfferStateV2 | null | undefined,
  desired: AdsProviderManagedOfferStateV2,
): AdsProviderRefreshDecisionV2 {
  if (current === null || current === undefined) {
    return "blocked_missing_snapshot";
  }

  return sameProviderManagedOfferStateV2(current, desired)
    ? "noop_existing"
    : "update_existing";
}
