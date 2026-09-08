/** Exact immutable provider offer identity for Impact Ads. */
export interface ProviderAdOfferKey {
  provider: "impact";
  namespace: "ad";
  id: string;
}

/** Exact immutable provider store identity for this Ads pipeline. */
export interface ProviderStoreKey {
  provider: "impact";
  namespace: "campaign";
  id: string;
}

export interface AdsRecordProvenanceV2 {
  fetchSequence: number;
  recordIndex: number;
  providerPage: number | null;
  providerPageSize: number | null;
}

export type AdCodeClassV2 = "code_bearing" | "no_code";

/**
 * Parser output for one provider Ad. `DealDefaultPromoCode` has already been
 * reduced to `codeClass`; neither it nor Impact `Code` is retained.
 */
export interface RawImpactAdV2 {
  providerOfferKey: ProviderAdOfferKey;
  campaignId: string | null;
  advertiserId: string | null;
  dealId: string | null;
  title: string | null;
  description: string | null;
  trackingUrl: string | null;
  landingPageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  codeClass: AdCodeClassV2;
  provenance: AdsRecordProvenanceV2;
}

/** Narrow Campaign record used only to construct the exact Campaign index. */
export interface RawImpactCampaignForAdsV2 {
  campaignId: string;
  advertiserId: string | null;
  campaignName: string | null;
  destinationUrl: string | null;
  trackingUrl: string | null;
  provenance: AdsRecordProvenanceV2;
}

export type AdMerchantUnresolvedReasonV2 =
  | "missing_campaign_id"
  | "unknown_campaign_id"
  | "campaign_advertiser_conflict";

export interface ResolvedAdStoreAssociationV2 {
  providerStoreKey: ProviderStoreKey;
  matchMethod: "campaign_id";
  unresolvedReason: null;
}

export interface UnresolvedAdStoreAssociationV2 {
  providerStoreKey: null;
  matchMethod: "unmatched";
  unresolvedReason: AdMerchantUnresolvedReasonV2;
}

export type AdStoreAssociationV2 =
  | ResolvedAdStoreAssociationV2
  | UnresolvedAdStoreAssociationV2;

export interface ResolvedImpactAdV2 {
  ad: RawImpactAdV2;
  association: AdStoreAssociationV2;
}

export interface NormalizedImpactAdStoreV2 {
  providerStoreKey: ProviderStoreKey;
  campaignId: string;
  advertiserId: string | null;
  name: string | null;
  destinationUrl: string | null;
  trackingUrl: string | null;
}

/** Source-neutral offer. It is deliberately neither a coupon nor a deal. */
export interface NormalizedImpactAdOfferV2 {
  providerOfferKey: ProviderAdOfferKey;
  campaignId: string | null;
  advertiserId: string | null;
  dealId: string | null;
  title: string | null;
  description: string | null;
  trackingUrl: string | null;
  landingPageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  codeClass: AdCodeClassV2;
  association: AdStoreAssociationV2;
  provenance: AdsRecordProvenanceV2;
}

export interface ImpactAdNormalizationResultV2 {
  stores: NormalizedImpactAdStoreV2[];
  offers: NormalizedImpactAdOfferV2[];
}

export interface ExistingAdsStoreSnapshotV2 {
  id: string;
  providerStoreKey: ProviderStoreKey;
}

/** A11-S3 intentionally accepts no existing-offer identities. */
export interface ExistingAdsCatalogSnapshotV2 {
  stores: ExistingAdsStoreSnapshotV2[];
}

export type AdsStoreSnapshotStatusV2 =
  | "existing"
  | "new_candidate"
  | "ambiguous";

export interface MatchedImpactAdStoreV2 extends NormalizedImpactAdStoreV2 {
  snapshotStatus: AdsStoreSnapshotStatusV2;
  matchedStoreId: string | null;
}

export interface MatchedImpactAdOfferV2 extends NormalizedImpactAdOfferV2 {
  snapshotStatus: AdsStoreSnapshotStatusV2 | "unresolved";
  matchedStoreId: string | null;
}

export interface ImpactAdStoreMatchResultV2 {
  stores: MatchedImpactAdStoreV2[];
  offers: MatchedImpactAdOfferV2[];
}

export type AdsIneligibilityReasonV2 =
  | "unresolved_store"
  | "not_started"
  | "expired"
  | "invalid_date"
  | "invalid_date_range"
  | "missing_title";

export interface QualifiedImpactAdOfferV2 {
  offer: MatchedImpactAdOfferV2;
  eligible: boolean;
  reason: AdsIneligibilityReasonV2 | null;
}

export interface AdsOfferQualificationResultV2 {
  evaluationTimestamp: string;
  offers: QualifiedImpactAdOfferV2[];
}

export interface SelectedImpactAdStoreV2 {
  store: MatchedImpactAdStoreV2;
  selected: MatchedImpactAdOfferV2[];
  held: QualifiedImpactAdOfferV2[];
}

export interface AdsPublishingSelectionResultV2 {
  sourceNeutralMaxSelectedAdsPerStore: number;
  stores: SelectedImpactAdStoreV2[];
  unresolvedHeld: QualifiedImpactAdOfferV2[];
}

export interface AdsShadowPolicyConfigV2 {
  /** Zero means uncapped. A11-S3 requires zero. */
  sourceNeutralMaxSelectedAdsPerStore: number;
  maximumCouponsPerStore: number;
  maximumDealsPerStore: number;
  minimumSelectedCoupons: number;
  minimumSelectedDeals: number;
  minimumTotalSelectedOffers: number;
}

/** IDs remain opaque: trim strings and stringify only finite numbers. */
export function toOpaqueAdProviderIdV2(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function providerStoreKeyIdentityV2(key: ProviderStoreKey): string {
  if (
    key.provider !== "impact" || key.namespace !== "campaign" || !key.id
  ) {
    throw new Error("Expected an exact Impact Campaign provider-store key");
  }
  return JSON.stringify([key.provider, key.namespace, key.id]);
}
