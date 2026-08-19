import type { MatchMethod, MerchantUnresolvedReasonV2 } from "./models.ts";

export type ImpactStream = "promotions" | "campaigns";

export type ImpactParseFailureReasonV2 =
  | "invalid_json"
  | "envelope_not_object"
  | "missing_collection"
  | "collection_not_array"
  | "invalid_nextpageuri";

export type StreamStopReason =
  | "completed"
  | "page_limit"
  | "record_limit"
  | "continuation_loop"
  | "invalid_continuation"
  | "malformed_page"
  | "transport_error"
  | "provider_error"
  | "timeout"
  | "cancelled";

/** Sanitized provenance for a request and the continuation that led to it. */
export interface ImpactPageProvenanceV2 {
  stream: ImpactStream;
  fetchSequence: number;
  sanitizedRequestUrl: string;
  sanitizedSourceContinuationUrl: string | null;
  providerPage: string | null;
  providerPageSize: string | null;
}

export interface ImpactRecordProvenanceV2 extends ImpactPageProvenanceV2 {
  recordIndex: number;
}

export type QuarantineReason =
  | "malformed_record"
  | "missing_promotion_id"
  | "missing_campaign_id";

/** Fixed, aggregate-only quarantine accounting for one provider stream. */
export interface ImpactQuarantineReasonCountsV2 {
  malformed_record: number;
  missing_promotion_id: number;
  missing_campaign_id: number;
}

/** Aggregate raw shape of the exact PromotionIds property on Promotion objects. */
export interface ImpactPromotionIdShapeCountsV2 {
  missing: number;
  null: number;
  nonempty_string: number;
  empty_or_whitespace_string: number;
  number: number;
  array: number;
  object: number;
  boolean: number;
  other: number;
}

export interface QuarantinedImpactRecordV2 {
  stream: ImpactStream;
  reason: QuarantineReason;
  provenance: ImpactRecordProvenanceV2;
}

export type ImpactPageErrorCode =
  | "malformed_page"
  | "invalid_continuation"
  | "response_size_limit_exceeded"
  | "continuation_loop";

export interface ImpactPageErrorV2 {
  stream: ImpactStream;
  code: ImpactPageErrorCode;
  provenance: Omit<ImpactPageProvenanceV2, "providerPage" | "providerPageSize">;
  detail: string;
}

/** A credential-free account of one fetched page. */
export interface ImpactPageFetchDiagnosticV2 {
  provenance: Omit<ImpactPageProvenanceV2, "providerPage" | "providerPageSize"> & {
    providerPage: string | null;
    providerPageSize: string | null;
  };
  rawRecordCount: number;
  acceptedRecordCount: number;
  quarantinedRecordCount: number;
  responseBytes: number | null;
  accepted: boolean;
}

export interface ImpactRetryDiagnosticV2 {
  stream: ImpactStream;
  fetchSequence: number;
  sanitizedRequestUrl: string;
  attempts: number;
  retryDelaysMs: number[];
  finalStatus: number | null;
}

export type DuplicatePromotionConflictFieldV2 =
  | "advertiserId"
  | "advertiserName"
  | "campaignId"
  | "programId";

/**
 * Permanent, sanitized duplicate accounting. `occurrences` includes the
 * retained first occurrence followed by every later duplicate occurrence.
 */
export interface DuplicatePromotionProvenanceV2 {
  promotionId: string;
  retainedOccurrence: ImpactRecordProvenanceV2;
  occurrences: ImpactRecordProvenanceV2[];
  totalOccurrences: number;
  duplicateOccurrenceCount: number;
  conflictingProviderFields: DuplicatePromotionConflictFieldV2[];
}

export interface ImpactStreamFetchDiagnosticsV2 {
  stream: ImpactStream;
  pagesFetched: number;
  rawRecordCount: number;
  acceptedRecordCount: number;
  quarantinedRecordCount: number;
  quarantineReasonCounts: ImpactQuarantineReasonCountsV2;
  /** Present only when `stream` is Promotions. */
  promotionIdShapeCounts?: ImpactPromotionIdShapeCountsV2;
  stopReason: StreamStopReason | null;
  parseFailureReason: ImpactParseFailureReasonV2 | null;
  pageErrors: ImpactPageErrorV2[];
  pages: ImpactPageFetchDiagnosticV2[];
  retries: ImpactRetryDiagnosticV2[];
}

export interface RawFetchDiagnosticsV2 {
  promotions: ImpactStreamFetchDiagnosticsV2;
  campaigns: ImpactStreamFetchDiagnosticsV2;
  uniquePromotionCount: number;
  duplicatePromotionCount: number;
  duplicatedPromotionIdentities: number;
  duplicates: DuplicatePromotionProvenanceV2[];
  duplicateDetailsReturned: number;
  duplicateDetailsTruncated: boolean;
  quarantinedRecords: QuarantinedImpactRecordV2[];
  quarantinedDetailsReturned: number;
  quarantinedDetailsTruncated: boolean;
}

/** Exact parser accounting; legacy detail fields remain present but are empty in public previews. */
export interface ImpactParserDiagnosticsV2 {
  quarantinedRecords: number;
  quarantinedPromotions: number;
  quarantinedCampaigns: number;
  quarantineDetails: QuarantinedImpactRecordV2[];
  quarantineDetailsReturned: number;
  quarantineDetailsTruncated: boolean;
}

/** A3 aggregate counters and bounded duplicate provenance for the final preview. */
export interface PromotionDeduplicationDiagnosticsV2 {
  acceptedInputRecords: number;
  uniquePromotions: number;
  duplicateRecordsRemoved: number;
  duplicatedIdentities: number;
  identitiesWithConflictingProviderFields: number;
  duplicateDetails: DuplicatePromotionProvenanceV2[];
  duplicateDetailsReturned: number;
  duplicateDetailsTruncated: boolean;
}

export type DuplicateCampaignConflictFieldV2 =
  | "advertiserId"
  | "campaignName"
  | "destinationUrl"
  | "trackingUrl";

/**
 * Permanent, sanitized campaign-identity duplicate accounting. The retained
 * occurrence is the first record in the documented provenance ordering.
 */
export interface DuplicateCampaignIdentityDiagnosticV2 {
  campaignId: string;
  retainedOccurrence: ImpactRecordProvenanceV2;
  occurrences: ImpactRecordProvenanceV2[];
  totalOccurrences: number;
  duplicateOccurrenceCount: number;
  conflictingIdentityFields: DuplicateCampaignConflictFieldV2[];
}

/** Exact campaign-index counters; detail truncation never affects these totals. */
export interface CampaignIndexDiagnosticsV2 {
  acceptedCampaignRecords: number;
  indexedCampaigns: number;
  duplicateCampaignRecords: number;
  duplicatedCampaignIdentities: number;
  campaignIdentitiesWithConflictingFields: number;
  duplicateCampaignDetails: DuplicateCampaignIdentityDiagnosticV2[];
  duplicateCampaignDetailsReturned: number;
  duplicateCampaignDetailsTruncated: boolean;
  advertisersMappingToExactlyOneCampaign: number;
  advertisersMappingToMultipleCampaigns: number;
  campaignsMissingAdvertiserId: number;
}

/** Compact, credential-free evidence for an exact campaign/advertiser conflict. */
export interface CampaignAdvertiserConflictDiagnosticV2 {
  promotionId: string;
  promotionAdvertiserId: string;
  campaignId: string;
  campaignAdvertiserId: string;
  promotionProvenance: ImpactRecordProvenanceV2;
  campaignProvenance: ImpactRecordProvenanceV2;
}

export interface MerchantIdentityDiagnosticsV2 {
  /** Distinct exact advertiser IDs referenced by deduplicated promotions. */
  advertiserCount: number;
  /** Distinct campaign-backed provider-store candidates after local indexing. */
  campaignCount: number;
  unresolvedAssociationCount: number;
  matchMethodCounts: Record<MatchMethod, number>;
  unresolvedReasonCounts: Record<MerchantUnresolvedReasonV2, number>;
  promotionsEvaluated: number;
  resolvedByCampaignId: number;
  resolvedByAdvertiserId: number;
  unmatchedTotal: number;
  distinctCampaignIdsReferencedByPromotions: number;
  distinctAdvertiserIdsReferencedByPromotions: number;
  distinctResolvedProviderStoreKeys: number;
  /** Exact campaign-ID resolutions where the advertiser cross-check lacked one side. */
  advertiserCrossCheckUnavailableCount: number;
  campaignAdvertiserConflicts: CampaignAdvertiserConflictDiagnosticV2[];
  campaignAdvertiserConflictDetailsReturned: number;
  campaignAdvertiserConflictDetailsTruncated: boolean;
  campaignIndex: CampaignIndexDiagnosticsV2;
}

/** Exact, read-only accounting for the V2-A5 normalization stage. */
export interface ImpactOfferNormalizationDiagnosticsV2 {
  deduplicatedPromotionsEvaluated: number;
  couponsNormalized: number;
  dealsNormalized: number;
  offersUnresolvedFromA4: number;
  offersWithResolvedProviderStoreKey: number;
  storesNormalized: number;
}

/** Exact, read-only accounting for V2-A5 snapshot identity matching. */
export interface StoreOfferMatchDiagnosticsV2 {
  offersEvaluated: number;
  offersUnresolvedFromA4: number;
  offersWithResolvedProviderStoreKey: number;
  offersMatchedToExistingStore: number;
  resolvedProviderStoreKeysWithNoExistingStore: number;
  ambiguousSnapshotStoreKeys: number;
  newPromotionIdentities: number;
  existingPromotionIdentities: number;
}

export interface AdvertiserDistributionV2 {
  advertiserId: string | null;
  advertiserName: string | null;
  promotionCount: number;
}

export interface StoreCoverageV2 {
  campaignBackedStoresDiscovered: number;
  providerStoreKeysReferencedByPromotions: number;
  storesWithResolvedOffers: number;
  storesMatchedToExisting: number;
  newStoreCandidates: number;
  storesWithSelectedOffers: number;
  qualifiedStores: number;
  unresolvedOffers: number;
  ambiguousSnapshotKeys: number;
}

export interface ExistingOfferIdentityDiagnosticsV2 {
  normalizedOffers: number;
  existingPromotionIdentities: number;
  newPromotionIdentities: number;
}

/** Permanent generic regression evidence against downstream provider-store collapse. */
export interface PreviewIdentityIntegrityDiagnosticsV2 {
  distinctResolvedProviderStoreKeys: number;
  normalizedProviderStoreKeys: number;
  matchedProviderStoreKeys: number;
  policyProviderStoreKeys: number;
  qualificationProviderStoreKeys: number;
  identityCollapseDetected: boolean;
}
