import type {
  AdsPreviewPlanResultV2,
  ExistingAdsCatalogSnapshotV2,
  ImpactAdsFetchLimitsV2,
  ImpactAdsTransportV2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import type { ImpactContinuationPolicy } from "../_shared/affiliate-sync-v2/impact-url-safety.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";

export const ADS_PREVIEW_HOST_VERSION_V2 = "v2-a11-s3" as const;

export interface AdsPreviewV2RequestBody {
  integrationId?: unknown;
  preview?: unknown;
}

export interface StoredAdsPublishingPolicyRowV2 {
  enabled: unknown;
  minimumCouponsPerStore: unknown;
  maximumCouponsPerStore: unknown;
  minimumDealsPerStore: unknown;
  maximumDealsPerStore: unknown;
}

export interface AdsCatalogStoreIdentityRowV2 {
  id: unknown;
  providerEntityId: unknown;
}

export interface AdsPreviewV2DataSource {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(integrationId: string): Promise<string | null>;
  readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<StoredAdsPublishingPolicyRowV2 | null>;
  readImpactStoreIdentityRows(): Promise<
    readonly AdsCatalogStoreIdentityRowV2[]
  >;
}

export interface AdsPreviewV2HostDependencies {
  verifyUser(
    authorization: string,
    jwt: string,
  ): Promise<{ id: string } | null>;
  createDataSource(): AdsPreviewV2DataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(
    credentials: ImpactHostCredentialsV2,
    approvedCredentialOrigin: string,
  ): ImpactAdsTransportV2;
  now(): string;
  siteUrl: string | null;
}

export interface ResolvedImpactAdsHostConfigV2 {
  baseUrl: string;
  adsInitialUrl: string;
  campaignsInitialUrl: string;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  campaignLimits: ImpactAdsFetchLimitsV2;
  adsLimits: ImpactAdsFetchLimitsV2;
}

export interface AffiliateSyncAdsPreviewHostResponseV2 {
  host: {
    version: typeof ADS_PREVIEW_HOST_VERSION_V2;
    readOnly: true;
    integrationId: string;
    existingOfferMatching: "not_evaluated";
  };
  result: AdsPreviewPlanResultV2;
}

export type AdsPreviewV2ErrorCode =
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
  | "policy_read_failed"
  | "catalog_snapshot_failed"
  | "campaign_fetch_failed"
  | "provider_fetch_failed"
  | "preview_plan_failed"
  | "internal_error";

export interface AdsPreviewV2ErrorResponse {
  host: {
    version: typeof ADS_PREVIEW_HOST_VERSION_V2;
    readOnly: true;
  };
  error: {
    code: AdsPreviewV2ErrorCode;
    message: string;
  };
}

export type AdsPreviewCatalogSnapshotV2 = ExistingAdsCatalogSnapshotV2;
