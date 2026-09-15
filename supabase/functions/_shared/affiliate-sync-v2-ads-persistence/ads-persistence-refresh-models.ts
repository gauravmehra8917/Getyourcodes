import type {
  ProviderAdOfferKey,
  ProviderStoreKey,
} from "../affiliate-sync-v2-ads/index.ts";

import type {
  AdsBlockedOfferInstructionV2,
  AdsBlockedStoreInstructionV2,
  AdsCreateOfferInstructionV2,
  AdsCreateStoreInstructionV2,
  AdsHeldOfferInstructionV2,
  AdsNoopOfferInstructionV2,
  AdsNoopStoreInstructionV2,
  AdsPersistenceBlockerReasonV2,
  AdsPersistenceBlockerV2,
  AdsPersistenceModeV2,
  AdsPersistencePreconditionV2,
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "./ads-persistence-models.ts";

/**
 * Additive provider-refresh persistence contract.
 *
 * v2-a11-ads-1 remains unchanged and continues to define historical
 * CREATE / NOOP execution.
 *
 * This contract is intentionally not exported through the active shared
 * index and is not accepted by the current execution adapter or SQL RPC.
 */
export const ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2 =
  "v2-a11-ads-2" as const;

/**
 * Desired Campaign state is stricter than historical/current snapshot state.
 *
 * Current historical rows may legitimately have a null duplicated campaignId
 * in metadata, but a newly planned provider refresh must carry the exact
 * Campaign identity and Campaign name that produced the desired state.
 */
export interface AdsProviderManagedStoreDesiredStateV2 {
  affiliateUrl: string | null;
  metadata: {
    advertiserId: string | null;
    campaignId: string;
    campaignName: string;
    destinationUrl: string | null;
    trackingUrl: string | null;
  };
}

/**
 * Desired Ad state is likewise stricter than the historical/current snapshot.
 *
 * Exact provider identity remains carried independently by providerEntityId,
 * but desired duplicated metadata evidence must also contain the exact Ad and
 * Campaign IDs and normalized provider names.
 */
export interface AdsProviderManagedOfferDesiredStateV2 {
  couponCode: string;
  affiliateUrl: string | null;
  landingPageUrl: string | null;
  startDate: string | null;
  expiryDate: string | null;
  status: "active" | "expired" | "draft";
  terms: string | null;
  discountType: "percentage" | "fixed" | null;
  discountValue: number | null;
  structuredTerms: AdsProviderManagedOfferStateV2["structuredTerms"];
  metadata: {
    adId: string;
    campaignId: string;
    advertiserId: string | null;
    dealId: string | null;
    campaignName: string;
    adName: string;
    dealStartDate: string | null;
    dealEndDate: string | null;
    startDate: string | null;
    endDate: string | null;
  };
}

/**
 * Optimistic-concurrency Campaign update.
 *
 * No create projection is accepted here. Therefore presentation, SEO,
 * descriptions, slugs, logos, lifecycle presentation and other curated
 * columns cannot enter an UPDATE instruction through this contract.
 */
export interface AdsUpdateStoreInstructionV2 {
  action: "update_existing";

  providerStoreKey: ProviderStoreKey;

  provider: "impact";

  providerEntityNamespace: "campaign";

  providerEntityId: string;

  expectedExistingStoreId: string;

  qualified: true;

  /**
   * Exact bounded state observed during planning.
   * The later transaction must re-read and compare this before updating.
   */
  expectedCurrentManagedState: AdsProviderManagedStoreStateV2;

  /**
   * Only provider-owned fields that may be written.
   */
  desiredManagedState: AdsProviderManagedStoreDesiredStateV2;
}

export type AdsRefreshPersistenceStoreInstructionV2 =
  | AdsCreateStoreInstructionV2
  | AdsNoopStoreInstructionV2
  | AdsUpdateStoreInstructionV2
  | AdsBlockedStoreInstructionV2;

/**
 * Optimistic-concurrency Ad update.
 *
 * Parent identity and parent database ID are immutable expectations.
 * This instruction cannot request parent movement.
 */
export interface AdsUpdateOfferInstructionV2 {
  action: "update_existing";

  providerOfferKey: ProviderAdOfferKey;

  provider: "impact";

  providerEntityNamespace: "ad";

  providerEntityId: string;

  kind: "coupon";

  existingOfferId: string;

  parentProviderStoreKey: ProviderStoreKey;

  parentProviderEntityNamespace: "campaign";

  parentProviderEntityId: string;

  expectedParentStoreId: string;

  /**
   * Exact bounded provider-managed state observed during planning.
   */
  expectedCurrentManagedState: AdsProviderManagedOfferStateV2;

  /**
   * Only provider-owned fields that may be written.
   */
  desiredManagedState: AdsProviderManagedOfferDesiredStateV2;
}

export type AdsRefreshPersistenceOfferInstructionV2 =
  | AdsCreateOfferInstructionV2
  | AdsNoopOfferInstructionV2
  | AdsUpdateOfferInstructionV2
  | AdsHeldOfferInstructionV2
  | AdsBlockedOfferInstructionV2;

/**
 * Additive counts contract.
 *
 * UPDATE is explicitly writable in ads-2; the old ads-1 count type remains
 * untouched.
 */
export interface AdsRefreshPersistencePlanCountsV2 {
  stores: {
    create: number;
    updateExisting: number;
    noopExisting: number;
    blockedAmbiguous: number;
    noopUnmatched: number;
  };

  offers: {
    create: number;
    updateExisting: number;
    noopExisting: number;
    noopHeld: number;
    noopUnresolved: number;
  };

  writableStores: number;

  writableOffers: number;

  writableEntities: number;
}

/**
 * Provider-refresh-specific entity blocker reasons.
 *
 * These reasons are intentionally additive and never widen the settled
 * v2-a11-ads-1 blocker contract.
 */
export type AdsRefreshPersistenceEntityBlockReasonV2 =
  | "missing_snapshot"
  | "invalid_projection"
  | "missing_coupon_code"
  | "unresolved_store"
  | "identity_conflict"
  | "missing_title"
  | "invalid_date"
  | "invalid_date_range"
  | "qualification_inconsistent";

/**
 * Ads-2 canonical blocker evidence.
 *
 * Legacy ads-1 blockers are retained as-is. Refresh-only blocker evidence
 * receives an explicit source/scope discriminator so it cannot be mistaken
 * for settled ads-1 blocker material.
 */
export type AdsRefreshPersistenceBlockerV2 =
  | AdsPersistenceBlockerV2
  | {
    source: "provider_refresh";
    scope: "plan";
    reason: AdsPersistenceBlockerReasonV2;
    providerEntityNamespace: null;
    providerEntityId: null;
  }
  | {
    source: "provider_refresh";
    scope: "store";
    reason: "missing_snapshot" | "invalid_projection";
    providerEntityNamespace: "campaign";
    providerEntityId: string;
  }
  | {
    source: "provider_refresh";
    scope: "offer";
    reason: AdsRefreshPersistenceEntityBlockReasonV2;
    providerEntityNamespace: "ad";
    providerEntityId: string;
  };

/**
 * Canonical ads-2 plan material.
 *
 * This is only a model in D1. No active planner, handler, executor or RPC
 * currently produces or accepts it.
 */
export interface AdsRefreshCanonicalPersistencePlanMaterialV2 {
  persistenceContractVersion:
    typeof ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2;

  provider: "impact";

  integrationId: string;

  evaluationTimestamp: string;

  mode: AdsPersistenceModeV2;

  canaryAdId: string | null;

  status: "ready" | "blocked";

  blockers: AdsRefreshPersistenceBlockerV2[];

  preconditions: AdsPersistencePreconditionV2[];

  storeInstructions: AdsRefreshPersistenceStoreInstructionV2[];

  offerInstructions: AdsRefreshPersistenceOfferInstructionV2[];

  counts: AdsRefreshPersistencePlanCountsV2;
}

export interface AdsRefreshPersistencePlanV2
  extends AdsRefreshCanonicalPersistencePlanMaterialV2 {
  canonicalPlanMaterial: AdsRefreshCanonicalPersistencePlanMaterialV2;

  canonicalPlanMaterialString: string;
}
