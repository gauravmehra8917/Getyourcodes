import { parseAdsRefreshPersistenceSuccessV2 } from "./persistence-refresh-result.ts";
import {
  ImpactAdsCampaignClient,
  ImpactAdsClient,
  type ImpactAdsFetchResultV2,
  type ImpactCampaignFetchResultForAdsV2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
  parseImpactHostCredentials,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import { resolveImpactAdsApplyHostConfigV2 } from "./impact-ads-configuration.ts";
import {
  adsRefreshPersistenceRpcArgsV2,
  type PreparedAdsRefreshPersistenceExecutionV2,
} from "./persistence-refresh-execution.ts";
import type {
  AdsApplyV2BlockedResponse,
  AdsApplyV2FailureReason,
  AdsApplyV2FailureStage,
  AdsApplyV2HostDependencies,
  AdsApplyV2Response,
  AdsApplyV2RpcBlockedReason,
  AdsApplyV2RpcStage,
  AdsApplyV2SuccessResponse,
} from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ADS_APPLY_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);
const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
const ALLOWED_METHODS = "POST, OPTIONS";

const RPC_STAGES = new Set<AdsApplyV2RpcStage>([
  "request_validation",
  "replay_resolution",
  "store_revalidation",
  "store_insert",
  "store_update",
  "offer_revalidation",
  "offer_insert",
  "offer_update",
  "evidence_validation",
  "reconciliation",
  "audit_persistence",
]);
const RPC_REASONS = new Set<AdsApplyV2RpcBlockedReason>([
  "invalid_request",
  "instruction_count_mismatch",
  "invalid_store_instruction",
  "invalid_store_projection",
  "store_slug_collision",
  "invalid_offer_instruction",
  "parent_store_mismatch",
  "unqualified_parent_store",
  "invalid_offer_projection",
  "integration_not_found",
  "integration_disabled",
  "integration_provider_mismatch",
  "replay_metadata_mismatch",
  "replay_evidence_mismatch",
  "legacy_identity_collision",
  "store_identity_mismatch",
  "offer_kind_conflict",
  "offer_identity_mismatch",
  "count_mismatch",
  "ledger_count_mismatch",
  "ownership_not_provider_managed",
  "stale_store_state",
  "stale_offer_state",
  "run_coherence_mismatch",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function siteOrigin(siteUrl: string | null): string | null {
  if (siteUrl === null) return null;
  try {
    const url = new URL(siteUrl);
    return (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== "null" && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function originIsApproved(
  origin: string | null,
  siteUrl: string | null,
): boolean {
  if (!origin || origin === "null") return false;
  const configured = siteOrigin(siteUrl);
  return (configured !== null && origin === configured) ||
    LOCAL_ADS_APPLY_ORIGINS.has(origin);
}

function responseHeaders(origin: string | null, allowed: boolean): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed && origin ? origin : "null",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    Vary: "Origin",
  };
}

function jsonResponse(
  body: AdsApplyV2Response | null,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, allowed),
  });
}

function failed(
  stage: AdsApplyV2FailureStage,
  reason: Exclude<AdsApplyV2FailureReason, "plan_blocked">,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return jsonResponse(
    { status: "failed", stage, reason },
    status,
    origin,
    allowed,
  );
}

function strictBearer(value: string): string | null {
  return value.match(/^Bearer ([^\s]+)$/)?.[1] ?? null;
}

type ExactRequest =
  | { integrationId: string; execute: true; mode: "full"; canaryAdId: null }
  | {
    integrationId: string;
    execute: true;
    mode: "canary";
    canaryAdId: string;
  };

function exactRequest(value: unknown): ExactRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (value.mode === "full") {
    if (keys.join("\u0000") !== "execute\u0000integrationId\u0000mode") {
      return null;
    }
  } else if (value.mode === "canary") {
    if (
      keys.join("\u0000") !==
        "canaryAdId\u0000execute\u0000integrationId\u0000mode"
    ) {
      return null;
    }
  } else return null;
  if (
    typeof value.integrationId !== "string" ||
    !UUID_PATTERN.test(value.integrationId) || value.execute !== true
  ) return null;
  if (value.mode === "full") {
    return {
      integrationId: value.integrationId.toLowerCase(),
      execute: true,
      mode: "full",
      canaryAdId: null,
    };
  }
  if (
    typeof value.canaryAdId !== "string" || value.canaryAdId.length === 0 ||
    value.canaryAdId.length > 512 ||
    value.canaryAdId !== value.canaryAdId.trim()
  ) return null;
  return {
    integrationId: value.integrationId.toLowerCase(),
    execute: true,
    mode: "canary",
    canaryAdId: value.canaryAdId,
  };
}

function quarantineCountsReconcile(
  fetch: ImpactCampaignFetchResultForAdsV2 | ImpactAdsFetchResultV2,
): boolean {
  return Object.values(fetch.diagnostics.quarantineReasonCounts).reduce(
    (sum, count) => sum + count,
    0,
  ) === fetch.diagnostics.quarantinedRecords;
}

function completeFetch(
  fetch: ImpactCampaignFetchResultForAdsV2 | ImpactAdsFetchResultV2,
  stream: "campaigns" | "ads",
): boolean {
  const diagnostics = fetch.diagnostics;
  return diagnostics.stream === stream && diagnostics.complete &&
    diagnostics.stopReason === "completed" &&
    diagnostics.parseFailureReason === null &&
    diagnostics.recordsDiscardedByLimit === 0 &&
    diagnostics.acceptedRecords === fetch.records.length &&
    diagnostics.rawRecords ===
      diagnostics.acceptedRecords + diagnostics.quarantinedRecords &&
    quarantineCountsReconcile(fetch);
}

function providerBlocked(
  reason:
    | "campaign_fetch_incomplete"
    | "campaign_records_quarantined"
    | "ads_fetch_incomplete",
  origin: string,
): Response {
  return jsonResponse(
    {
      status: "blocked",
      stage: "provider_fetch",
      reason: "plan_blocked",
      blockerReasonCounts: { [reason]: 1 },
    },
    409,
    origin,
    true,
  );
}

function indeterminate(): AdsApplyV2Response {
  return {
    status: "indeterminate",
    stage: "rpc_apply",
    reason: "outcome_unknown",
  };
}

function safeRpcResult(
  value: unknown,
  prepared: PreparedAdsRefreshPersistenceExecutionV2,
  mode: "full" | "canary",
): AdsApplyV2Response {
  if (!isRecord(value) || typeof value.status !== "string") {
    return indeterminate();
  }
  if (value.status === "blocked") {
    if (
      !hasExactKeys(value, ["status", "stage", "reason"]) ||
      typeof value.stage !== "string" ||
      !RPC_STAGES.has(value.stage as AdsApplyV2RpcStage) ||
      typeof value.reason !== "string" ||
      !RPC_REASONS.has(value.reason as AdsApplyV2RpcBlockedReason)
    ) return indeterminate();
    return {
      status: "blocked",
      stage: "rpc_apply",
      reason: "rpc_blocked",
      rpcStage: value.stage as AdsApplyV2RpcStage,
      rpcReason: value.reason as AdsApplyV2RpcBlockedReason,
    };
  }
  if (value.status === "failed") {
    if (
      !hasExactKeys(value, ["status", "stage", "reason"]) ||
      typeof value.stage !== "string" ||
      !RPC_STAGES.has(value.stage as AdsApplyV2RpcStage) ||
      value.reason !== "internal_failure"
    ) return indeterminate();
    return {
      status: "failed",
      stage: "rpc_apply",
      reason: "rpc_failed",
      rpcStage: value.stage as AdsApplyV2RpcStage,
      rpcReason: "internal_failure",
    };
  }
  const validated = parseAdsRefreshPersistenceSuccessV2(value, prepared);
  if (!validated) return indeterminate();
  const args = adsRefreshPersistenceRpcArgsV2(prepared);
  const actual = validated.counts.actual;

  const response: AdsApplyV2SuccessResponse = {
    status: validated.status,
    runId: validated.runId,
    mode,
    evaluationTimestamp: args._evaluation_timestamp,
    refreshedPlan: true,
    counts: { expected: args._expected_counts, actual },
    created: { stores: actual.storesCreated, coupons: actual.offersCreated },
    updated: {
      stores: actual.storesUpdatedExisting,
      coupons: actual.offersUpdatedExisting,
    },
    noops: {
      stores: actual.storesNoopExisting,
      coupons: actual.offersNoopExisting,
    },
    ledgerRows: actual.ledgerRows,
  };
  return response;
}

export function createAffiliateSyncAdsApplyV2Handler(
  dependencies: AdsApplyV2HostDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const allowed = originIsApproved(origin, dependencies.siteUrl);
    if (!allowed) {
      return failed("cors", "origin_not_allowed", 403, origin, false);
    }
    if (request.method === "OPTIONS") {
      return jsonResponse(null, 204, origin, true);
    }
    if (request.method !== "POST") {
      return failed("response", "method_not_allowed", 405, origin, true);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const jwt = strictBearer(authorization);
    if (jwt === null) {
      return failed("auth", "unauthenticated", 401, origin, true);
    }
    let user: { id: string } | null;
    try {
      user = await dependencies.verifyUser(authorization, jwt);
    } catch {
      user = null;
    }
    if (!user || !UUID_PATTERN.test(user.id)) {
      return failed("auth", "unauthenticated", 401, origin, true);
    }

    let dataSource: ReturnType<AdsApplyV2HostDependencies["createDataSource"]>;
    try {
      dataSource = dependencies.createDataSource();
      if (!await dataSource.hasAdminRole(user.id)) {
        return failed("auth", "unauthorized", 403, origin, true);
      }
    } catch {
      return failed("auth", "unauthorized", 403, origin, true);
    }

    let parsed: ExactRequest | null;
    try {
      parsed = exactRequest(await request.json());
    } catch {
      parsed = null;
    }
    if (!parsed) return failed("request", "invalid_request", 400, origin, true);

    const normalizedSiteOrigin = siteOrigin(dependencies.siteUrl);
    if (normalizedSiteOrigin === null) {
      return failed(
        "integration_load",
        "invalid_integration_config",
        500,
        origin,
        true,
      );
    }
    let evaluationTimestamp: string;
    try {
      evaluationTimestamp = dependencies.now().toISOString();
      if (!Number.isFinite(Date.parse(evaluationTimestamp))) throw new Error();
    } catch {
      return failed("response", "response_failed", 500, origin, true);
    }

    let integration: Awaited<ReturnType<typeof dataSource.readIntegration>>;
    try {
      integration = await dataSource.readIntegration(parsed.integrationId);
    } catch {
      return failed(
        "integration_load",
        "invalid_integration_config",
        500,
        origin,
        true,
      );
    }
    if (!integration) {
      return failed(
        "integration_load",
        "integration_not_found",
        404,
        origin,
        true,
      );
    }
    if (
      !UUID_PATTERN.test(integration.id) ||
      integration.id.toLowerCase() !== parsed.integrationId
    ) {
      return failed(
        "integration_load",
        "invalid_integration_config",
        422,
        origin,
        true,
      );
    }
    if (!integration.isEnabled) {
      return failed(
        "integration_load",
        "integration_disabled",
        409,
        origin,
        true,
      );
    }
    try {
      assertImpactProvider(integration.providerName);
    } catch {
      return failed(
        "integration_load",
        "provider_not_impact",
        422,
        origin,
        true,
      );
    }

    let credentials: ReturnType<typeof parseImpactHostCredentials>;
    try {
      const ciphertext = await dataSource.readCredentialCiphertext(
        integration.id,
      );
      if (!ciphertext) {
        throw new HostConfigurationError("credentials_unavailable");
      }
      credentials = parseImpactHostCredentials(
        await dependencies.decryptCredentialEnvelope(ciphertext),
      );
    } catch {
      return failed(
        "credential_load",
        "credentials_unavailable",
        422,
        origin,
        true,
      );
    }

    let resolved: ReturnType<typeof resolveImpactAdsApplyHostConfigV2>;
    try {
      resolved = resolveImpactAdsApplyHostConfigV2(integration, credentials);
    } catch {
      return failed(
        "integration_load",
        "invalid_integration_config",
        422,
        origin,
        true,
      );
    }
    let transport: ReturnType<
      AdsApplyV2HostDependencies["createImpactTransport"]
    >;
    try {
      transport = dependencies.createImpactTransport(
        credentials,
        resolved.baseUrl,
        Math.max(
          resolved.campaignLimits.maxResponseBytes,
          resolved.adsLimits.maxResponseBytes,
        ),
      );
    } catch {
      return failed(
        "provider_fetch",
        "provider_fetch_failed",
        502,
        origin,
        true,
      );
    }

    let campaignFetch: ImpactCampaignFetchResultForAdsV2;
    try {
      campaignFetch = await new ImpactAdsCampaignClient({
        transport,
        continuationPolicy: resolved.continuationPolicy,
        requestTimeoutMs: resolved.requestTimeoutMs,
        limits: resolved.campaignLimits,
      }).fetch(resolved.campaignsInitialUrl, request.signal);
    } catch {
      return failed(
        "provider_fetch",
        "campaign_fetch_failed",
        502,
        origin,
        true,
      );
    }
    if (!completeFetch(campaignFetch, "campaigns")) {
      return providerBlocked("campaign_fetch_incomplete", origin!);
    }
    if (campaignFetch.diagnostics.quarantinedRecords !== 0) {
      return providerBlocked("campaign_records_quarantined", origin!);
    }

    let adsFetch: ImpactAdsFetchResultV2;
    try {
      adsFetch = await new ImpactAdsClient({
        transport,
        continuationPolicy: resolved.continuationPolicy,
        requestTimeoutMs: resolved.requestTimeoutMs,
        limits: resolved.adsLimits,
      }).fetch(resolved.adsInitialUrl, request.signal);
    } catch {
      return failed(
        "provider_fetch",
        "provider_fetch_failed",
        502,
        origin,
        true,
      );
    }
    if (!completeFetch(adsFetch, "ads")) {
      return providerBlocked("ads_fetch_incomplete", origin!);
    }

    let catalog: Awaited<
      ReturnType<typeof dataSource.loadCatalogPlanningContext>
    >;
    try {
      catalog = await dataSource.loadCatalogPlanningContext();
    } catch {
      return failed(
        "catalog_snapshot",
        "catalog_snapshot_failed",
        500,
        origin,
        true,
      );
    }
    let plan: ReturnType<AdsApplyV2HostDependencies["persistencePlan"]>;
    try {
      plan = dependencies.persistencePlan({
        integrationId: integration.id,
        evaluationTimestamp,
        siteUrl: normalizedSiteOrigin,
        mode: parsed.mode,
        canaryAdId: parsed.canaryAdId,
        campaignFetch,
        adsFetch,
        catalog,
      });
    } catch {
      return failed(
        "persistence_plan",
        "persistence_plan_failed",
        500,
        origin,
        true,
      );
    }
    if (plan.status === "blocked") {
      const blockerReasonCounts:
        AdsApplyV2BlockedResponse["blockerReasonCounts"] = {};
      for (const blocker of plan.blockers) {
        blockerReasonCounts[blocker.reason] =
          (blockerReasonCounts[blocker.reason] ?? 0) + 1;
      }
      return jsonResponse(
        {
          status: "blocked",
          stage: "persistence_plan",
          reason: "plan_blocked",
          blockerReasonCounts,
        },
        409,
        origin,
        true,
      );
    }

    let prepared: PreparedAdsRefreshPersistenceExecutionV2;
    try {
      prepared = await dependencies.prepareExecution(plan, user.id);
    } catch {
      return failed("fingerprint", "fingerprint_failed", 500, origin, true);
    }

    // Deliberately the final awaited authorization check before the sole mutation call.
    try {
      if (!await dataSource.hasAdminRole(user.id)) {
        return failed("auth", "unauthorized", 403, origin, true);
      }
    } catch {
      return failed("auth", "unauthorized", 403, origin, true);
    }

    let rpcResult: Awaited<ReturnType<typeof dataSource.applyPersistencePlan>>;
    try {
      rpcResult = await dataSource.applyPersistencePlan(prepared);
    } catch {
      return jsonResponse(indeterminate(), 502, origin, true);
    }
    if (rpcResult.kind === "transport_error") {
      return jsonResponse(indeterminate(), 502, origin, true);
    }
    const safe = safeRpcResult(rpcResult.value, prepared, parsed.mode);
    const status = safe.status === "blocked"
      ? 409
      : safe.status === "failed"
      ? 500
      : safe.status === "indeterminate"
      ? 502
      : 200;
    return jsonResponse(safe, status, origin, true);
  };
}
