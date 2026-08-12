import type { MatchMethod, MerchantUnresolvedReasonV2 } from "./models.ts";

export type ImpactStream = "promotions" | "campaigns";

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
  stopReason: StreamStopReason | null;
  pageErrors: ImpactPageErrorV2[];
  pages: ImpactPageFetchDiagnosticV2[];
  retries: ImpactRetryDiagnosticV2[];
}

export interface RawFetchDiagnosticsV2 {
  promotions: ImpactStreamFetchDiagnosticsV2;
  campaigns: ImpactStreamFetchDiagnosticsV2;
  uniquePromotionCount: number;
  duplicatePromotionCount: number;
  duplicates: DuplicatePromotionProvenanceV2[];
  quarantinedRecords: QuarantinedImpactRecordV2[];
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

export interface AdvertiserDistributionV2 {
  advertiserId: string | null;
  advertiserName: string | null;
  promotionCount: number;
}

export interface StoreCoverageV2 {
  providerStoresDiscovered: number;
  existingStoresMatched: number;
  proposedStores: number;
  storesWithAssociatedOffers: number;
  qualifiedStores: number;
  unresolvedOffers: number;
}
