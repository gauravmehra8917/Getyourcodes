import type {
  AffiliateSyncPreviewInputV2,
  AffiliateSyncPreviewV2,
  ImpactProviderFetchInputV2,
  ImpactProviderFetchResultV2,
  ImpactTransport,
  PersistenceBlockerReasonV2,
  PersistencePlanCountsV2,
  PersistencePlanInputV2,
  PersistencePlanV2,
} from "../_shared/affiliate-sync-v2/index.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";
import type { CatalogPlanningContextV2 } from "./catalog-planning-context.ts";
import type {
  PreparedPersistenceExecutionV2,
} from "./persistence-execution.ts";
import type { ApplyV2RpcTransportResult } from "./supabase-persistence-boundary.ts";

export interface ApplyV2RequestBody {
  integrationId?: unknown;
  execute?: unknown;
}

/** Raw apply-side policy values. The handler narrows these without coercion. */
export interface ApplyV2PublishingPolicy {
  enabled: unknown;
  minimumCouponsPerStore: unknown;
  maximumCouponsPerStore: unknown;
  minimumDealsPerStore: unknown;
  maximumDealsPerStore: unknown;
}

export interface ApplyV2DataSource {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(integrationId: string): Promise<string | null>;
  readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<ApplyV2PublishingPolicy | null>;
  loadCatalogPlanningContext(): Promise<CatalogPlanningContextV2>;
  applyPersistencePlan(
    prepared: PreparedPersistenceExecutionV2,
  ): Promise<ApplyV2RpcTransportResult>;
}

export interface ApplyV2HostDependencies {
  verifyUser(
    authorization: string,
    jwt: string,
  ): Promise<{ id: string } | null>;
  createDataSource(): ApplyV2DataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(
    credentials: ImpactHostCredentialsV2,
    approvedCredentialOrigin: string,
  ): ImpactTransport;
  retrieveImpact(
    input: ImpactProviderFetchInputV2,
  ): Promise<ImpactProviderFetchResultV2>;
  previewPlan(input: AffiliateSyncPreviewInputV2): AffiliateSyncPreviewV2;
  persistencePlan(input: PersistencePlanInputV2): PersistencePlanV2;
  prepareExecution(
    plan: PersistencePlanV2,
    triggeredBy: string,
  ): Promise<PreparedPersistenceExecutionV2>;
  now(): Date;
  siteUrl: string | null;
}

export type ApplyV2FailureStage =
  | "cors"
  | "auth"
  | "integration_load"
  | "credential_load"
  | "provider_fetch"
  | "catalog_snapshot"
  | "preview_plan"
  | "persistence_plan"
  | "fingerprint"
  | "rpc_apply"
  | "response";

export type ApplyV2FailureReason =
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
  | "provider_fetch_failed"
  | "malformed_provider_response"
  | "catalog_snapshot_failed"
  | "preview_plan_failed"
  | "persistence_plan_failed"
  | "plan_blocked"
  | "fingerprint_failed"
  | "rpc_blocked"
  | "rpc_failed"
  | "outcome_unknown"
  | "response_failed";

export interface ApplyV2FailureResponse {
  status: "failed";
  stage: ApplyV2FailureStage;
  reason: ApplyV2FailureReason;
}

export interface ApplyV2IndeterminateResponse {
  status: "indeterminate";
  stage: "rpc_apply";
  reason: "outcome_unknown";
}

export interface ApplyV2PlannerBlockedResponse {
  status: "blocked";
  stage: "persistence_plan";
  reason: "plan_blocked";
  blockerReasonCounts: Partial<Record<PersistenceBlockerReasonV2, number>>;
}

export interface ApplyV2RpcBlockedResponse {
  status: "blocked";
  stage: "rpc_apply";
  reason: "rpc_blocked";
  rpcStage: ApplyV2RpcStage;
  rpcReason: ApplyV2RpcBlockedReason;
}

export interface ApplyV2RpcFailedResponse {
  status: "failed";
  stage: "rpc_apply";
  reason: "rpc_failed";
  rpcStage: ApplyV2RpcStage;
  rpcReason: "internal_failure";
}

export type ApplyV2RpcStage =
  | "request_validation"
  | "replay_resolution"
  | "store_revalidation"
  | "store_insert"
  | "offer_revalidation"
  | "offer_insert"
  | "reconciliation"
  | "audit_persistence";

export type ApplyV2RpcBlockedReason =
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
  | "incompatible_store"
  | "store_identity_mismatch"
  | "offer_kind_conflict"
  | "offer_identity_mismatch"
  | "count_mismatch"
  | "ledger_count_mismatch";

export interface ApplyV2ActualCounts {
  storesCreated: number;
  storesNoopExisting: number;
  offersCreated: number;
  offersNoopExisting: number;
  ledgerRows: number;
}

export interface ApplyV2SuccessResponse {
  status: "committed" | "replayed_existing";
  runId: string;
  evaluationTimestamp: string;
  refreshedPlan: true;
  counts: {
    expected: PersistencePlanCountsV2;
    actual: ApplyV2ActualCounts;
  };
  created: { stores: number; offers: number };
  noops: { stores: number; offers: number };
  ledgerRows: number;
}

export type ApplyV2Response =
  | ApplyV2FailureResponse
  | ApplyV2IndeterminateResponse
  | ApplyV2PlannerBlockedResponse
  | ApplyV2RpcBlockedResponse
  | ApplyV2RpcFailedResponse
  | ApplyV2SuccessResponse;
