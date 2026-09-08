import type {
  AdCodeClassV2,
  AdMerchantUnresolvedReasonV2,
  AdsIneligibilityReasonV2,
} from "./ad-models.ts";

export type ImpactAdsCredentialDispositionV2 =
  | "attach_if_same_origin"
  | "omit";

export interface ImpactAdsTransportRequestV2 {
  method: "GET";
  url: string;
  credentialDisposition: ImpactAdsCredentialDispositionV2;
  redirect: "error";
  signal?: AbortSignal;
}

export type ImpactAdsTransportResultV2 =
  | {
    kind: "response";
    status: number;
    bodyText: string;
    retryAfterMs: number | null;
  }
  | {
    kind: "transport_error" | "timeout" | "aborted";
    errorCode: string | null;
  };

export interface ImpactAdsRateSnapshotV2 {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

/** Credential-free transport boundary implemented by the Edge host. */
export interface ImpactAdsTransportV2 {
  execute(
    request: ImpactAdsTransportRequestV2,
  ): Promise<ImpactAdsTransportResultV2>;
  wait(delayMs: number, signal?: AbortSignal): Promise<void>;
  readRateSnapshot(): ImpactAdsRateSnapshotV2;
  consumeResponseSizeLimitExceeded(): boolean;
}

export interface ImpactAdsFetchLimitsV2 {
  pageSize: number;
  maxPages: number;
  maxRecords: number;
  maxPhysicalRequests: number;
  maxResponseBytes: number;
  maxAttemptsPerPage: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxRetryAfterMs: number;
  rateRemainingFloor: number;
}

export const DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2: Readonly<
  ImpactAdsFetchLimitsV2
> = Object.freeze({
  pageSize: 100,
  maxPages: 25,
  maxRecords: 2_500,
  maxPhysicalRequests: 35,
  maxResponseBytes: 5 * 1024 * 1024,
  maxAttemptsPerPage: 1,
  baseBackoffMs: 500,
  maxBackoffMs: 30_000,
  maxRetryAfterMs: 60_000,
  rateRemainingFloor: 10,
});

export type ImpactAdsFetchStopReasonV2 =
  | "completed"
  | "page_limit"
  | "record_limit"
  | "physical_request_limit"
  | "rate_limit_threshold"
  | "rate_limited"
  | "invalid_continuation"
  | "continuation_loop"
  | "malformed_page"
  | "response_size_limit"
  | "timeout"
  | "cancelled"
  | "transport_error"
  | "provider_error";

export type ImpactAdsParseFailureReasonV2 =
  | "invalid_json"
  | "envelope_not_object"
  | "missing_collection"
  | "collection_not_array"
  | "invalid_nextpageuri";

export interface ImpactAdsQuarantineReasonCountsV2 {
  malformed_record: number;
  missing_ad_id: number;
  missing_campaign_id: number;
}

export interface ImpactAdsPageDiagnosticV2 {
  fetchSequence: number;
  providerPage: number | null;
  providerPageSize: number | null;
  responseBytes: number;
  rawRecords: number;
  acceptedRecords: number;
  quarantinedRecords: number;
  accepted: boolean;
}

export interface ImpactAdsFetchDiagnosticsV2 {
  stream: "ads" | "campaigns";
  complete: boolean;
  stopReason: ImpactAdsFetchStopReasonV2;
  parseFailureReason: ImpactAdsParseFailureReasonV2 | null;
  pagesFetched: number;
  physicalRequests: number;
  retryCount: number;
  rawRecords: number;
  acceptedRecords: number;
  quarantinedRecords: number;
  recordsDiscardedByLimit: number;
  quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2;
  pages: ImpactAdsPageDiagnosticV2[];
  rate: ImpactAdsRateSnapshotV2;
}

export interface RawAdDeduplicationDiagnosticsV2 {
  acceptedInputRecords: number;
  uniqueAds: number;
  duplicateRecordsRemoved: number;
  duplicatedAdIdentities: number;
  identitiesWithConflictingProviderFields: number;
}

export interface AdsCampaignIndexDiagnosticsV2 {
  acceptedCampaignRecords: number;
  indexedCampaigns: number;
  duplicateCampaignRecords: number;
  duplicatedCampaignIdentities: number;
  campaignIdentitiesWithAdvertiserConflicts: number;
  campaignsMissingAdvertiserId: number;
}

export interface ImpactAdMerchantDiagnosticsV2 {
  adsEvaluated: number;
  resolvedByCampaignId: number;
  unresolvedTotal: number;
  unresolvedReasonCounts: Record<AdMerchantUnresolvedReasonV2, number>;
  distinctCampaignIdsReferenced: number;
  distinctAdvertiserIdsReferenced: number;
  distinctResolvedProviderStoreKeys: number;
  advertiserCrossCheckAvailable: number;
  advertiserCrossCheckUnavailable: number;
  advertiserConflicts: number;
}

export interface ImpactAdNormalizationDiagnosticsV2 {
  uniqueAdsEvaluated: number;
  normalizedOffers: number;
  normalizedStores: number;
  codeClassCounts: Record<AdCodeClassV2, number>;
}

export interface ImpactAdStoreMatchDiagnosticsV2 {
  storesEvaluated: number;
  storesMatchedExisting: number;
  newStoreCandidates: number;
  ambiguousStoreSnapshotKeys: number;
  offersMatchedToExistingStore: number;
  offersForNewStoreCandidate: number;
  offersHeldForAmbiguousStore: number;
  unresolvedOffers: number;
  existingOfferMatching: "not_evaluated";
}

export interface AdsQualificationDiagnosticsV2 {
  offersEvaluated: number;
  eligibleOffers: number;
  heldOffers: number;
  reasonCounts: Record<AdsIneligibilityReasonV2, number>;
}

export interface AdsSelectionDiagnosticsV2 {
  sourceNeutralMaxSelectedAdsPerStore: number;
  selectedAdsTotal: number;
  heldAdsTotal: number;
  codeBearingSelected: number;
  noCodeSelected: number;
  storesWithSelectedAds: number;
  storesWithoutSelectedAds: number;
}

export type ClassificationDependentEvaluationV2 =
  | "not_applicable"
  | "classification_dependent";

export interface AdsPolicyDiagnosticsV2 {
  couponCap: { value: number; evaluation: "classification_dependent" };
  dealCap: { value: number; evaluation: "classification_dependent" };
  minimumSelectedCoupons: {
    value: number;
    evaluation: ClassificationDependentEvaluationV2;
  };
  minimumSelectedDeals: {
    value: number;
    evaluation: ClassificationDependentEvaluationV2;
  };
  minimumTotalSelectedOffers: { value: number; evaluation: "evaluated" };
  storesEvaluated: number;
  policyQualificationPass: number;
  policyQualificationFail: number;
  policyQualificationClassificationDependent: number;
  storesWithSelectedAds: number;
  policyPassWithSelectedAds: number;
  policyPassWithoutSelectedAds: number;
  policyFailWithSelectedAds: number;
  policyFailWithoutSelectedAds: number;
  classificationDependentWithSelectedAds: number;
  classificationDependentWithoutSelectedAds: number;
}

export interface AdsDealCardinalityDiagnosticsV2 {
  adsWithDealId: number;
  adsWithoutDealId: number;
  distinctDealIds: number;
  dealIdsWithOneAd: number;
  dealIdsWithMultipleAds: number;
  maxAdsPerDeal: number;
}

export interface AdsIdentityIntegrityDiagnosticsV2 {
  distinctAdIdsAfterFetch: number;
  distinctAdIdsAfterDeduplication: number;
  distinctAdIdsAfterNormalization: number;
  distinctAdIdsAfterFinalDisposition: number;
  distinctProviderStoreKeysAfterResolution: number;
  distinctProviderStoreKeysAfterNormalization: number;
  distinctProviderStoreKeysAfterMatching: number;
  distinctProviderStoreKeysAfterQualification: number;
  identityCollapseDetected: false;
}

export interface AffiliateSyncAdsPreviewDiagnosticsV2 {
  deduplication: RawAdDeduplicationDiagnosticsV2;
  campaignIndex: AdsCampaignIndexDiagnosticsV2;
  merchantIdentity: ImpactAdMerchantDiagnosticsV2;
  normalization: ImpactAdNormalizationDiagnosticsV2;
  storeMatching: ImpactAdStoreMatchDiagnosticsV2;
  qualification: AdsQualificationDiagnosticsV2;
  selection: AdsSelectionDiagnosticsV2;
  policy: AdsPolicyDiagnosticsV2;
  dealCardinality: AdsDealCardinalityDiagnosticsV2;
  identityIntegrity: AdsIdentityIntegrityDiagnosticsV2;
  existingOfferMatching: "not_evaluated";
}
