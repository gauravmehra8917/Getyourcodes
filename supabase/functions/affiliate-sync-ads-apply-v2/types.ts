import type {
  AdsRefreshPersistenceBlockerV2,
  AdsRefreshPersistencePlanCountsV2,
  AdsRefreshPersistencePlanV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-models.ts";
import type { AdsRefreshPersistenceActualCountsV2 } from "./persistence-refresh-result.ts";
import type {
  ImpactAdsFetchLimitsV2,
  ImpactAdsTransportV2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import type {
  AdsCatalogPlanningContextV2,
  AdsPersistenceModeV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/index.ts";
import type { ImpactContinuationPolicy } from "../_shared/affiliate-sync-v2/impact-url-safety.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";
import type { PreparedAdsRefreshPersistenceExecutionV2 } from "./persistence-refresh-execution.ts";

export interface AdsApplyV2RequestBody {
  integrationId?: unknown;
  execute?: unknown;
  mode?: unknown;
  canaryAdId?: unknown;
}

export interface AdsApplyV2DataSource {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(integrationId: string): Promise<string | null>;
  loadCatalogPlanningContext(): Promise<AdsCatalogPlanningContextV2>;
  applyPersistencePlan(
    prepared: PreparedAdsRefreshPersistenceExecutionV2,
  ): Promise<AdsApplyV2RpcTransportResult>;
}

export interface AdsApplyV2HostDependencies {
  verifyUser(
    authorization: string,
    jwt: string,
  ): Promise<{ id: string } | null>;
  createDataSource(): AdsApplyV2DataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(
    credentials: ImpactHostCredentialsV2,
    approvedCredentialOrigin: string,
    maximumResponseBytes: number,
  ): ImpactAdsTransportV2;
  persistencePlan(input: {
    integrationId: string;
    evaluationTimestamp: string;
    siteUrl: string;
    mode: AdsPersistenceModeV2;
    canaryAdId: string | null;
    campaignFetch:
      import("../_shared/affiliate-sync-v2-ads/index.ts").ImpactCampaignFetchResultForAdsV2;
    adsFetch:
      import("../_shared/affiliate-sync-v2-ads/index.ts").ImpactAdsFetchResultV2;
    catalog: AdsCatalogPlanningContextV2;
  }): AdsRefreshPersistencePlanV2;
  prepareExecution(
    plan: AdsRefreshPersistencePlanV2,
    triggeredBy: string,
  ): Promise<PreparedAdsRefreshPersistenceExecutionV2>;
  now(): Date;
  siteUrl: string | null;
}

export interface ResolvedImpactAdsApplyHostConfigV2 {
  baseUrl: string;
  adsInitialUrl: string;
  campaignsInitialUrl: string;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  campaignLimits: ImpactAdsFetchLimitsV2;
  adsLimits: ImpactAdsFetchLimitsV2;
}

export type AdsApplyV2FailureStage =
  | "cors"
  | "auth"
  | "request"
  | "integration_load"
  | "credential_load"
  | "provider_fetch"
  | "catalog_snapshot"
  | "persistence_plan"
  | "fingerprint"
  | "rpc_apply"
  | "response";

export type AdsApplyV2FailureReason =
  | "origin_not_allowed"
  | "method_not_allowed"
  | "invalid_request"
  | "unauthenticated"
  | "unauthorized"
  | "integration_not_found"
  | "integration_disabled"
  | "provider_not_impact"
  | "invalid_integration_config"
  | "credentials_unavailable"
  | "campaign_fetch_failed"
  | "provider_fetch_failed"
  | "catalog_snapshot_failed"
  | "persistence_plan_failed"
  | "plan_blocked"
  | "fingerprint_failed"
  | "rpc_blocked"
  | "rpc_failed"
  | "outcome_unknown"
  | "response_failed";

export type AdsApplyV2RpcStage =
  | "request_validation"
  | "replay_resolution"
  | "store_revalidation"
  | "store_insert"
  | "store_update"
  | "offer_revalidation"
  | "offer_insert"
  | "offer_update"
  | "evidence_validation"
  | "reconciliation"
  | "audit_persistence";

export type AdsApplyV2RpcBlockedReason =
  | "invalid_request"
  | "instruction_count_mismatch"
  | "invalid_store_instruction"
  | "invalid_store_projection"
  | "store_slug_collision"
  | "invalid_offer_instruction"
  | "parent_store_mismatch"
  | "unqualified_parent_store"
  | "invalid_offer_projection"
  | "integration_not_found"
  | "integration_disabled"
  | "integration_provider_mismatch"
  | "replay_metadata_mismatch"
  | "replay_evidence_mismatch"
  | "legacy_identity_collision"
  | "store_identity_mismatch"
  | "offer_kind_conflict"
  | "offer_identity_mismatch"
  | "count_mismatch"
  | "ledger_count_mismatch"
  | "ownership_not_provider_managed"
  | "stale_store_state"
  | "stale_offer_state"
  | "run_coherence_mismatch";

export type AdsApplyV2ActualCounts = AdsRefreshPersistenceActualCountsV2;

export interface AdsApplyV2FailureResponse {
  status: "failed";
  stage: AdsApplyV2FailureStage;
  reason: Exclude<AdsApplyV2FailureReason, "plan_blocked">;
}

export interface AdsApplyV2BlockedResponse {
  status: "blocked";
  stage: "provider_fetch" | "persistence_plan";
  reason: "plan_blocked";
  blockerReasonCounts: Partial<
    Record<AdsRefreshPersistenceBlockerV2["reason"], number>
  >;
}

export interface AdsApplyV2RpcBlockedResponse {
  status: "blocked";
  stage: "rpc_apply";
  reason: "rpc_blocked";
  rpcStage: AdsApplyV2RpcStage;
  rpcReason: AdsApplyV2RpcBlockedReason;
}

export interface AdsApplyV2RpcFailedResponse {
  status: "failed";
  stage: "rpc_apply";
  reason: "rpc_failed";
  rpcStage: AdsApplyV2RpcStage;
  rpcReason: "internal_failure";
}

export interface AdsApplyV2IndeterminateResponse {
  status: "indeterminate";
  stage: "rpc_apply";
  reason: "outcome_unknown";
}

export interface AdsApplyV2SuccessResponse {
  status: "committed" | "replayed_existing";
  runId: string;
  mode: AdsPersistenceModeV2;
  evaluationTimestamp: string;
  refreshedPlan: true;
  counts: {
    expected: AdsRefreshPersistencePlanCountsV2;
    actual: AdsApplyV2ActualCounts;
  };
  created: { stores: number; coupons: number };
  updated: { stores: number; coupons: number };
  noops: { stores: number; coupons: number };
  ledgerRows: number;
}

export type AdsApplyV2Response =
  | AdsApplyV2FailureResponse
  | AdsApplyV2BlockedResponse
  | AdsApplyV2RpcBlockedResponse
  | AdsApplyV2RpcFailedResponse
  | AdsApplyV2IndeterminateResponse
  | AdsApplyV2SuccessResponse;

export type AdsApplyV2RpcTransportResult =
  | { kind: "response"; value: unknown }
  | { kind: "transport_error" };
