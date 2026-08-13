import type {
  AffiliateSyncPreviewV2,
  ExistingCatalogSnapshotV2,
  ImpactClientLimitsV2,
  ImpactContinuationPolicy,
  ImpactTransport,
  PublishingPolicyConfigV2,
  StoreQualificationConfigV2,
} from "../_shared/affiliate-sync-v2/index.ts";

export interface PreviewV2RequestBody {
  integrationId?: unknown;
  preview?: unknown;
}

export interface StoredIntegrationV2 {
  id: string;
  providerName: string;
  authenticationType: string;
  baseUrl: string;
  endpointConfiguration: Record<string, unknown>;
  isEnabled: boolean;
  timeoutSeconds: number;
  retryAttempts: number;
  pageSize: number;
  maxPages: number | null;
  publishingPolicyId: string | null;
}

export interface StoredPublishingPolicyV2 {
  enabled: boolean;
  minimumCouponsPerStore: number;
  maximumCouponsPerStore: number;
  minimumDealsPerStore: number;
  maximumDealsPerStore: number;
}

export interface ImpactHostCredentialsV2 {
  accountSid: string;
  authToken: string;
}

export interface ResolvedImpactHostConfigV2 {
  baseUrl: string;
  promotionsInitialUrl: string;
  campaignsInitialUrl: string;
  continuationPolicy: ImpactContinuationPolicy;
  limits: ImpactClientLimitsV2;
  requestTimeoutMs: number;
  publishingPolicyConfig: PublishingPolicyConfigV2;
  storeQualificationConfig: StoreQualificationConfigV2;
}

export interface CatalogStoreIdentityRowV2 {
  id: unknown;
  providerEntityId: unknown;
}

export interface CatalogOfferIdentityRowV2 {
  id: unknown;
  providerEntityId: unknown;
}

export interface CatalogSnapshotReaderV2 {
  readImpactStoreIdentityRows(): Promise<readonly CatalogStoreIdentityRowV2[]>;
  readImpactOfferIdentityRows(): Promise<readonly CatalogOfferIdentityRowV2[]>;
}

export interface PreviewV2DataSource extends CatalogSnapshotReaderV2 {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(integrationId: string): Promise<string | null>;
  readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<StoredPublishingPolicyV2 | null>;
}

export interface PreviewV2HostDependencies {
  verifyUser(
    authorization: string,
    jwt: string,
  ): Promise<{ id: string } | null>;
  createDataSource(): PreviewV2DataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(
    credentials: ImpactHostCredentialsV2,
    approvedCredentialOrigin: string,
  ): ImpactTransport;
  now(): Date;
  siteUrl: string | null;
}

export interface AffiliateSyncPreviewV2HostResponse {
  host: {
    version: "v2-a8a";
    readOnly: true;
    integrationId: string;
  };
  preview: AffiliateSyncPreviewV2;
}

export type PreviewV2ErrorCode =
  | "method_not_allowed"
  | "invalid_request"
  | "unauthenticated"
  | "unauthorized"
  | "integration_not_found"
  | "integration_disabled"
  | "provider_not_impact"
  | "credentials_unavailable"
  | "invalid_integration_config"
  | "catalog_snapshot_failed"
  | "provider_fetch_failed"
  | "malformed_provider_response"
  | "internal_error";

export type PreviewV2FailureStage = "provider_parse" | "preview_plan";

export interface PreviewV2FailureDiagnostic {
  stage: PreviewV2FailureStage;
  stopReason: "malformed_page" | null;
  resource: "promotions" | "campaigns" | null;
}

export interface PreviewV2ErrorResponse {
  host: { version: "v2-a8a"; readOnly: true };
  error: { code: PreviewV2ErrorCode; message: string };
  diagnostic?: PreviewV2FailureDiagnostic;
}

export interface PreviewV2CatalogInput {
  existingCatalogSnapshot: ExistingCatalogSnapshotV2;
}
