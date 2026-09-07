import type { ImpactTransport } from "../_shared/affiliate-sync-v2/contracts.ts";
import type { ImpactContinuationPolicy } from "../_shared/affiliate-sync-v2/impact-url-safety.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";

export const SOURCE_AUDIT_VERSION_V2 = "v2-a11-s2a-1" as const;
export const COUPON_ADS_AUDIT_MODE = "coupon_ads_coverage" as const;

export interface SourceAuditV2RequestBody {
  integrationId?: unknown;
  audit?: unknown;
}

export interface SourceAuditV2DataSource {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(integrationId: string): Promise<string | null>;
}

export interface ImpactRateSnapshotV2 {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface ImpactAuditTransportV2 extends ImpactTransport {
  readRateSnapshot(): ImpactRateSnapshotV2;
  resetRateSnapshot(): void;
  consumeResponseSizeLimitExceeded(): boolean;
}

export interface SourceAuditV2HostDependencies {
  verifyUser(
    authorization: string,
    jwt: string,
  ): Promise<{ id: string } | null>;
  createDataSource(): SourceAuditV2DataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(
    credentials: ImpactHostCredentialsV2,
    approvedCredentialOrigin: string,
  ): ImpactAuditTransportV2;
  siteUrl: string | null;
}

export type CouponAdsAuditStopReasonV2 =
  | "completed"
  | "page_limit"
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

export type CouponCodeShapeV2 =
  | "missing"
  | "null"
  | "emptyOrWhitespaceString"
  | "nonemptyString"
  | "otherShape";

export interface CouponCodeShapeCountsV2 {
  missing: number;
  null: number;
  emptyOrWhitespaceString: number;
  nonemptyString: number;
  otherShape: number;
}

export interface CouponAdsCoverageAuditV2 {
  complete: boolean;
  stopReason: CouponAdsAuditStopReasonV2;
  pagesFetched: number;
  physicalRequests: number;
  rawRecords: number;
  acceptedRecords: number;
  quarantinedRecords: number;
  identity: {
    distinctAdIds: number;
    missingAdId: number;
    duplicateAdIdRecords: number;
    distinctCampaignIds: number;
    missingCampaignId: number;
    campaignIdsFoundInCampaignIndex: number;
    campaignIdsMissingFromCampaignIndex: number;
    distinctAdvertiserIds: number;
    missingAdvertiserId: number;
    campaignAdvertiserCrossCheckAvailable: number;
    campaignAdvertiserConflicts: number;
  };
  merchantCoverage: {
    distinctCampaignIds: number;
    distinctAdvertiserIds: number;
  };
  offerShape: {
    withDealId: number;
    distinctDealIds: number;
    withoutDealId: number;
    withTrackingLink: number;
    withLandingPageUrl: number;
    withStartDate: number;
    withEndDate: number;
    dealDefaultPromoCode: CouponCodeShapeCountsV2;
    code: CouponCodeShapeCountsV2;
  };
  dealCardinality: {
    dealIdsWithOneAd: number;
    dealIdsWithMultipleAds: number;
    maxAdsPerDeal: number;
  };
  rate: ImpactRateSnapshotV2;
}

export interface CouponAdsCoverageHostResponseV2 {
  host: {
    version: typeof SOURCE_AUDIT_VERSION_V2;
    readOnly: true;
    integrationId: string;
    audit: typeof COUPON_ADS_AUDIT_MODE;
  };
  audit: CouponAdsCoverageAuditV2;
}

export type SourceAuditV2ErrorCode =
  | "origin_not_allowed"
  | "method_not_allowed"
  | "invalid_request"
  | "unauthenticated"
  | "unauthorized"
  | "integration_not_found"
  | "integration_disabled"
  | "provider_not_impact"
  | "credentials_unavailable"
  | "invalid_integration_config"
  | "campaign_fetch_failed"
  | "provider_fetch_failed"
  | "internal_error";

export interface SourceAuditV2ErrorResponse {
  host: {
    version: typeof SOURCE_AUDIT_VERSION_V2;
    readOnly: true;
  };
  error: {
    code: SourceAuditV2ErrorCode;
    message: string;
  };
}

export interface ResolvedCouponAdsAuditConfigV2 {
  baseUrl: string;
  adsInitialUrl: string;
  campaignsInitialUrl: string;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  campaignLimits: {
    maxPages: number;
    maxRecords: number;
    maxResponseBytes: number;
    maxAttempts: 1;
    baseBackoffMs: number;
    maxBackoffMs: number;
    maxRetryAfterMs: number;
  };
  adsMaxAttemptsPerPage: number;
}

export type CampaignAdvertiserIndexV2 = ReadonlyMap<
  string,
  ReadonlySet<string>
>;
