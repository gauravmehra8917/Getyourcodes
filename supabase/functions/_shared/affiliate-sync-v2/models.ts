import type {
  AdvertiserDistributionV2,
  ExistingOfferIdentityDiagnosticsV2,
  ImpactOfferNormalizationDiagnosticsV2,
  ImpactParserDiagnosticsV2,
  ImpactRecordProvenanceV2,
  MerchantIdentityDiagnosticsV2,
  PreviewIdentityIntegrityDiagnosticsV2,
  PromotionDeduplicationDiagnosticsV2,
  RawFetchDiagnosticsV2,
  StoreOfferMatchDiagnosticsV2,
  StoreCoverageV2,
} from "./diagnostics.ts";
import type { OfferQualificationResultV2 } from "./OfferQualification.ts";
import type {
  PublishingHoldReasonV2,
  PublishingPolicyResultV2,
  StoreQualificationResultV2,
} from "./PublishingPolicy.ts";
import type {
  ExistingPromotionIdentityStatusV2,
  MatchedNormalizedCouponV2,
  MatchedNormalizedDealV2,
} from "./StoreOfferMatcher.ts";

export type ImpactProvider = "impact";

/** Campaign identity is the only V2 provider-store namespace. */
export interface ProviderStoreKey {
  provider: ImpactProvider;
  namespace: "campaign";
  id: string;
}

export type MatchMethod =
  | "campaign_id"
  | "advertiser_id"
  | "explicit_provider_relation"
  | "unmatched";

/** The only unresolved merchant-identity outcomes supported in V2-A4. */
export type MerchantUnresolvedReasonV2 =
  | "unknown_campaign_id"
  | "campaign_advertiser_conflict"
  | "unknown_advertiser_id"
  | "ambiguous_advertiser_id"
  | "missing_merchant_identity";

export interface ResolvedStoreOfferAssociationV2 {
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  matchMethod: Exclude<MatchMethod, "unmatched">;
  unresolvedReason: null;
}

export interface UnresolvedStoreOfferAssociationV2 {
  providerStoreKey: null;
  matchedStoreId: null;
  matchMethod: "unmatched";
  unresolvedReason: MerchantUnresolvedReasonV2;
}

/** A promotion has one explicit campaign-backed association or one explicit reason. */
export type StoreOfferAssociationV2 =
  | ResolvedStoreOfferAssociationV2
  | UnresolvedStoreOfferAssociationV2;

/** Preserve a provider ID without altering its namespace or semantics. */
export function toOpaqueProviderId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export interface RawImpactPromotionV2 {
  promotionId: string | null;
  advertiserId: string | null;
  advertiserName: string | null;
  campaignId: string | null;
  programId: string | null;
  /** Directly parsed from Impact `PromotionTitle`; never derived from identity fields. */
  promotionTitle: string | null;
  /** Directly parsed from Impact `Description`. */
  description: string | null;
  /** Directly parsed from Impact `GenericRedemptionCode`. */
  genericRedemptionCode: string | null;
  /** Directly parsed from Impact `TrackingLink`. */
  trackingUrl: string | null;
  /** Directly parsed from Impact `StartDate` and `EndDate`, without date inference. */
  startDate: string | null;
  endDate: string | null;
  raw: Record<string, unknown>;
  provenance: ImpactRecordProvenanceV2;
}

export interface RawImpactCampaignV2 {
  campaignId: string | null;
  advertiserId: string | null;
  campaignName: string | null;
  destinationUrl: string | null;
  trackingUrl: string | null;
  raw: Record<string, unknown>;
  provenance: ImpactRecordProvenanceV2;
}

export type NormalizedOfferStatus = "active" | "inactive" | "expired" | "pending" | "unknown";
export type DiscountTypeV2 = "percentage" | "fixed" | "free_shipping" | "bogo" | "other" | "unknown";

export interface NormalizedStoreV2 {
  provider: ImpactProvider;
  providerStoreKey: ProviderStoreKey;
  campaignId: string;
  advertiserId: string | null;
  name: string | null;
  destinationUrl: string | null;
  trackingUrl: string | null;
  raw: RawImpactCampaignV2;
}

export interface NormalizedOfferBaseV2 {
  provider: ImpactProvider;
  promotionId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  campaignId: string | null;
  programId: string | null;
  title: string | null;
  description: string | null;
  trackingUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: NormalizedOfferStatus;
  association: StoreOfferAssociationV2;
  provenance: ImpactRecordProvenanceV2;
  raw: RawImpactPromotionV2;
}

export interface NormalizedCouponV2 extends NormalizedOfferBaseV2 {
  kind: "coupon";
  /** A5 creates coupons only from a non-empty provider redemption code. */
  code: string;
  discountType: DiscountTypeV2;
  discountValue: number | null;
  terms: string | null;
}

export interface NormalizedDealV2 extends NormalizedOfferBaseV2 {
  kind: "deal";
}

export interface ExistingStoreSnapshotV2 {
  id: string;
  providerStoreKey: ProviderStoreKey;
}

export interface ExistingOfferSnapshotV2 {
  id: string;
  promotionId: string;
}

/** Plain read-only input supplied by a future host boundary. */
export interface ExistingCatalogSnapshotV2 {
  stores: ExistingStoreSnapshotV2[];
  offers: ExistingOfferSnapshotV2[];
}

export type ProposedStoreActionCodeV2 =
  | "create"
  | "existing"
  | "unmatched"
  | "ambiguous_snapshot";

export interface ProposedResolvedStoreActionV2 {
  action: Exclude<ProposedStoreActionCodeV2, "unmatched">;
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  snapshotStoreIds: string[];
  qualified: boolean;
}

/** An unresolved promotion is reported without manufacturing a store identity. */
export interface ProposedUnmatchedStoreActionV2 {
  action: "unmatched";
  providerStoreKey: null;
  matchedStoreId: null;
  promotionId: string;
  unresolvedReason: MerchantUnresolvedReasonV2;
}

export type ProposedStoreActionV2 =
  | ProposedResolvedStoreActionV2
  | ProposedUnmatchedStoreActionV2;

export type ProposedOfferActionCodeV2 = "create" | "existing" | "held" | "unresolved";

interface ProposedOfferActionBaseV2 {
  kind: "coupon" | "deal";
  promotionId: string;
  existingPromotionIdentity: ExistingPromotionIdentityStatusV2;
  existingOfferId: string | null;
}

export interface ProposedCreateOfferActionV2 extends ProposedOfferActionBaseV2 {
  action: "create";
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  holdReason: null;
  unresolvedReason: null;
}

export interface ProposedExistingOfferActionV2 extends ProposedOfferActionBaseV2 {
  action: "existing";
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  holdReason: null;
  unresolvedReason: null;
}

export interface ProposedHeldOfferActionV2 extends ProposedOfferActionBaseV2 {
  action: "held";
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  holdReason: Exclude<PublishingHoldReasonV2, "unresolved_store">;
  unresolvedReason: null;
}

export interface ProposedUnresolvedOfferActionV2 extends ProposedOfferActionBaseV2 {
  action: "unresolved";
  providerStoreKey: null;
  matchedStoreId: null;
  holdReason: "unresolved_store";
  unresolvedReason: MerchantUnresolvedReasonV2;
}

export type ProposedOfferActionV2 =
  | ProposedCreateOfferActionV2
  | ProposedExistingOfferActionV2
  | ProposedHeldOfferActionV2
  | ProposedUnresolvedOfferActionV2;

export interface ProposedOfferKindCountsV2 {
  normalized: number;
  selected: number;
  held: number;
  unresolved: number;
  existing: number;
  proposedCreate: number;
}

export interface ProposedActionsV2 {
  stores: ProposedStoreActionV2[];
  offers: ProposedOfferActionV2[];
  counts: {
    stores: {
      discovered: number;
      matchedExisting: number;
      newCandidates: number;
      unmatchedAssociations: number;
      ambiguousSnapshot: number;
      qualified: number;
    };
    coupons: ProposedOfferKindCountsV2;
    deals: ProposedOfferKindCountsV2;
    offers: {
      normalized: number;
      selected: number;
      held: number;
      unresolved: number;
      existing: number;
      proposedCreate: number;
      duplicateRecordsRemoved: number;
      quarantined: number;
    };
  };
}

export interface PreviewOfferAssociationV2 {
  promotionId: string;
  kind: "coupon" | "deal";
  association: StoreOfferAssociationV2;
  existingPromotionIdentity: ExistingPromotionIdentityStatusV2;
  existingOfferId: string | null;
}

/** Strictly read-only V2 output. No execution or persistence capability exists. */
export interface AffiliateSyncPreviewV2 {
  provider: ImpactProvider;
  evaluationTimestamp: string;
  rawFetchDiagnostics: RawFetchDiagnosticsV2;
  parserDiagnostics: ImpactParserDiagnosticsV2;
  deduplicationDiagnostics: PromotionDeduplicationDiagnosticsV2;
  merchantIdentityDiagnostics: MerchantIdentityDiagnosticsV2;
  normalizationDiagnostics: ImpactOfferNormalizationDiagnosticsV2;
  storeMatchDiagnostics: StoreOfferMatchDiagnosticsV2;
  offerQualificationDiagnostics: OfferQualificationResultV2["diagnostics"];
  existingOfferIdentityDiagnostics: ExistingOfferIdentityDiagnosticsV2;
  topAdvertiserDistribution: AdvertiserDistributionV2[];
  advertiserDistributionTotal: number;
  advertiserDistributionDetailsReturned: number;
  advertiserDistributionDetailsTruncated: boolean;
  storeCoverage: StoreCoverageV2;
  identityIntegrityDiagnostics: PreviewIdentityIntegrityDiagnosticsV2;
  normalizedStores: NormalizedStoreV2[];
  normalizedCoupons: MatchedNormalizedCouponV2[];
  normalizedDeals: MatchedNormalizedDealV2[];
  associations: PreviewOfferAssociationV2[];
  publishingPolicy: PublishingPolicyResultV2;
  storeQualification: StoreQualificationResultV2[];
  proposedActions: ProposedActionsV2;
}
