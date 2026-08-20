import type {
  ImpactProviderFetchResultV2,
  PersistenceBlockerReasonV2,
  PersistencePlanCountsV2,
} from "../_shared/affiliate-sync-v2/index.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
  parseImpactHostCredentials,
  resolveImpactHostConfig,
} from "../affiliate-sync-preview-v2/impact-configuration.ts";
import type {
  StoredPublishingPolicyV2,
} from "../affiliate-sync-preview-v2/types.ts";
import {
  persistenceRpcArgs,
  type PreparedPersistenceExecutionV2,
} from "./persistence-execution.ts";
import type {
  ApplyV2ActualCounts,
  ApplyV2FailureReason,
  ApplyV2FailureStage,
  ApplyV2HostDependencies,
  ApplyV2PublishingPolicy,
  ApplyV2Response,
  ApplyV2RpcBlockedReason,
  ApplyV2RpcStage,
  ApplyV2SuccessResponse,
} from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_APPLY_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);
const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
const ALLOWED_METHODS = "POST, OPTIONS";

const PLANNER_BLOCKER_REASONS = new Set<PersistenceBlockerReasonV2>([
  "unsupported_provider",
  "invalid_context",
  "preview_not_complete",
  "identity_collapse_detected",
  "duplicate_store_identity",
  "duplicate_offer_identity",
  "ambiguous_store_snapshot",
  "invalid_store_projection",
  "store_slug_collision",
  "invalid_offer_projection",
  "offer_kind_conflict",
  "missing_parent_store",
  "unqualified_parent_store",
  "inconsistent_existing_store",
  "inconsistent_existing_offer",
  "invalid_preview_action",
  "instruction_count_mismatch",
]);

const RPC_STAGES = new Set<ApplyV2RpcStage>([
  "request_validation",
  "replay_resolution",
  "store_revalidation",
  "store_insert",
  "offer_revalidation",
  "offer_insert",
  "reconciliation",
  "audit_persistence",
]);

const RPC_BLOCKED_REASONS = new Set<ApplyV2RpcBlockedReason>([
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
  "incompatible_store",
  "store_identity_mismatch",
  "offer_kind_conflict",
  "offer_identity_mismatch",
  "count_mismatch",
  "ledger_count_mismatch",
]);

function normalizedSiteOrigin(siteUrl: string | null): string | null {
  if (siteUrl === null) return null;
  try {
    const url = new URL(siteUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin === "null"
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function approvedOrigin(
  origin: string | null,
  siteUrl: string | null,
): boolean {
  if (!origin || origin === "null") return false;
  if (siteUrl === null) return LOCAL_APPLY_ORIGINS.has(origin);
  const siteOrigin = normalizedSiteOrigin(siteUrl);
  if (siteOrigin === null) return false;
  return origin === siteOrigin || LOCAL_APPLY_ORIGINS.has(origin);
}

function corsHeaders(origin: string | null, allowed: boolean): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed && origin ? origin : "null",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    Vary: "Origin",
  };
}

function jsonResponse(
  body: ApplyV2Response | null,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, allowed),
  });
}

function failed(
  stage: ApplyV2FailureStage,
  reason: ApplyV2FailureReason,
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

function strictBearer(authorization: string): string | null {
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function exactRequest(value: unknown): {
  integrationId: string;
  execute: true;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 || keys[0] !== "execute" || keys[1] !== "integrationId"
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.integrationId !== "string" ||
    !UUID_PATTERN.test(record.integrationId) || record.execute !== true
  ) return null;
  return { integrationId: record.integrationId.toLowerCase(), execute: true };
}

function fetchFailureReason(
  result: ImpactProviderFetchResultV2,
): "provider_fetch_failed" | "malformed_provider_response" | null {
  const streams = [
    result.fetchDiagnostics.promotions,
    result.fetchDiagnostics.campaigns,
  ];
  if (
    streams.every((stream) =>
      stream.stopReason === "completed" && stream.parseFailureReason === null
    )
  ) return null;
  if (
    streams.some((stream) =>
      stream.stopReason === "malformed_page" ||
      stream.parseFailureReason !== null
    )
  ) return "malformed_provider_response";
  return "provider_fetch_failed";
}

function plannerBlockerCounts(
  blockers: unknown,
): Partial<Record<PersistenceBlockerReasonV2, number>> | null {
  if (!Array.isArray(blockers)) return null;
  const counts: Partial<Record<PersistenceBlockerReasonV2, number>> = {};
  for (const blocker of blockers) {
    if (
      !isRecord(blocker) || typeof blocker.reason !== "string" ||
      !PLANNER_BLOCKER_REASONS.has(blocker.reason as PersistenceBlockerReasonV2)
    ) return null;
    const reason = blocker.reason as PersistenceBlockerReasonV2;
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

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

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Number.isInteger(value) && value >= 0;
}

type PublishingPolicyValidation =
  | { valid: true; policy: StoredPublishingPolicyV2 | null }
  | { valid: false };

function validatedPublishingPolicy(
  value: ApplyV2PublishingPolicy | null,
): PublishingPolicyValidation {
  if (value === null) return { valid: true, policy: null };
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "enabled",
      "minimumCouponsPerStore",
      "maximumCouponsPerStore",
      "minimumDealsPerStore",
      "maximumDealsPerStore",
    ]) || (value.enabled !== true && value.enabled !== false)
  ) return { valid: false };

  // Disabled and absent policies have the same settled pass-through behavior.
  // Do not coerce or forward unused raw numeric values from a disabled row.
  if (value.enabled === false) return { valid: true, policy: null };
  if (
    !nonnegativeInteger(value.minimumCouponsPerStore) ||
    !nonnegativeInteger(value.maximumCouponsPerStore) ||
    !nonnegativeInteger(value.minimumDealsPerStore) ||
    !nonnegativeInteger(value.maximumDealsPerStore)
  ) return { valid: false };

  return {
    valid: true,
    policy: {
      enabled: true,
      minimumCouponsPerStore: value.minimumCouponsPerStore,
      maximumCouponsPerStore: value.maximumCouponsPerStore,
      minimumDealsPerStore: value.minimumDealsPerStore,
      maximumDealsPerStore: value.maximumDealsPerStore,
    },
  };
}

function validExpectedCounts(
  value: unknown,
): value is PersistencePlanCountsV2 {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "stores",
      "offers",
      "writableStores",
      "writableOffers",
      "writableEntities",
    ])
  ) return false;
  if (
    !isRecord(value.stores) || !hasExactKeys(value.stores, [
      "create",
      "noopExisting",
      "blockedAmbiguous",
      "noopUnmatched",
    ])
  ) return false;
  if (
    !isRecord(value.offers) || !hasExactKeys(value.offers, [
      "create",
      "noopExisting",
      "noopHeld",
      "noopUnresolved",
    ])
  ) return false;
  const storeCreate = value.stores.create;
  const storeNoop = value.stores.noopExisting;
  const offerCreate = value.offers.create;
  const offerNoop = value.offers.noopExisting;
  const writableStores = value.writableStores;
  const writableOffers = value.writableOffers;
  const writableEntities = value.writableEntities;
  if (
    !nonnegativeInteger(storeCreate) || !nonnegativeInteger(storeNoop) ||
    !nonnegativeInteger(value.stores.blockedAmbiguous) ||
    !nonnegativeInteger(value.stores.noopUnmatched) ||
    !nonnegativeInteger(offerCreate) || !nonnegativeInteger(offerNoop) ||
    !nonnegativeInteger(value.offers.noopHeld) ||
    !nonnegativeInteger(value.offers.noopUnresolved) ||
    !nonnegativeInteger(writableStores) ||
    !nonnegativeInteger(writableOffers) ||
    !nonnegativeInteger(writableEntities)
  ) return false;
  return value.stores.blockedAmbiguous === 0 &&
    writableStores === storeCreate &&
    writableOffers === offerCreate &&
    writableEntities === writableStores + writableOffers &&
    storeCreate + storeNoop <= 2_147_483_647 &&
    offerCreate + offerNoop + value.offers.noopHeld +
          value.offers.noopUnresolved <= 2_147_483_647 &&
    writableStores + writableOffers <= 2_147_483_647 &&
    storeCreate + storeNoop + value.stores.noopUnmatched + offerCreate +
          offerNoop + value.offers.noopHeld + value.offers.noopUnresolved <=
      2_147_483_647;
}

function validActualCounts(value: unknown): value is ApplyV2ActualCounts {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "storesCreated",
      "storesNoopExisting",
      "offersCreated",
      "offersNoopExisting",
      "ledgerRows",
    ])
  ) return false;
  return nonnegativeInteger(value.storesCreated) &&
    nonnegativeInteger(value.storesNoopExisting) &&
    nonnegativeInteger(value.offersCreated) &&
    nonnegativeInteger(value.offersNoopExisting) &&
    nonnegativeInteger(value.ledgerRows);
}

function sameExpectedCounts(
  left: PersistencePlanCountsV2,
  right: PersistencePlanCountsV2,
): boolean {
  return left.stores.create === right.stores.create &&
    left.stores.noopExisting === right.stores.noopExisting &&
    left.stores.blockedAmbiguous === right.stores.blockedAmbiguous &&
    left.stores.noopUnmatched === right.stores.noopUnmatched &&
    left.offers.create === right.offers.create &&
    left.offers.noopExisting === right.offers.noopExisting &&
    left.offers.noopHeld === right.offers.noopHeld &&
    left.offers.noopUnresolved === right.offers.noopUnresolved &&
    left.writableStores === right.writableStores &&
    left.writableOffers === right.writableOffers &&
    left.writableEntities === right.writableEntities;
}

function sameInstant(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function indeterminateRpcResult(): ApplyV2Response {
  return {
    status: "indeterminate",
    stage: "rpc_apply",
    reason: "outcome_unknown",
  };
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameNullableUuid(value: unknown, expected: string | null): boolean {
  if (expected === null) return value === null;
  return validUuid(value) && sameUuid(value, expected);
}

function canonicalProviderId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value === value.trim();
}

interface CreatedEvidence {
  entityId: string;
  providerEntityId: string;
}

function createdEvidence(value: unknown): CreatedEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const result: CreatedEvidence[] = [];
  const entityIds = new Set<string>();
  const providerEntityIds = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["entityId", "providerEntityId"]) ||
      !validUuid(entry.entityId) ||
      !canonicalProviderId(entry.providerEntityId)
    ) return null;
    const entityIdKey = entry.entityId.toLowerCase();
    if (
      entityIds.has(entityIdKey) ||
      providerEntityIds.has(entry.providerEntityId)
    ) return null;
    entityIds.add(entityIdKey);
    providerEntityIds.add(entry.providerEntityId);
    result.push({
      entityId: entry.entityId,
      providerEntityId: entry.providerEntityId,
    });
  }
  return result;
}

interface LedgerEvidence extends CreatedEvidence {
  instructionOrdinal: number;
  entityKind: "store" | "offer";
  plannedAction: "create" | "noop_existing";
  outcome: "created" | "noop_existing";
  provider: "impact";
  expectedEntityId: string | null;
  parentProviderEntityId: string | null;
  parentEntityId: string | null;
  offerKind: "coupon" | "deal" | null;
}

function validSuccessEvidence(
  ledgerValue: unknown,
  createdStoresValue: unknown,
  createdOffersValue: unknown,
  noops: Record<string, unknown>,
  actual: ApplyV2ActualCounts,
  prepared: PreparedPersistenceExecutionV2,
): boolean {
  if (!Array.isArray(ledgerValue)) return false;
  const createdStores = createdEvidence(createdStoresValue);
  const createdOffers = createdEvidence(createdOffersValue);
  if (createdStores === null || createdOffers === null) return false;

  const args = persistenceRpcArgs(prepared);
  const storeInstructions = args._store_instructions;
  const offerInstructions = args._offer_instructions;
  if (
    ledgerValue.length !== storeInstructions.length + offerInstructions.length
  ) return false;

  const ledger: LedgerEvidence[] = [];
  const ordinals = new Set<number>();
  const storeProviderIds = new Set<string>();
  const offerProviderIds = new Set<string>();
  const storeEntityIds = new Set<string>();
  const offerEntityIds = new Set<string>();
  const storeEntitiesByProvider = new Map<string, string>();

  for (let index = 0; index < ledgerValue.length; index += 1) {
    const entry = ledgerValue[index];
    if (
      !isRecord(entry) || !hasExactKeys(entry, [
        "instructionOrdinal",
        "entityKind",
        "plannedAction",
        "outcome",
        "provider",
        "providerEntityId",
        "entityId",
        "expectedEntityId",
        "parentProviderEntityId",
        "parentEntityId",
        "offerKind",
      ]) ||
      !nonnegativeInteger(entry.instructionOrdinal) ||
      entry.instructionOrdinal !== index ||
      ordinals.has(entry.instructionOrdinal) ||
      (entry.outcome !== "created" && entry.outcome !== "noop_existing") ||
      entry.provider !== "impact" ||
      !canonicalProviderId(entry.providerEntityId) ||
      !validUuid(entry.entityId)
    ) return false;
    ordinals.add(entry.instructionOrdinal);

    const isStore = index < storeInstructions.length;
    const storeInstruction = isStore ? storeInstructions[index] : undefined;
    const offerInstruction = isStore
      ? undefined
      : offerInstructions[index - storeInstructions.length];
    const instruction = storeInstruction ?? offerInstruction;
    if (!instruction) return false;
    if (
      entry.entityKind !== (isStore ? "store" : "offer") ||
      entry.plannedAction !== instruction.action ||
      entry.provider !== instruction.provider ||
      entry.providerEntityId !== instruction.providerEntityId ||
      (instruction.action === "noop_existing" &&
        entry.outcome !== "noop_existing") ||
      (entry.outcome === "created" && instruction.action !== "create")
    ) return false;

    const expectedEntityId = storeInstruction
      ? storeInstruction.expectedExistingStoreId
      : offerInstruction!.existingOfferId;
    if (
      !sameNullableUuid(entry.expectedEntityId, expectedEntityId) ||
      (expectedEntityId !== null &&
        !sameUuid(entry.entityId, expectedEntityId))
    ) return false;

    const entityIdKey = entry.entityId.toLowerCase();
    const providerIds = isStore ? storeProviderIds : offerProviderIds;
    const entityIds = isStore ? storeEntityIds : offerEntityIds;
    if (
      providerIds.has(entry.providerEntityId) || entityIds.has(entityIdKey)
    ) return false;
    providerIds.add(entry.providerEntityId);
    entityIds.add(entityIdKey);

    if (storeInstruction) {
      if (
        entry.parentProviderEntityId !== null ||
        entry.parentEntityId !== null || entry.offerKind !== null
      ) return false;
      storeEntitiesByProvider.set(entry.providerEntityId, entry.entityId);
    } else {
      if (
        entry.parentProviderEntityId !==
          offerInstruction!.parentProviderEntityId ||
        !validUuid(entry.parentEntityId) ||
        entry.offerKind !== offerInstruction!.kind
      ) return false;
      const parentEntityId = storeEntitiesByProvider.get(
        offerInstruction!.parentProviderEntityId,
      );
      if (
        parentEntityId === undefined ||
        !sameUuid(entry.parentEntityId, parentEntityId) ||
        (offerInstruction!.expectedParentStoreId !== null &&
          !sameUuid(
            entry.parentEntityId,
            offerInstruction!.expectedParentStoreId,
          ))
      ) return false;
    }

    ledger.push({
      instructionOrdinal: entry.instructionOrdinal,
      entityKind: entry.entityKind as "store" | "offer",
      plannedAction: entry.plannedAction as "create" | "noop_existing",
      outcome: entry.outcome,
      provider: "impact",
      providerEntityId: entry.providerEntityId,
      entityId: entry.entityId,
      expectedEntityId: entry.expectedEntityId as string | null,
      parentProviderEntityId: entry.parentProviderEntityId as string | null,
      parentEntityId: entry.parentEntityId as string | null,
      offerKind: entry.offerKind as "coupon" | "deal" | null,
    });
  }

  const ledgerCreatedStores = ledger.filter((entry) =>
    entry.entityKind === "store" && entry.outcome === "created"
  );
  const ledgerCreatedOffers = ledger.filter((entry) =>
    entry.entityKind === "offer" && entry.outcome === "created"
  );
  const storesNoop =
    ledger.filter((entry) =>
      entry.entityKind === "store" && entry.outcome === "noop_existing"
    ).length;
  const offersNoop =
    ledger.filter((entry) =>
      entry.entityKind === "offer" && entry.outcome === "noop_existing"
    ).length;

  if (
    ledgerCreatedStores.length !== actual.storesCreated ||
    storesNoop !== actual.storesNoopExisting ||
    ledgerCreatedOffers.length !== actual.offersCreated ||
    offersNoop !== actual.offersNoopExisting ||
    ledger.length !== actual.ledgerRows ||
    noops.stores !== storesNoop || noops.offers !== offersNoop ||
    createdStores.length !== ledgerCreatedStores.length ||
    createdOffers.length !== ledgerCreatedOffers.length
  ) return false;

  for (let index = 0; index < createdStores.length; index += 1) {
    const created = createdStores[index]!;
    const evidence = ledgerCreatedStores[index]!;
    if (
      created.providerEntityId !== evidence.providerEntityId ||
      !sameUuid(created.entityId, evidence.entityId)
    ) return false;
  }
  for (let index = 0; index < createdOffers.length; index += 1) {
    const created = createdOffers[index]!;
    const evidence = ledgerCreatedOffers[index]!;
    if (
      created.providerEntityId !== evidence.providerEntityId ||
      !sameUuid(created.entityId, evidence.entityId)
    ) return false;
  }
  return true;
}

function safeRpcResult(
  value: unknown,
  prepared: PreparedPersistenceExecutionV2,
): ApplyV2Response {
  if (!isRecord(value) || typeof value.status !== "string") {
    return indeterminateRpcResult();
  }
  if (value.status === "blocked") {
    if (
      !hasExactKeys(value, ["status", "stage", "reason"]) ||
      typeof value.stage !== "string" ||
      !RPC_STAGES.has(value.stage as ApplyV2RpcStage) ||
      typeof value.reason !== "string" ||
      !RPC_BLOCKED_REASONS.has(value.reason as ApplyV2RpcBlockedReason)
    ) {
      return indeterminateRpcResult();
    }
    return {
      status: "blocked",
      stage: "rpc_apply",
      reason: "rpc_blocked",
      rpcStage: value.stage as ApplyV2RpcStage,
      rpcReason: value.reason as ApplyV2RpcBlockedReason,
    };
  }
  if (value.status === "failed") {
    if (
      !hasExactKeys(value, ["status", "stage", "reason"]) ||
      typeof value.stage !== "string" ||
      !RPC_STAGES.has(value.stage as ApplyV2RpcStage) ||
      value.reason !== "internal_failure"
    ) {
      return indeterminateRpcResult();
    }
    return {
      status: "failed",
      stage: "rpc_apply",
      reason: "rpc_failed",
      rpcStage: value.stage as ApplyV2RpcStage,
      rpcReason: "internal_failure",
    };
  }
  if (value.status !== "committed" && value.status !== "replayed_existing") {
    return indeterminateRpcResult();
  }
  if (
    !hasExactKeys(value, [
      "status",
      "runId",
      "provider",
      "integrationId",
      "persistenceContractVersion",
      "planFingerprintAlgorithm",
      "planFingerprint",
      "evaluationTimestamp",
      "counts",
      "createdStores",
      "createdOffers",
      "noops",
      "ledger",
    ])
  ) {
    return indeterminateRpcResult();
  }

  const args = persistenceRpcArgs(prepared);
  if (
    typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId) ||
    value.provider !== args._provider ||
    value.integrationId !== args._integration_id ||
    value.persistenceContractVersion !== args._persistence_contract_version ||
    value.planFingerprintAlgorithm !== args._plan_fingerprint_algorithm ||
    value.planFingerprint !== args._plan_fingerprint ||
    !sameInstant(value.evaluationTimestamp, args._evaluation_timestamp) ||
    !isRecord(value.counts) ||
    !hasExactKeys(value.counts, ["expected", "actual"]) ||
    !validExpectedCounts(value.counts.expected) ||
    !sameExpectedCounts(value.counts.expected, args._expected_counts) ||
    !validActualCounts(value.counts.actual) ||
    !isRecord(value.noops) ||
    !hasExactKeys(value.noops, ["stores", "offers"]) ||
    !nonnegativeInteger(value.noops.stores) ||
    !nonnegativeInteger(value.noops.offers)
  ) {
    return indeterminateRpcResult();
  }

  const expected = value.counts.expected;
  const actual = value.counts.actual;
  if (
    !validSuccessEvidence(
      value.ledger,
      value.createdStores,
      value.createdOffers,
      value.noops,
      actual,
      prepared,
    ) ||
    actual.ledgerRows !== actual.storesCreated + actual.storesNoopExisting +
        actual.offersCreated + actual.offersNoopExisting ||
    actual.storesCreated + actual.storesNoopExisting !==
      expected.stores.create + expected.stores.noopExisting ||
    actual.offersCreated + actual.offersNoopExisting !==
      expected.offers.create + expected.offers.noopExisting ||
    actual.storesCreated > expected.stores.create ||
    actual.storesNoopExisting < expected.stores.noopExisting ||
    actual.offersCreated > expected.offers.create ||
    actual.offersNoopExisting < expected.offers.noopExisting
  ) {
    return indeterminateRpcResult();
  }

  const response: ApplyV2SuccessResponse = {
    status: value.status,
    runId: value.runId,
    evaluationTimestamp: args._evaluation_timestamp,
    refreshedPlan: true,
    counts: { expected, actual },
    created: { stores: actual.storesCreated, offers: actual.offersCreated },
    noops: {
      stores: actual.storesNoopExisting,
      offers: actual.offersNoopExisting,
    },
    ledgerRows: actual.ledgerRows,
  };
  return response;
}

export function createAffiliateSyncApplyV2Handler(
  dependencies: ApplyV2HostDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const originAllowed = approvedOrigin(origin, dependencies.siteUrl);
    if (!originAllowed) {
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
    if (!jwt) return failed("auth", "unauthenticated", 401, origin, true);

    let user: { id: string } | null;
    try {
      user = await dependencies.verifyUser(authorization, jwt);
    } catch {
      user = null;
    }
    if (!user || !UUID_PATTERN.test(user.id)) {
      return failed("auth", "unauthenticated", 401, origin, true);
    }

    let dataSource: ReturnType<ApplyV2HostDependencies["createDataSource"]>;
    try {
      dataSource = dependencies.createDataSource();
      if (!await dataSource.hasAdminRole(user.id)) {
        return failed("auth", "unauthorized", 403, origin, true);
      }
    } catch {
      return failed("auth", "unauthorized", 403, origin, true);
    }

    let parsed: ReturnType<typeof exactRequest>;
    try {
      parsed = exactRequest(await request.json());
    } catch {
      parsed = null;
    }
    if (!parsed) {
      return failed("response", "invalid_request", 400, origin, true);
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
        500,
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

    let policy: Awaited<ReturnType<typeof dataSource.readPublishingPolicy>>;
    try {
      policy = await dataSource.readPublishingPolicy(
        integration.publishingPolicyId,
      );
    } catch {
      return failed(
        "integration_load",
        "invalid_integration_config",
        500,
        origin,
        true,
      );
    }
    const policyValidation = validatedPublishingPolicy(policy);
    if (!policyValidation.valid) {
      return failed(
        "integration_load",
        "invalid_integration_config",
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
      const plaintext = await dependencies.decryptCredentialEnvelope(
        ciphertext,
      );
      credentials = parseImpactHostCredentials(plaintext);
    } catch {
      return failed(
        "credential_load",
        "credentials_unavailable",
        422,
        origin,
        true,
      );
    }

    let resolved: ReturnType<typeof resolveImpactHostConfig>;
    try {
      resolved = resolveImpactHostConfig(
        integration,
        credentials,
        policyValidation.policy,
      );
    } catch (error) {
      const reason = error instanceof HostConfigurationError &&
          error.code === "credentials_unavailable"
        ? "credentials_unavailable"
        : "invalid_integration_config";
      const stage = reason === "credentials_unavailable"
        ? "credential_load"
        : "integration_load";
      return failed(stage, reason, 422, origin, true);
    }

    let fetched: ImpactProviderFetchResultV2;
    try {
      const transport = dependencies.createImpactTransport(
        credentials,
        resolved.baseUrl,
      );
      fetched = await dependencies.retrieveImpact({
        transport,
        promotionsInitialUrl: resolved.promotionsInitialUrl,
        campaignsInitialUrl: resolved.campaignsInitialUrl,
        continuationPolicy: resolved.continuationPolicy,
        limits: resolved.limits,
        requestTimeoutMs: resolved.requestTimeoutMs,
        signal: request.signal,
      });
    } catch {
      return failed(
        "provider_fetch",
        "provider_fetch_failed",
        502,
        origin,
        true,
      );
    }
    const fetchFailure = fetchFailureReason(fetched);
    if (fetchFailure) {
      return failed("provider_fetch", fetchFailure, 502, origin, true);
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

    let preview: ReturnType<ApplyV2HostDependencies["previewPlan"]>;
    try {
      preview = dependencies.previewPlan({
        acceptedPromotions: fetched.acceptedPromotions,
        acceptedCampaigns: fetched.acceptedCampaigns,
        fetchDiagnostics: fetched.fetchDiagnostics,
        quarantinedRecords: fetched.quarantinedRecords,
        existingCatalogSnapshot: catalog.existingCatalogSnapshot,
        publishingPolicyConfig: resolved.publishingPolicyConfig,
        storeQualificationConfig: resolved.storeQualificationConfig,
        evaluationTimestamp,
      });
    } catch {
      return failed("preview_plan", "preview_plan_failed", 500, origin, true);
    }

    let plan: ReturnType<ApplyV2HostDependencies["persistencePlan"]>;
    try {
      plan = dependencies.persistencePlan({
        preview,
        context: {
          integrationId: integration.id,
          provider: "impact",
          evaluationTimestamp,
          knownStoreSlugs: catalog.knownStoreSlugs,
          knownOfferKinds: catalog.knownOfferKinds,
        },
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
      const blockerReasonCounts = plannerBlockerCounts(plan.blockers);
      if (!blockerReasonCounts) {
        return failed(
          "persistence_plan",
          "persistence_plan_failed",
          500,
          origin,
          true,
        );
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

    let prepared: PreparedPersistenceExecutionV2;
    try {
      prepared = await dependencies.prepareExecution(plan, user.id);
    } catch {
      return failed("fingerprint", "fingerprint_failed", 500, origin, true);
    }

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
      return jsonResponse(
        {
          status: "indeterminate",
          stage: "rpc_apply",
          reason: "outcome_unknown",
        },
        502,
        origin,
        true,
      );
    }
    if (rpcResult.kind === "transport_error") {
      return jsonResponse(
        {
          status: "indeterminate",
          stage: "rpc_apply",
          reason: "outcome_unknown",
        },
        502,
        origin,
        true,
      );
    }

    const safe = safeRpcResult(rpcResult.value, prepared);
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
