import type { MatchMethod, ProviderStoreKey } from "./models.ts";

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

export type ImpactPageErrorCode = "malformed_page" | "invalid_continuation";

export interface ImpactPageErrorV2 {
  stream: ImpactStream;
  code: ImpactPageErrorCode;
  provenance: Omit<ImpactPageProvenanceV2, "providerPage" | "providerPageSize">;
  detail: string;
}

export interface DuplicatePromotionProvenanceV2 {
  promotionId: string;
  retained: ImpactRecordProvenanceV2;
  duplicates: ImpactRecordProvenanceV2[];
}

export interface ImpactStreamFetchDiagnosticsV2 {
  stream: ImpactStream;
  pagesFetched: number;
  rawRecordCount: number;
  acceptedRecordCount: number;
  quarantinedRecordCount: number;
  stopReason: StreamStopReason | null;
  pageErrors: ImpactPageErrorV2[];
}

export interface RawFetchDiagnosticsV2 {
  promotions: ImpactStreamFetchDiagnosticsV2;
  campaigns: ImpactStreamFetchDiagnosticsV2;
  uniquePromotionCount: number;
  duplicatePromotionCount: number;
  duplicates: DuplicatePromotionProvenanceV2[];
  quarantinedRecords: QuarantinedImpactRecordV2[];
}

export interface MerchantIdentityDiagnosticsV2 {
  advertiserCount: number;
  campaignCount: number;
  unresolvedAssociationCount: number;
  matchMethodCounts: Record<MatchMethod, number>;
  unresolvedReasonCounts: Record<string, number>;
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
