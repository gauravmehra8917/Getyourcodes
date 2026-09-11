import type {
  AdsIneligibilityReasonV2,
  ImpactAdStructuredTermsV2,
  ProviderAdOfferKey,
  ProviderStoreKey,
} from "../affiliate-sync-v2-ads/index.ts";

export const ADS_PERSISTENCE_CONTRACT_VERSION_V2 = "v2-a11-ads-1" as const;

export type AdsPersistenceModeV2 = "full" | "canary";

export interface AdsCatalogStoreFactV2 {
  storeId: string;
  slug: string;
  provider: string | null;
  providerEntityNamespace: string | null;
  providerEntityId: string | null;
}

export interface AdsCatalogOfferFactV2 {
  offerId: string;
  storeId: string;
  provider: "impact";
  providerEntityNamespace: "ad" | "legacy" | "promotion";
  providerEntityId: string;
  couponType: "code" | "deal";
}

/** Trusted, read-only catalog evidence. It contains no coupon content. */
export interface AdsCatalogPlanningContextV2 {
  stores: readonly AdsCatalogStoreFactV2[];
  offers: readonly AdsCatalogOfferFactV2[];
}

export type AdsPersistenceHoldReasonV2 =
  | AdsIneligibilityReasonV2
  | "missing_coupon_code"
  | "duplicate_identity_conflict"
  | "identity_conflict";

export type AdsPersistenceBlockerReasonV2 =
  | "invalid_context"
  | "campaign_fetch_incomplete"
  | "campaign_records_quarantined"
  | "ads_fetch_incomplete"
  | "identity_collapse_detected"
  | "canary_ad_not_found"
  | "canary_ad_conflicted"
  | "canary_ad_ineligible"
  | "duplicate_store_identity"
  | "duplicate_offer_identity"
  | "legacy_identity_collision"
  | "store_slug_collision"
  | "incompatible_parent"
  | "offer_kind_conflict"
  | "invalid_store_projection"
  | "invalid_offer_projection"
  | "instruction_count_mismatch";

/** Internal bounded blocker. Hosts expose reason counts, never these IDs. */
export interface AdsPersistenceBlockerV2 {
  reason: AdsPersistenceBlockerReasonV2;
  entity: "plan" | "store" | "offer";
  providerEntityNamespace: "campaign" | "ad" | null;
  providerEntityId: string | null;
}

export type AdsPersistencePreconditionCodeV2 =
  | "context_valid"
  | "campaign_fetch_complete"
  | "campaign_records_trustworthy"
  | "ads_fetch_complete"
  | "duplicate_conflicts_excluded"
  | "identity_not_collapsed"
  | "catalog_consistent"
  | "store_projections_valid"
  | "offer_projections_valid"
  | "instruction_counts_reconcile";

export interface AdsPersistencePreconditionV2 {
  code: AdsPersistencePreconditionCodeV2;
  satisfied: boolean;
}

export interface AdsStoreCreateProjectionV2 {
  name: string;
  slugCandidate: string;
  description: string | null;
  affiliateUrl: string | null;
  destinationUrl: string | null;
  country: string | null;
  shippingRegions: readonly string[];
  logoSourceUrl: string | null;
  metadata: {
    advertiserId: string | null;
    campaignId: string;
    campaignName: string;
    destinationUrl: string | null;
    trackingUrl: string | null;
  };
  importOrigin: "provider";
  lifecycleManaged: true;
  lifecycleHidden: false;
  lastQualificationResult: "qualified";
  lastQualifiedAt: string;
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
}

interface AdsStoreInstructionBaseV2 {
  providerStoreKey: ProviderStoreKey;
  provider: "impact";
  providerEntityNamespace: "campaign";
  providerEntityId: string;
}

export interface AdsCreateStoreInstructionV2 extends AdsStoreInstructionBaseV2 {
  action: "create";
  expectedExistingStoreId: null;
  qualified: true;
  projection: AdsStoreCreateProjectionV2;
}

export interface AdsNoopStoreInstructionV2 extends AdsStoreInstructionBaseV2 {
  action: "noop_existing";
  expectedExistingStoreId: string;
  qualified: true;
  projection: null;
}

export interface AdsBlockedStoreInstructionV2
  extends AdsStoreInstructionBaseV2 {
  action: "blocked";
  reason:
    | "duplicate_store_identity"
    | "legacy_identity_collision"
    | "store_slug_collision"
    | "invalid_store_projection";
  expectedExistingStoreId: null;
  qualified: false;
  projection: null;
}

export type AdsPersistenceStoreInstructionV2 =
  | AdsCreateStoreInstructionV2
  | AdsNoopStoreInstructionV2
  | AdsBlockedStoreInstructionV2;

export interface AdsOfferCreateProjectionV2 {
  title: string;
  description: string | null;
  couponCode: string;
  couponType: "code";
  affiliateUrl: string | null;
  landingPageUrl: string | null;
  startDate: string | null;
  expiryDate: string | null;
  status: "active" | "expired" | "draft";
  terms: string | null;
  discountType: "percentage" | "fixed" | null;
  discountValue: number | null;
  structuredTerms: ImpactAdStructuredTermsV2 | null;
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
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
}

interface AdsOfferInstructionBaseV2 {
  providerOfferKey: ProviderAdOfferKey;
  provider: "impact";
  providerEntityNamespace: "ad";
  providerEntityId: string;
  kind: "coupon";
}

export interface AdsCreateOfferInstructionV2 extends AdsOfferInstructionBaseV2 {
  action: "create";
  existingOfferId: null;
  parentProviderStoreKey: ProviderStoreKey;
  parentProviderEntityNamespace: "campaign";
  parentProviderEntityId: string;
  expectedParentStoreId: string | null;
  projection: AdsOfferCreateProjectionV2;
}

export interface AdsNoopOfferInstructionV2 extends AdsOfferInstructionBaseV2 {
  action: "noop_existing";
  existingOfferId: string;
  parentProviderStoreKey: ProviderStoreKey;
  parentProviderEntityNamespace: "campaign";
  parentProviderEntityId: string;
  expectedParentStoreId: string;
  projection: null;
}

export interface AdsHeldOfferInstructionV2 extends AdsOfferInstructionBaseV2 {
  action: "noop_held" | "noop_unresolved";
  existingOfferId: null;
  parentProviderStoreKey: ProviderStoreKey | null;
  parentProviderEntityNamespace: "campaign" | null;
  parentProviderEntityId: string | null;
  expectedParentStoreId: null;
  holdReason: AdsPersistenceHoldReasonV2;
  projection: null;
}

export interface AdsBlockedOfferInstructionV2
  extends AdsOfferInstructionBaseV2 {
  action: "blocked";
  existingOfferId: string | null;
  parentProviderStoreKey: ProviderStoreKey | null;
  parentProviderEntityNamespace: "campaign" | null;
  parentProviderEntityId: string | null;
  expectedParentStoreId: string | null;
  reason:
    | "duplicate_offer_identity"
    | "legacy_identity_collision"
    | "incompatible_parent"
    | "offer_kind_conflict"
    | "invalid_offer_projection";
  projection: null;
}

export type AdsPersistenceOfferInstructionV2 =
  | AdsCreateOfferInstructionV2
  | AdsNoopOfferInstructionV2
  | AdsHeldOfferInstructionV2
  | AdsBlockedOfferInstructionV2;

/** Kept structurally identical to the settled V2 RPC count contract. */
export interface AdsPersistencePlanCountsV2 {
  stores: {
    create: number;
    noopExisting: number;
    blockedAmbiguous: number;
    noopUnmatched: number;
  };
  offers: {
    create: number;
    noopExisting: number;
    noopHeld: number;
    noopUnresolved: number;
  };
  writableStores: number;
  writableOffers: number;
  writableEntities: number;
}

export interface AdsCanonicalPersistencePlanMaterialV2 {
  persistenceContractVersion: typeof ADS_PERSISTENCE_CONTRACT_VERSION_V2;
  provider: "impact";
  integrationId: string;
  evaluationTimestamp: string;
  mode: AdsPersistenceModeV2;
  canaryAdId: string | null;
  status: "ready" | "blocked";
  blockers: AdsPersistenceBlockerV2[];
  preconditions: AdsPersistencePreconditionV2[];
  storeInstructions: AdsPersistenceStoreInstructionV2[];
  offerInstructions: AdsPersistenceOfferInstructionV2[];
  counts: AdsPersistencePlanCountsV2;
}

export interface AdsPersistencePlanV2
  extends AdsCanonicalPersistencePlanMaterialV2 {
  canonicalPlanMaterial: AdsCanonicalPersistencePlanMaterialV2;
  canonicalPlanMaterialString: string;
}
