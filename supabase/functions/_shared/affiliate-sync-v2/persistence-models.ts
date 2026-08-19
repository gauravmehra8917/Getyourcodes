import type {
  AffiliateSyncPreviewV2,
  ImpactProvider,
  MerchantUnresolvedReasonV2,
  ProviderStoreKey,
} from "./models.ts";
import type { PublishingHoldReasonV2 } from "./PublishingPolicy.ts";

export const PERSISTENCE_CONTRACT_VERSION_V2 = "v2-a9b-1" as const;

export type PersistenceContractVersionV2 =
  typeof PERSISTENCE_CONTRACT_VERSION_V2;

export type PersistenceOfferKindV2 = "coupon" | "deal";

/** Bounded catalog facts supplied by a trusted host; no client is used here. */
export interface KnownStoreSlugV2 {
  storeId: string;
  slug: string;
  providerStoreKey: ProviderStoreKey | null;
}

/** Existing kind evidence needed to forbid silent coupon/deal reclassification. */
export interface KnownOfferKindV2 {
  offerId: string;
  promotionId: string;
  kind: PersistenceOfferKindV2;
}

export interface PersistencePlanContextV2 {
  integrationId: string;
  /** Runtime validation still rejects every value other than exact `impact`. */
  provider: string;
  evaluationTimestamp: string;
  knownStoreSlugs: readonly KnownStoreSlugV2[];
  knownOfferKinds: readonly KnownOfferKindV2[];
}

export interface PersistencePlanInputV2 {
  preview: AffiliateSyncPreviewV2;
  context: PersistencePlanContextV2;
}

export type PersistencePlanStatusV2 = "ready" | "blocked";

export type PersistenceBlockerReasonV2 =
  | "unsupported_provider"
  | "invalid_context"
  | "preview_not_complete"
  | "identity_collapse_detected"
  | "duplicate_store_identity"
  | "duplicate_offer_identity"
  | "ambiguous_store_snapshot"
  | "invalid_store_projection"
  | "store_slug_collision"
  | "invalid_offer_projection"
  | "offer_kind_conflict"
  | "missing_parent_store"
  | "unqualified_parent_store"
  | "inconsistent_existing_store"
  | "inconsistent_existing_offer"
  | "invalid_preview_action"
  | "instruction_count_mismatch";

/** Fixed-shape, bounded diagnostic. It never carries provider envelopes. */
export interface PersistencePlanBlockerV2 {
  reason: PersistenceBlockerReasonV2;
  entity: "plan" | "store" | "offer";
  providerStoreKey: ProviderStoreKey | null;
  promotionId: string | null;
  internalIds: string[];
}

export type PersistencePreconditionCodeV2 =
  | "provider_is_impact"
  | "context_is_consistent"
  | "provider_fetches_completed"
  | "provider_parse_succeeded"
  | "identity_not_collapsed"
  | "store_identities_unique"
  | "promotion_identities_unique"
  | "writable_offers_resolved"
  | "writable_parents_unambiguous"
  | "writable_parents_qualified"
  | "store_projections_valid"
  | "offer_projections_valid"
  | "existing_store_ids_consistent"
  | "existing_offer_ids_consistent"
  | "offer_kinds_consistent"
  | "slug_candidates_available"
  | "nonwritable_actions_preserved"
  | "instruction_counts_reconcile";

export interface PersistencePlanPreconditionV2 {
  code: PersistencePreconditionCodeV2;
  satisfied: boolean;
}

export interface StoreCreateProjectionV2 {
  name: string;
  slugCandidate: string;
  description: null;
  affiliateUrl: string | null;
  destinationUrl: string | null;
  country: null;
  shippingRegions: [];
  logoSourceUrl: null;
  metadata: {
    advertiserId: string | null;
    campaignId: string;
  };
  importOrigin: "provider";
  lifecycleManaged: true;
  lifecycleHidden: false;
  lastQualificationResult: "qualified";
  lastQualifiedAt: string;
}

interface ResolvedStoreInstructionBaseV2 {
  providerStoreKey: ProviderStoreKey;
  provider: ImpactProvider;
  providerEntityId: string;
  qualified: boolean;
}

export interface CreateStoreInstructionV2
  extends ResolvedStoreInstructionBaseV2 {
  action: "create";
  expectedExistingStoreId: null;
  projection: StoreCreateProjectionV2 | null;
}

export interface NoopExistingStoreInstructionV2
  extends ResolvedStoreInstructionBaseV2 {
  action: "noop_existing";
  expectedExistingStoreId: string | null;
  projection: null;
}

export interface BlockedAmbiguousStoreInstructionV2
  extends ResolvedStoreInstructionBaseV2 {
  action: "blocked_ambiguous";
  expectedExistingStoreIds: string[];
  projection: null;
}

export interface NoopUnmatchedStoreInstructionV2 {
  action: "noop_unmatched";
  providerStoreKey: null;
  provider: ImpactProvider;
  providerEntityId: null;
  promotionId: string;
  unresolvedReason: MerchantUnresolvedReasonV2;
  qualified: false;
  projection: null;
}

export type PersistenceStoreInstructionV2 =
  | CreateStoreInstructionV2
  | NoopExistingStoreInstructionV2
  | BlockedAmbiguousStoreInstructionV2
  | NoopUnmatchedStoreInstructionV2;

export interface OfferCreateProjectionV2 {
  title: string;
  description: string | null;
  couponCode: string | null;
  couponType: "code" | "deal";
  affiliateUrl: string | null;
  landingPageUrl: null;
  startDate: string | null;
  expiryDate: string | null;
  status: "active";
  terms: string | null;
  discountType: string | null;
  discountValue: number | null;
  metadata: {
    advertiserId: string | null;
    campaignId: string | null;
    programId: string | null;
    resolvedCampaignId: string;
  };
}

interface OfferInstructionBaseV2 {
  promotionId: string;
  provider: ImpactProvider;
  providerEntityId: string;
  kind: PersistenceOfferKindV2;
  existingOfferId: string | null;
}

export interface CreateOfferInstructionV2 extends OfferInstructionBaseV2 {
  action: "create";
  parentProviderStoreKey: ProviderStoreKey;
  expectedParentStoreId: string | null;
  selected: true;
  projection: OfferCreateProjectionV2 | null;
}

export interface NoopExistingOfferInstructionV2
  extends OfferInstructionBaseV2 {
  action: "noop_existing";
  parentProviderStoreKey: ProviderStoreKey;
  expectedParentStoreId: string | null;
  selected: true;
  projection: null;
}

export interface NoopHeldOfferInstructionV2 extends OfferInstructionBaseV2 {
  action: "noop_held";
  parentProviderStoreKey: ProviderStoreKey;
  expectedParentStoreId: string | null;
  selected: false;
  holdReason: Exclude<PublishingHoldReasonV2, "unresolved_store">;
  projection: null;
}

export interface NoopUnresolvedOfferInstructionV2
  extends OfferInstructionBaseV2 {
  action: "noop_unresolved";
  parentProviderStoreKey: null;
  expectedParentStoreId: null;
  selected: false;
  holdReason: "unresolved_store";
  unresolvedReason: MerchantUnresolvedReasonV2;
  projection: null;
}

export type PersistenceOfferInstructionV2 =
  | CreateOfferInstructionV2
  | NoopExistingOfferInstructionV2
  | NoopHeldOfferInstructionV2
  | NoopUnresolvedOfferInstructionV2;

export interface PersistencePlanCountsV2 {
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

export interface CanonicalPersistencePlanMaterialV2 {
  persistenceContractVersion: PersistenceContractVersionV2;
  provider: string;
  integrationId: string;
  evaluationTimestamp: string;
  status: PersistencePlanStatusV2;
  blockers: PersistencePlanBlockerV2[];
  preconditions: PersistencePlanPreconditionV2[];
  storeInstructions: PersistenceStoreInstructionV2[];
  offerInstructions: PersistenceOfferInstructionV2[];
  counts: PersistencePlanCountsV2;
}

/** Pure intent only. No run ID and no execution capability are present. */
export interface PersistencePlanV2
  extends CanonicalPersistencePlanMaterialV2 {
  canonicalPlanMaterial: CanonicalPersistencePlanMaterialV2;
  canonicalPlanMaterialString: string;
}
