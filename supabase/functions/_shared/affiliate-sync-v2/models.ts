import type {
  AdvertiserDistributionV2,
  ImpactRecordProvenanceV2,
  MerchantIdentityDiagnosticsV2,
  RawFetchDiagnosticsV2,
  StoreCoverageV2,
} from "./diagnostics.ts";

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

interface NormalizedOfferBaseV2 {
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
  code: string | null;
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

export interface ProposedActionCountsV2 {
  stores: { create: number; update: number; skip: number };
  coupons: { create: number; update: number; skip: number };
  deals: { create: number; update: number; skip: number };
  total: { create: number; update: number; skip: number };
}

export interface PublishingPolicyResultV2 {
  selectedPromotionIds: string[];
  heldPromotionIds: string[];
}

export interface StoreQualificationResultV2 {
  providerStoreKey: ProviderStoreKey;
  qualified: boolean;
  reason: string;
}

/** Strictly read-only V2 output. No execution or persistence capability exists. */
export interface AffiliateSyncPreviewV2 {
  provider: ImpactProvider;
  rawFetchDiagnostics: RawFetchDiagnosticsV2;
  merchantIdentityDiagnostics: MerchantIdentityDiagnosticsV2;
  topAdvertiserDistribution: AdvertiserDistributionV2[];
  storeCoverage: StoreCoverageV2;
  normalizedStores: NormalizedStoreV2[];
  normalizedCoupons: NormalizedCouponV2[];
  normalizedDeals: NormalizedDealV2[];
  associations: StoreOfferAssociationV2[];
  publishingPolicy: PublishingPolicyResultV2;
  storeQualification: StoreQualificationResultV2[];
  proposedActions: ProposedActionCountsV2;
}
