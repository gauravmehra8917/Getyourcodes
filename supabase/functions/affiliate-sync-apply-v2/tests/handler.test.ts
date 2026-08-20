import assert from "node:assert/strict";
import test from "node:test";
import {
  type AffiliateSyncPreviewInputV2,
  type AffiliateSyncPreviewV2,
  type ImpactProviderFetchInputV2,
  type ImpactProviderFetchResultV2,
  type ImpactStreamFetchDiagnosticsV2,
  type ImpactTransport,
  PERSISTENCE_CONTRACT_VERSION_V2,
  type PersistencePlanInputV2,
  PersistencePlannerV2,
  type PersistencePlanV2,
  PreviewPlanner,
} from "../../_shared/affiliate-sync-v2/index.ts";
import type {
  StoredIntegrationV2,
} from "../../affiliate-sync-preview-v2/types.ts";
import type { CatalogPlanningContextV2 } from "../catalog-planning-context.ts";
import { createAffiliateSyncApplyV2Handler } from "../handler.ts";
import {
  persistenceRpcArgs,
  PLAN_FINGERPRINT_ALGORITHM_V2,
  type PreparedPersistenceExecutionV2,
  preparePersistenceExecution,
  sha256Hex,
} from "../persistence-execution.ts";
import type { ApplyV2RpcTransportResult } from "../supabase-persistence-boundary.ts";
import type {
  ApplyV2DataSource,
  ApplyV2HostDependencies,
  ApplyV2PublishingPolicy,
  ApplyV2RpcBlockedReason,
  ApplyV2RpcStage,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const COLLIDING_STORE_ID = "44444444-4444-4444-8444-444444444444";
const EVALUATION_TIMESTAMP = "2026-08-20T12:34:56.000Z";
const SITE_ORIGIN = "https://admin.example";
const AUTHORIZATION = "Bearer jwt-sensitive";
const JWT = "jwt-sensitive";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "auth-token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";
const PROVIDER_RAW_SECRET = "provider-raw-sensitive";
const EXCEPTION_SECRET = "exception-sensitive";

const healthyIntegration: StoredIntegrationV2 = {
  id: INTEGRATION_ID,
  providerName: "Impact.com",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: {},
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 0,
  pageSize: 100,
  maxPages: 10,
  publishingPolicyId: null,
};

const healthyPolicy: ApplyV2PublishingPolicy = {
  enabled: true,
  minimumCouponsPerStore: 0,
  maximumCouponsPerStore: 1,
  minimumDealsPerStore: 0,
  maximumDealsPerStore: 0,
};

function streamDiagnostics(
  stream: "promotions" | "campaigns",
  acceptedRecordCount = 1,
): ImpactStreamFetchDiagnosticsV2 {
  const absentCarrier = {
    missing: acceptedRecordCount,
    null: 0,
    validOpaqueScalar: 0,
    invalidShape: 0,
    distinctValidOpaqueValues: 0,
  };
  return {
    stream,
    pagesFetched: 1,
    rawRecordCount: acceptedRecordCount,
    acceptedRecordCount,
    quarantinedRecordCount: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_promotion_id: 0,
      missing_campaign_id: 0,
    },
    ...(stream === "promotions"
      ? {
        promotionIdShapeCounts: {
          missing: acceptedRecordCount,
          null: 0,
          nonempty_string: 0,
          empty_or_whitespace_string: 0,
          number: 0,
          array: 0,
          object: 0,
          boolean: 0,
          other: 0,
        },
        promotionIdentifierCarrierDiagnostics: {
          promotionFileId: { ...absentCarrier },
          uri: {
            missing: acceptedRecordCount,
            null: 0,
            nonemptyString: 0,
            invalidShape: 0,
            distinctNonemptyValues: 0,
            promotionRetrievePathShape: 0,
            distinctPromotionRetrieveTerminalSegments: 0,
          },
          promotionIdSingular: {
            missing: 0,
            null: 0,
            validOpaqueScalar: acceptedRecordCount,
            invalidShape: 0,
            distinctValidOpaqueValues: acceptedRecordCount,
          },
          id: { ...absentCarrier },
        },
        promotionIdentityEquivalenceDiagnostics: {
          structurallyValidPromotionRecords: acceptedRecordCount,
          promotionIdAndRetrieveUriPresent: 0,
          exactPromotionIdEqualsUriTerminal: 0,
          promotionIdDiffersFromUriTerminal: 0,
          promotionIdPresentWithoutRetrieveUri: acceptedRecordCount,
          retrieveUriPresentWithoutPromotionId: 0,
          neitherPresent: 0,
          distinctPromotionIds: acceptedRecordCount,
          distinctRetrieveUriTerminalSegments: 0,
          promotionIdsMappingToMultipleUriTerminals: 0,
          uriTerminalsMappingToMultiplePromotionIds: 0,
          duplicatePromotionIdRecords: 0,
        },
      }
      : {}),
    stopReason: "completed",
    parseFailureReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  };
}

function healthyFetch(): ImpactProviderFetchResultV2 {
  const campaignProvenance = {
    stream: "campaigns" as const,
    fetchSequence: 1,
    recordIndex: 0,
    sanitizedRequestUrl: "https://api.example.invalid/campaigns?page=1",
    sanitizedSourceContinuationUrl: null,
    providerPage: "1",
    providerPageSize: "100",
  };
  const promotionProvenance = {
    stream: "promotions" as const,
    fetchSequence: 1,
    recordIndex: 0,
    sanitizedRequestUrl: "https://api.example.invalid/promotions?page=1",
    sanitizedSourceContinuationUrl: null,
    providerPage: "1",
    providerPageSize: "100",
  };
  return {
    acceptedCampaigns: [{
      campaignId: "campaign-alpha",
      advertiserId: "advertiser-alpha",
      campaignName: "Alpha Store",
      destinationUrl: "https://destination.example/alpha",
      trackingUrl: "https://tracking.example/campaign-alpha",
      raw: { privateProviderEnvelope: PROVIDER_RAW_SECRET },
      provenance: campaignProvenance,
    }],
    acceptedPromotions: [{
      promotionId: "promotion-alpha",
      advertiserId: "advertiser-alpha",
      advertiserName: "Alpha Store",
      campaignId: "campaign-alpha",
      programId: "program-alpha",
      promotionTitle: "Alpha ten percent off",
      description: "A fixture promotion",
      genericRedemptionCode: "ALPHA10",
      trackingUrl: "https://tracking.example/promotion-alpha",
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-12-31T23:59:59Z",
      raw: { privateProviderEnvelope: PROVIDER_RAW_SECRET },
      provenance: promotionProvenance,
    }],
    fetchDiagnostics: {
      promotions: streamDiagnostics("promotions"),
      campaigns: streamDiagnostics("campaigns"),
    },
    quarantinedRecords: [],
  };
}

function healthyFetchWithTwoEntities(): ImpactProviderFetchResultV2 {
  const first = healthyFetch();
  const firstCampaign = first.acceptedCampaigns[0]!;
  const firstPromotion = first.acceptedPromotions[0]!;
  return {
    ...first,
    acceptedCampaigns: [
      firstCampaign,
      {
        ...firstCampaign,
        campaignId: "campaign-beta",
        campaignName: "Beta Store",
        destinationUrl: "https://destination.example/beta",
        trackingUrl: "https://tracking.example/campaign-beta",
        provenance: { ...firstCampaign.provenance, recordIndex: 1 },
      },
    ],
    acceptedPromotions: [
      firstPromotion,
      {
        ...firstPromotion,
        promotionId: "promotion-beta",
        campaignId: "campaign-beta",
        promotionTitle: "Beta ten percent off",
        genericRedemptionCode: "BETA10",
        trackingUrl: "https://tracking.example/promotion-beta",
        provenance: { ...firstPromotion.provenance, recordIndex: 1 },
      },
    ],
    fetchDiagnostics: {
      promotions: streamDiagnostics("promotions", 2),
      campaigns: streamDiagnostics("campaigns", 2),
    },
  };
}

function copyIntegration(): StoredIntegrationV2 {
  return {
    ...healthyIntegration,
    endpointConfiguration: { ...healthyIntegration.endpointConfiguration },
  };
}

function emptyCatalog(): CatalogPlanningContextV2 {
  return {
    existingCatalogSnapshot: { stores: [], offers: [] },
    knownStoreSlugs: [],
    knownOfferKinds: [],
  };
}

function validRpcValue(
  prepared: PreparedPersistenceExecutionV2,
  status: "committed" | "replayed_existing" = "committed",
): Record<string, unknown> {
  const args = persistenceRpcArgs(prepared);
  const expected = args._expected_counts;
  const evidenceUuid = (entityKind: "store" | "offer", index: number) => {
    const offset = entityKind === "store" ? 1 : 1_000_001;
    const tail = (offset + index).toString(16).padStart(12, "0");
    return `55555555-5555-4555-8555-${tail}`;
  };
  const storeLedger = args._store_instructions.map((instruction, index) => ({
    instructionOrdinal: instruction.instructionOrdinal,
    entityKind: "store",
    plannedAction: instruction.action,
    outcome: instruction.action === "create" ? "created" : "noop_existing",
    provider: "impact",
    providerEntityId: instruction.providerEntityId,
    entityId: instruction.action === "create"
      ? evidenceUuid("store", index)
      : instruction.expectedExistingStoreId!,
    expectedEntityId: instruction.expectedExistingStoreId,
    parentProviderEntityId: null,
    parentEntityId: null,
    offerKind: null,
  }));
  const storeEntities = new Map(
    storeLedger.map((entry) => [entry.providerEntityId, entry.entityId]),
  );
  const offerLedger = args._offer_instructions.map((instruction, index) => ({
    instructionOrdinal: instruction.instructionOrdinal,
    entityKind: "offer",
    plannedAction: instruction.action,
    outcome: instruction.action === "create" ? "created" : "noop_existing",
    provider: "impact",
    providerEntityId: instruction.providerEntityId,
    entityId: instruction.action === "create"
      ? evidenceUuid("offer", index)
      : instruction.existingOfferId!,
    expectedEntityId: instruction.existingOfferId,
    parentProviderEntityId: instruction.parentProviderEntityId,
    parentEntityId: storeEntities.get(instruction.parentProviderEntityId)!,
    offerKind: instruction.kind,
  }));
  const ledger = [...storeLedger, ...offerLedger];
  const createdStores = storeLedger.filter((entry) =>
    entry.outcome === "created"
  ).map((entry) => ({
    entityId: entry.entityId,
    providerEntityId: entry.providerEntityId,
  }));
  const createdOffers = offerLedger.filter((entry) =>
    entry.outcome === "created"
  ).map((entry) => ({
    entityId: entry.entityId,
    providerEntityId: entry.providerEntityId,
  }));
  const actual = {
    storesCreated: createdStores.length,
    storesNoopExisting: storeLedger.length - createdStores.length,
    offersCreated: createdOffers.length,
    offersNoopExisting: offerLedger.length - createdOffers.length,
    ledgerRows: ledger.length,
  };
  return {
    status,
    runId: RUN_ID,
    provider: args._provider,
    integrationId: args._integration_id,
    persistenceContractVersion: args._persistence_contract_version,
    planFingerprintAlgorithm: args._plan_fingerprint_algorithm,
    planFingerprint: args._plan_fingerprint,
    evaluationTimestamp: args._evaluation_timestamp,
    counts: { expected, actual },
    createdStores,
    createdOffers,
    noops: {
      stores: actual.storesNoopExisting,
      offers: actual.offersNoopExisting,
    },
    ledger,
  };
}

class FakeDataSource implements ApplyV2DataSource {
  readonly operations: string[] = [];
  readonly roleUserIds: string[] = [];
  readonly integrationIds: string[] = [];
  readonly credentialIntegrationIds: string[] = [];
  readonly policyIds: Array<string | null> = [];
  readonly rpcCalls: PreparedPersistenceExecutionV2[] = [];

  roleResults: Array<boolean | Error> = [true, true];
  integration: StoredIntegrationV2 | null = copyIntegration();
  credentialCiphertext: string | null = CIPHERTEXT;
  publishingPolicy: ApplyV2PublishingPolicy | null = {
    ...healthyPolicy,
  };
  catalog = emptyCatalog();
  integrationError: Error | null = null;
  credentialError: Error | null = null;
  policyError: Error | null = null;
  catalogError: Error | null = null;
  rpcImplementation: (
    prepared: PreparedPersistenceExecutionV2,
  ) => Promise<ApplyV2RpcTransportResult> = async (prepared) => ({
    kind: "response",
    value: validRpcValue(prepared),
  });

  private roleIndex = 0;

  async hasAdminRole(userId: string): Promise<boolean> {
    this.operations.push("read:user_roles");
    this.roleUserIds.push(userId);
    const result = this.roleResults[this.roleIndex] ??
      this.roleResults[this.roleResults.length - 1] ?? true;
    this.roleIndex += 1;
    if (result instanceof Error) throw result;
    return result;
  }

  async readIntegration(
    integrationId: string,
  ): Promise<StoredIntegrationV2 | null> {
    this.operations.push("read:affiliate_integrations");
    this.integrationIds.push(integrationId);
    if (this.integrationError) throw this.integrationError;
    return this.integration;
  }

  async readCredentialCiphertext(
    integrationId: string,
  ): Promise<string | null> {
    this.operations.push("read:affiliate_integration_credentials");
    this.credentialIntegrationIds.push(integrationId);
    if (this.credentialError) throw this.credentialError;
    return this.credentialCiphertext;
  }

  async readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<ApplyV2PublishingPolicy | null> {
    this.operations.push("read:publishing_policies");
    this.policyIds.push(publishingPolicyId);
    if (this.policyError) throw this.policyError;
    return this.publishingPolicy;
  }

  async loadCatalogPlanningContext() {
    this.operations.push("read:catalog_snapshot");
    if (this.catalogError) throw this.catalogError;
    return this.catalog;
  }

  async applyPersistencePlan(
    prepared: PreparedPersistenceExecutionV2,
  ): Promise<ApplyV2RpcTransportResult> {
    this.operations.push("rpc:apply_affiliate_persistence_plan_v2");
    this.rpcCalls.push(prepared);
    return await this.rpcImplementation(prepared);
  }
}

interface FixtureOptions {
  dataSource?: FakeDataSource;
  siteUrl?: string | null;
  user?: { id: string } | null;
  verifyError?: Error;
  createDataSourceError?: Error;
  decrypt?: (ciphertext: string) => Promise<string>;
  now?: () => Date;
  retrieve?: (
    input: ImpactProviderFetchInputV2,
  ) => Promise<ImpactProviderFetchResultV2>;
  previewPlan?: (
    input: AffiliateSyncPreviewInputV2,
  ) => AffiliateSyncPreviewV2;
  persistencePlan?: (input: PersistencePlanInputV2) => PersistencePlanV2;
  prepareExecution?: (
    plan: PersistencePlanV2,
    triggeredBy: string,
  ) => Promise<PreparedPersistenceExecutionV2>;
}

function fixture(options: FixtureOptions = {}) {
  const dataSource = options.dataSource ?? new FakeDataSource();
  const transport: ImpactTransport = {
    async execute() {
      return { kind: "transport_error", errorCode: "unused_test_transport" };
    },
    async wait() {},
  };
  const activity = {
    verified: [] as Array<{ authorization: string; jwt: string }>,
    dataSourceCreations: 0,
    decryptions: [] as string[],
    transportCredentials: [] as Array<{
      credentials: { accountSid: string; authToken: string };
      origin: string;
    }>,
    retrievalInputs: [] as ImpactProviderFetchInputV2[],
    previewInputs: [] as AffiliateSyncPreviewInputV2[],
    persistenceInputs: [] as PersistencePlanInputV2[],
    planned: [] as PersistencePlanV2[],
    preparations: [] as Array<{
      plan: PersistencePlanV2;
      triggeredBy: string;
    }>,
    nowCalls: 0,
  };
  const deps: ApplyV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      activity.verified.push({ authorization, jwt });
      if (options.verifyError) throw options.verifyError;
      return options.user === undefined ? { id: ADMIN_ID } : options.user;
    },
    createDataSource() {
      activity.dataSourceCreations += 1;
      if (options.createDataSourceError) {
        throw options.createDataSourceError;
      }
      return dataSource;
    },
    async decryptCredentialEnvelope(ciphertext) {
      activity.decryptions.push(ciphertext);
      if (options.decrypt) return await options.decrypt(ciphertext);
      return JSON.stringify({
        accountSid: ACCOUNT_SID,
        authToken: AUTH_TOKEN,
      });
    },
    createImpactTransport(credentials, approvedCredentialOrigin) {
      activity.transportCredentials.push({
        credentials: { ...credentials },
        origin: approvedCredentialOrigin,
      });
      return transport;
    },
    async retrieveImpact(input) {
      activity.retrievalInputs.push(input);
      return options.retrieve ? await options.retrieve(input) : healthyFetch();
    },
    previewPlan(input) {
      activity.previewInputs.push(input);
      return options.previewPlan
        ? options.previewPlan(input)
        : PreviewPlanner.plan(input);
    },
    persistencePlan(input) {
      activity.persistenceInputs.push(input);
      const plan = options.persistencePlan
        ? options.persistencePlan(input)
        : PersistencePlannerV2.plan(input);
      activity.planned.push(plan);
      return plan;
    },
    async prepareExecution(plan, triggeredBy) {
      activity.preparations.push({ plan, triggeredBy });
      return options.prepareExecution
        ? await options.prepareExecution(plan, triggeredBy)
        : await preparePersistenceExecution(plan, triggeredBy);
    },
    now() {
      activity.nowCalls += 1;
      return options.now ? options.now() : new Date(EVALUATION_TIMESTAMP);
    },
    siteUrl: options.siteUrl === undefined ? SITE_ORIGIN : options.siteUrl,
  };
  return { activity, dataSource, deps };
}

interface RequestOptions {
  method?: string;
  origin?: string | null;
  authorization?: string | null;
  body?: unknown;
  rawBody?: string;
}

function applyRequest(options: RequestOptions = {}): Request {
  const method = options.method ?? "POST";
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = options.origin === undefined ? SITE_ORIGIN : options.origin;
  if (origin !== null) headers.set("Origin", origin);
  const authorization = options.authorization === undefined
    ? AUTHORIZATION
    : options.authorization;
  if (authorization !== null) headers.set("Authorization", authorization);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const value = Object.prototype.hasOwnProperty.call(options, "body")
      ? options.body
      : { integrationId: INTEGRATION_ID, execute: true };
    init.body = options.rawBody === undefined
      ? JSON.stringify(value)
      : options.rawBody;
  }
  return new Request(
    "https://edge.example/affiliate-sync-apply-v2",
    init,
  );
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function assertCors(response: Response, allowedOrigin: string): void {
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    allowedOrigin,
  );
  assert.equal(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, apikey, content-type, x-client-info",
  );
  assert.equal(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.has("Access-Control-Allow-Credentials"), false);
  assert.equal(response.headers.get("Content-Type"), "application/json");
}

function assertZeroWork(result: ReturnType<typeof fixture>): void {
  assert.deepEqual(result.activity.verified, []);
  assert.equal(result.activity.dataSourceCreations, 0);
  assert.deepEqual(result.activity.decryptions, []);
  assert.deepEqual(result.activity.transportCredentials, []);
  assert.deepEqual(result.activity.retrievalInputs, []);
  assert.deepEqual(result.activity.previewInputs, []);
  assert.deepEqual(result.activity.persistenceInputs, []);
  assert.deepEqual(result.activity.preparations, []);
  assert.equal(result.activity.nowCalls, 0);
  assert.deepEqual(result.dataSource.operations, []);
  assert.equal(result.dataSource.rpcCalls.length, 0);
}

async function assertFixedFailure(
  response: Response,
  status: number,
  stage: string,
  reason: string,
  allowedOrigin = SITE_ORIGIN,
): Promise<void> {
  assert.equal(response.status, status);
  assert.deepEqual(await body(response.clone()), {
    status: "failed",
    stage,
    reason,
  });
  assertCors(response, allowedOrigin);
}

async function assertIndeterminate(response: Response): Promise<void> {
  assert.equal(response.status, 502);
  assert.deepEqual(await body(response.clone()), {
    status: "indeterminate",
    stage: "rpc_apply",
    reason: "outcome_unknown",
  });
  assertCors(response, SITE_ORIGIN);
}

function serializedHasSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return [
    ACCOUNT_SID,
    AUTH_TOKEN,
    CIPHERTEXT,
    JWT,
    PROVIDER_RAW_SECRET,
    EXCEPTION_SECRET,
  ].some((secret) => serialized.includes(secret));
}

test("CORS admits only the normalized configured origin and exact localhost origins", async () => {
  for (
    const siteUrl of [
      "https://admin.example",
      "https://admin.example/",
      "https://admin.example/settings/integrations?source=apply",
      "https://admin.example:443/path",
    ]
  ) {
    const result = fixture({ siteUrl });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({
        method: "OPTIONS",
        origin: SITE_ORIGIN,
        authorization: null,
      }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, SITE_ORIGIN);
    assertZeroWork(result);
  }

  const http = fixture({ siteUrl: "http://admin.example/path" });
  const httpResponse = await createAffiliateSyncApplyV2Handler(http.deps)(
    applyRequest({
      method: "OPTIONS",
      origin: "http://admin.example",
      authorization: null,
    }),
  );
  assert.equal(httpResponse.status, 204);
  assertCors(httpResponse, "http://admin.example");
  assertZeroWork(http);

  for (
    const origin of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
    ]
  ) {
    const result = fixture({ siteUrl: "https://production.example/path" });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({ method: "OPTIONS", origin, authorization: null }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, origin);
    assertZeroWork(result);
  }
});

test("missing, unapproved, and deceptive origins fail closed with zero work", async () => {
  for (
    const origin of [
      null,
      "https://admin.example.evil.invalid",
      "https://evil.invalid?origin=https://admin.example",
      "http://localhost:8081",
      "https://localhost:8080",
      "http://localhost:8080.evil.invalid",
      "https://id-preview--project.lovable.app",
      "null",
      "data:text/plain,opaque",
      "file:///tmp/app.html",
      "javascript:alert(1)",
      "about:blank",
      "blob:https://admin.example/opaque-id",
    ]
  ) {
    for (const method of ["OPTIONS", "POST"]) {
      const result = fixture();
      const response = await createAffiliateSyncApplyV2Handler(result.deps)(
        applyRequest({ method, origin, authorization: null }),
      );
      await assertFixedFailure(
        response,
        403,
        "cors",
        "origin_not_allowed",
        "null",
      );
      assertZeroWork(result);
    }
  }
});

test("opaque and non-HTTP SITE_URL values cannot authorize any browser origin", async () => {
  const cases = [
    { siteUrl: "data:text/plain,opaque", origin: "null" },
    { siteUrl: "file:///tmp/app.html", origin: "null" },
    { siteUrl: "javascript:alert(1)", origin: "null" },
    { siteUrl: "about:blank", origin: "null" },
    {
      siteUrl: "blob:https://admin.example/opaque-id",
      origin: SITE_ORIGIN,
    },
  ];
  for (const { siteUrl, origin } of cases) {
    for (const method of ["OPTIONS", "POST"]) {
      const result = fixture({ siteUrl });
      const response = await createAffiliateSyncApplyV2Handler(result.deps)(
        applyRequest({ method, origin, authorization: null }),
      );
      await assertFixedFailure(
        response,
        403,
        "cors",
        "origin_not_allowed",
        "null",
      );
      assertZeroWork(result);
    }
  }
});

test("an invalid configured SITE_URL disables the localhost allowlist", async () => {
  const invalidSiteUrls = [
    "data:text/plain,opaque",
    "file:///tmp/app.html",
    "javascript:alert(1)",
    "about:blank",
    "blob:https://admin.example/opaque-id",
    "",
    "not a valid URL",
  ];
  const localhostOrigins = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ];
  for (const siteUrl of invalidSiteUrls) {
    for (const origin of localhostOrigins) {
      for (const method of ["OPTIONS", "POST"]) {
        const result = fixture({ siteUrl });
        const response = await createAffiliateSyncApplyV2Handler(result.deps)(
          applyRequest({ method, origin, authorization: null }),
        );
        await assertFixedFailure(
          response,
          403,
          "cors",
          "origin_not_allowed",
          "null",
        );
        assertZeroWork(result);
      }
    }
  }
});

test("a missing SITE_URL retains only the exact localhost allowlist", async () => {
  for (
    const origin of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
    ]
  ) {
    const result = fixture({ siteUrl: null });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({ method: "OPTIONS", origin, authorization: null }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, origin);
    assertZeroWork(result);
  }
});

test("approved preflight is empty, and every non-POST method stops before auth", async () => {
  const preflight = fixture();
  const options = await createAffiliateSyncApplyV2Handler(preflight.deps)(
    applyRequest({ method: "OPTIONS", authorization: null }),
  );
  assert.equal(options.status, 204);
  assert.equal(await options.text(), "");
  assertCors(options, SITE_ORIGIN);
  assertZeroWork(preflight);

  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const result = fixture();
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({ method, authorization: null }),
    );
    await assertFixedFailure(
      response,
      405,
      "response",
      "method_not_allowed",
    );
    assertZeroWork(result);
  }
});

test("authorization accepts only one exact Bearer token and a valid verified UUID", async () => {
  for (
    const authorization of [
      null,
      "",
      "Bearer",
      "bearer jwt-sensitive",
      "Bearer  jwt-sensitive",
      "Bearer jwt-sensitive extra",
      "Basic jwt-sensitive",
    ]
  ) {
    const result = fixture();
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({ authorization }),
    );
    await assertFixedFailure(response, 401, "auth", "unauthenticated");
    assert.deepEqual(result.activity.verified, []);
    assert.equal(result.activity.dataSourceCreations, 0);
    assert.deepEqual(result.dataSource.operations, []);
  }

  const trailingSpace = fixture();
  const realRequest = applyRequest();
  const unnormalizedRequest = {
    method: realRequest.method,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "authorization") {
          return "Bearer jwt-sensitive ";
        }
        return realRequest.headers.get(name);
      },
    },
    json: () => realRequest.json(),
    signal: realRequest.signal,
  } as unknown as Request;
  const trailingResponse = await createAffiliateSyncApplyV2Handler(
    trailingSpace.deps,
  )(unnormalizedRequest);
  await assertFixedFailure(
    trailingResponse,
    401,
    "auth",
    "unauthenticated",
  );
  assert.deepEqual(trailingSpace.activity.verified, []);

  for (
    const options of [
      { user: null },
      { user: { id: "not-a-uuid" } },
      { verifyError: new Error(`verification ${EXCEPTION_SECRET}`) },
    ] satisfies FixtureOptions[]
  ) {
    const result = fixture(options);
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(response, 401, "auth", "unauthenticated");
    assert.deepEqual(result.activity.verified, [{
      authorization: AUTHORIZATION,
      jwt: JWT,
    }]);
    assert.equal(result.activity.dataSourceCreations, 0);
    assert.deepEqual(result.dataSource.operations, []);
  }
});

test("the first administrator check precedes body parsing and all privileged reads", async () => {
  const nonAdmin = fixture();
  nonAdmin.dataSource.roleResults = [false];
  const rejected = await createAffiliateSyncApplyV2Handler(nonAdmin.deps)(
    applyRequest({ rawBody: "not-json" }),
  );
  await assertFixedFailure(rejected, 403, "auth", "unauthorized");
  assert.deepEqual(nonAdmin.dataSource.operations, ["read:user_roles"]);
  assert.deepEqual(nonAdmin.dataSource.roleUserIds, [ADMIN_ID]);
  assert.equal(nonAdmin.activity.nowCalls, 0);

  const roleFailure = fixture();
  roleFailure.dataSource.roleResults = [
    new Error(`role failure ${EXCEPTION_SECRET}`),
  ];
  const failed = await createAffiliateSyncApplyV2Handler(roleFailure.deps)(
    applyRequest(),
  );
  await assertFixedFailure(failed, 403, "auth", "unauthorized");
  assert.deepEqual(roleFailure.dataSource.operations, ["read:user_roles"]);

  const constructionFailure = fixture({
    createDataSourceError: new Error(`client failure ${EXCEPTION_SECRET}`),
  });
  const construction = await createAffiliateSyncApplyV2Handler(
    constructionFailure.deps,
  )(applyRequest());
  await assertFixedFailure(construction, 403, "auth", "unauthorized");
  assert.equal(constructionFailure.activity.dataSourceCreations, 1);
  assert.deepEqual(constructionFailure.dataSource.operations, []);
});

test("the request body is an exact two-field execute command with no client plan material", async () => {
  const invalidBodies: unknown[] = [
    null,
    false,
    true,
    0,
    1,
    "execute",
    [],
    {},
    { integrationId: INTEGRATION_ID },
    { execute: true },
    { integrationId: INTEGRATION_ID, execute: false },
    { integrationId: INTEGRATION_ID, execute: 1 },
    { integrationId: "not-a-uuid", execute: true },
    { integrationId: ` ${INTEGRATION_ID}`, execute: true },
    { integrationId: INTEGRATION_ID.toUpperCase(), execute: true, extra: null },
  ];
  for (
    const prohibited of [
      "plan",
      "preview",
      "provider",
      "credentials",
      "accountSid",
      "authToken",
      "evaluationTimestamp",
      "triggeredBy",
      "triggered_by",
      "fingerprint",
      "planFingerprint",
      "canonicalPlan",
      "canonicalPlanMaterial",
      "expectedCounts",
      "storeInstructions",
      "offerInstructions",
      "campaignId",
      "promotionId",
      "providerStoreKey",
      "minimumCouponsPerStore",
      "maximumCouponsPerStore",
      "minimumDealsPerStore",
      "maximumDealsPerStore",
      "maxCouponsPerStore",
      "maxDealsPerStore",
      "minimumSelectedCoupons",
      "minimumSelectedDeals",
      "minimumTotalSelectedOffers",
      "policy",
      "threshold",
    ]
  ) {
    invalidBodies.push({
      integrationId: INTEGRATION_ID,
      execute: true,
      [prohibited]: `${PROVIDER_RAW_SECRET}-${prohibited}`,
    });
  }

  for (const invalidBody of invalidBodies) {
    const result = fixture();
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest({ body: invalidBody }),
    );
    await assertFixedFailure(response, 400, "response", "invalid_request");
    assert.deepEqual(result.dataSource.operations, ["read:user_roles"]);
    assert.equal(result.activity.nowCalls, 0);
    assert.equal(result.dataSource.rpcCalls.length, 0);
  }

  const malformed = fixture();
  const malformedResponse = await createAffiliateSyncApplyV2Handler(
    malformed.deps,
  )(applyRequest({ rawBody: `{"private":"${PROVIDER_RAW_SECRET}"` }));
  await assertFixedFailure(
    malformedResponse,
    400,
    "response",
    "invalid_request",
  );
  assert.deepEqual(malformed.dataSource.operations, ["read:user_roles"]);

  const uppercaseUuid = fixture();
  const uppercaseResponse = await createAffiliateSyncApplyV2Handler(
    uppercaseUuid.deps,
  )(applyRequest({
    body: { integrationId: INTEGRATION_ID.toUpperCase(), execute: true },
  }));
  assert.equal(uppercaseResponse.status, 200);
  assert.deepEqual(uppercaseUuid.dataSource.integrationIds, [INTEGRATION_ID]);
});

test("clock failures are fixed responses and occur before integration access", async () => {
  for (
    const now of [
      () => {
        throw new Error(`clock failure ${EXCEPTION_SECRET}`);
      },
      () => new Date(Number.NaN),
    ]
  ) {
    const result = fixture({ now });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(response, 500, "response", "response_failed");
    assert.deepEqual(result.dataSource.operations, ["read:user_roles"]);
    assert.equal(result.activity.nowCalls, 1);
    assert.equal(serializedHasSecret(await body(response.clone())), false);
  }
});

test("integration, policy, configuration, and credential failures are precisely classified", async () => {
  const cases: Array<{
    name: string;
    configure?: (result: ReturnType<typeof fixture>) => void;
    options?: FixtureOptions;
    status: number;
    stage: string;
    reason: string;
  }> = [
    {
      name: "integration read",
      configure: (result) => {
        result.dataSource.integrationError = new Error(
          `integration ${EXCEPTION_SECRET}`,
        );
      },
      status: 500,
      stage: "integration_load",
      reason: "invalid_integration_config",
    },
    {
      name: "missing integration",
      configure: (result) => {
        result.dataSource.integration = null;
      },
      status: 404,
      stage: "integration_load",
      reason: "integration_not_found",
    },
    {
      name: "disabled integration",
      configure: (result) => {
        result.dataSource.integration = {
          ...copyIntegration(),
          isEnabled: false,
        };
      },
      status: 409,
      stage: "integration_load",
      reason: "integration_disabled",
    },
    {
      name: "wrong provider",
      configure: (result) => {
        result.dataSource.integration = {
          ...copyIntegration(),
          providerName: "Awin",
        };
      },
      status: 422,
      stage: "integration_load",
      reason: "provider_not_impact",
    },
    {
      name: "policy read",
      configure: (result) => {
        result.dataSource.policyError = new Error(`policy ${EXCEPTION_SECRET}`);
      },
      status: 500,
      stage: "integration_load",
      reason: "invalid_integration_config",
    },
    {
      name: "credential read",
      configure: (result) => {
        result.dataSource.credentialError = new Error(
          `credential ${EXCEPTION_SECRET}`,
        );
      },
      status: 422,
      stage: "credential_load",
      reason: "credentials_unavailable",
    },
    {
      name: "missing credential",
      configure: (result) => {
        result.dataSource.credentialCiphertext = null;
      },
      status: 422,
      stage: "credential_load",
      reason: "credentials_unavailable",
    },
    {
      name: "decrypt failure",
      options: {
        decrypt: async () => {
          throw new Error(`decrypt ${EXCEPTION_SECRET} ${AUTH_TOKEN}`);
        },
      },
      status: 422,
      stage: "credential_load",
      reason: "credentials_unavailable",
    },
    {
      name: "malformed credential",
      options: { decrypt: async () => `{"accountSid":"${ACCOUNT_SID}"}` },
      status: 422,
      stage: "credential_load",
      reason: "credentials_unavailable",
    },
    {
      name: "invalid authentication type",
      configure: (result) => {
        result.dataSource.integration = {
          ...copyIntegration(),
          authenticationType: "oauth2",
        };
      },
      status: 422,
      stage: "integration_load",
      reason: "invalid_integration_config",
    },
    {
      name: "unapproved endpoint",
      configure: (result) => {
        result.dataSource.integration = {
          ...copyIntegration(),
          endpointConfiguration: {
            promotions: "https://evil.invalid/private",
          },
        };
      },
      status: 422,
      stage: "integration_load",
      reason: "invalid_integration_config",
    },
  ];

  for (const entry of cases) {
    const result = fixture(entry.options);
    entry.configure?.(result);
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(
      response,
      entry.status,
      entry.stage,
      entry.reason,
    );
    const responseBody = await body(response.clone());
    assert.equal(serializedHasSecret(responseBody), false, entry.name);
    assert.equal(result.dataSource.rpcCalls.length, 0, entry.name);
  }

  const wrongProvider = fixture();
  wrongProvider.dataSource.integration = {
    ...copyIntegration(),
    providerName: "Awin",
  };
  await createAffiliateSyncApplyV2Handler(wrongProvider.deps)(applyRequest());
  assert.equal(
    wrongProvider.dataSource.operations.includes(
      "read:affiliate_integration_credentials",
    ),
    false,
  );
});

test("enabled publishing policy numbers are validated without coercion before credentials or planning", async () => {
  const fields = [
    "minimumCouponsPerStore",
    "maximumCouponsPerStore",
    "minimumDealsPerStore",
    "maximumDealsPerStore",
  ] as const;
  const malformedValues: unknown[] = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1",
    null,
    {},
    [],
  ];

  const malformedPolicies: ApplyV2PublishingPolicy[] = [];
  for (const field of fields) {
    for (const malformedValue of malformedValues) {
      malformedPolicies.push({
        ...healthyPolicy,
        [field]: malformedValue,
      });
    }
  }
  malformedPolicies.push(
    { ...healthyPolicy, enabled: "true" },
    {
      ...healthyPolicy,
      privatePolicyDetail: PROVIDER_RAW_SECRET,
    } as unknown as ApplyV2PublishingPolicy,
    {
      enabled: true,
      minimumCouponsPerStore: 0,
      maximumCouponsPerStore: 0,
      minimumDealsPerStore: 0,
    } as ApplyV2PublishingPolicy,
  );

  for (const publishingPolicy of malformedPolicies) {
    const result = fixture();
    result.dataSource.publishingPolicy = publishingPolicy;
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(
      response,
      422,
      "integration_load",
      "invalid_integration_config",
    );
    assert.deepEqual(result.dataSource.operations, [
      "read:user_roles",
      "read:affiliate_integrations",
      "read:publishing_policies",
    ]);
    assert.deepEqual(result.dataSource.credentialIntegrationIds, []);
    assert.deepEqual(result.activity.decryptions, []);
    assert.deepEqual(result.activity.transportCredentials, []);
    assert.deepEqual(result.activity.retrievalInputs, []);
    assert.deepEqual(result.activity.previewInputs, []);
    assert.deepEqual(result.activity.persistenceInputs, []);
    assert.deepEqual(result.activity.preparations, []);
    assert.equal(result.dataSource.rpcCalls.length, 0);
    assert.equal(serializedHasSecret(await body(response.clone())), false);
  }

  for (
    const publishingPolicy of [
      {
        enabled: true,
        minimumCouponsPerStore: 0,
        maximumCouponsPerStore: 0,
        minimumDealsPerStore: 0,
        maximumDealsPerStore: 0,
      },
      {
        enabled: false,
        minimumCouponsPerStore: "unused",
        maximumCouponsPerStore: null,
        minimumDealsPerStore: {},
        maximumDealsPerStore: [],
      },
    ] satisfies ApplyV2PublishingPolicy[]
  ) {
    const result = fixture();
    result.dataSource.publishingPolicy = publishingPolicy;
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    assert.equal(response.status, 200);
    assert.equal(result.dataSource.rpcCalls.length, 1);
  }
});

test("provider, catalog, preview, planner, and fingerprint failures stop before RPC", async () => {
  const transportFailure = healthyFetch();
  transportFailure.fetchDiagnostics.promotions.stopReason = "transport_error";
  const malformedFailure = healthyFetch();
  malformedFailure.fetchDiagnostics.promotions.stopReason = "malformed_page";
  malformedFailure.fetchDiagnostics.promotions.parseFailureReason =
    "missing_collection";

  const cases: Array<{
    name: string;
    options?: FixtureOptions;
    configure?: (result: ReturnType<typeof fixture>) => void;
    status: number;
    stage: string;
    reason: string;
  }> = [
    {
      name: "retrieve throws",
      options: {
        retrieve: async () => {
          throw new Error(`provider ${EXCEPTION_SECRET} ${ACCOUNT_SID}`);
        },
      },
      status: 502,
      stage: "provider_fetch",
      reason: "provider_fetch_failed",
    },
    {
      name: "transport diagnostic",
      options: { retrieve: async () => transportFailure },
      status: 502,
      stage: "provider_fetch",
      reason: "provider_fetch_failed",
    },
    {
      name: "malformed diagnostic",
      options: { retrieve: async () => malformedFailure },
      status: 502,
      stage: "provider_fetch",
      reason: "malformed_provider_response",
    },
    {
      name: "catalog",
      configure: (result) => {
        result.dataSource.catalogError = new Error(
          `catalog ${EXCEPTION_SECRET}`,
        );
      },
      status: 500,
      stage: "catalog_snapshot",
      reason: "catalog_snapshot_failed",
    },
    {
      name: "preview",
      options: {
        previewPlan: () => {
          throw new Error(`preview ${EXCEPTION_SECRET}`);
        },
      },
      status: 500,
      stage: "preview_plan",
      reason: "preview_plan_failed",
    },
    {
      name: "planner",
      options: {
        persistencePlan: () => {
          throw new Error(`planner ${EXCEPTION_SECRET}`);
        },
      },
      status: 500,
      stage: "persistence_plan",
      reason: "persistence_plan_failed",
    },
    {
      name: "fingerprint",
      options: {
        prepareExecution: async () => {
          throw new Error(`fingerprint ${EXCEPTION_SECRET}`);
        },
      },
      status: 500,
      stage: "fingerprint",
      reason: "fingerprint_failed",
    },
  ];

  for (const entry of cases) {
    const result = fixture(entry.options);
    entry.configure?.(result);
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(
      response,
      entry.status,
      entry.stage,
      entry.reason,
    );
    assert.equal(serializedHasSecret(await body(response.clone())), false);
    assert.equal(result.dataSource.rpcCalls.length, 0, entry.name);
  }
});

test("resolved Impact configuration is the sole source of provider fetch inputs", async () => {
  const result = fixture();
  const response = await createAffiliateSyncApplyV2Handler(result.deps)(
    applyRequest(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(result.activity.transportCredentials, [{
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    origin: "https://api.impact.com",
  }]);
  assert.equal(result.activity.retrievalInputs.length, 1);
  const retrieval = result.activity.retrievalInputs[0]!;
  assert.equal(
    retrieval.promotionsInitialUrl,
    `https://api.impact.com/Mediapartners/${ACCOUNT_SID}/Promotions?Page=1&PageSize=100`,
  );
  assert.equal(
    retrieval.campaignsInitialUrl,
    `https://api.impact.com/Mediapartners/${ACCOUNT_SID}/Campaigns?Page=1&PageSize=100`,
  );
  assert.equal(
    retrieval.continuationPolicy.approvedBaseUrl,
    "https://api.impact.com",
  );
  assert.deepEqual(retrieval.continuationPolicy.allowedOrigins, [
    "https://api.impact.com",
  ]);
  assert.deepEqual(retrieval.continuationPolicy.accountSidPathSegments, [
    ACCOUNT_SID,
  ]);
  assert.equal(retrieval.signal instanceof AbortSignal, true);
});

test("a real core planner blocker returns only aggregate allowlisted reasons", async () => {
  const blocked = fixture();
  blocked.dataSource.catalog = {
    existingCatalogSnapshot: { stores: [], offers: [] },
    knownStoreSlugs: [{
      storeId: COLLIDING_STORE_ID,
      slug: "alpha-store",
      providerStoreKey: null,
    }],
    knownOfferKinds: [],
  };
  const response = await createAffiliateSyncApplyV2Handler(blocked.deps)(
    applyRequest(),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await body(response), {
    status: "blocked",
    stage: "persistence_plan",
    reason: "plan_blocked",
    blockerReasonCounts: { store_slug_collision: 1 },
  });
  assertCors(response, SITE_ORIGIN);
  assert.equal(blocked.activity.planned[0]?.status, "blocked");
  assert.deepEqual(blocked.activity.preparations, []);
  assert.deepEqual(blocked.dataSource.roleUserIds, [ADMIN_ID]);
  assert.equal(blocked.dataSource.rpcCalls.length, 0);

  const malformed = fixture({
    persistencePlan: () => ({
      status: "blocked",
      blockers: [{ reason: PROVIDER_RAW_SECRET }],
    } as unknown as PersistencePlanV2),
  });
  const malformedResponse = await createAffiliateSyncApplyV2Handler(
    malformed.deps,
  )(applyRequest());
  await assertFixedFailure(
    malformedResponse,
    500,
    "persistence_plan",
    "persistence_plan_failed",
  );
  assert.equal(
    serializedHasSecret(await body(malformedResponse.clone())),
    false,
  );
  assert.equal(malformed.dataSource.rpcCalls.length, 0);
});

test("administrator authority is rechecked after hashing and immediately before RPC", async () => {
  for (
    const secondResult of [
      false,
      new Error(`second role check ${EXCEPTION_SECRET}`),
    ]
  ) {
    const result = fixture();
    result.dataSource.roleResults = [true, secondResult];
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertFixedFailure(response, 403, "auth", "unauthorized");
    assert.equal(result.activity.preparations.length, 1);
    assert.deepEqual(result.dataSource.roleUserIds, [ADMIN_ID, ADMIN_ID]);
    assert.equal(result.dataSource.rpcCalls.length, 0);
    assert.equal(
      result.dataSource.operations.at(-1),
      "read:user_roles",
    );
  }
});

test("committed and replayed outcomes are bounded and retain trusted provenance", async () => {
  for (const status of ["committed", "replayed_existing"] as const) {
    const result = fixture();
    result.dataSource.rpcImplementation = async (prepared) => {
      const value = validRpcValue(prepared, status);
      if (status === "replayed_existing") {
        value.evaluationTimestamp = "2026-08-20T18:04:56+05:30";
      }
      return { kind: "response", value };
    };
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    assert.equal(response.status, 200);
    assertCors(response, SITE_ORIGIN);
    assert.equal(result.dataSource.rpcCalls.length, 1);
    const args = persistenceRpcArgs(result.dataSource.rpcCalls[0]!);
    const actual = {
      storesCreated: args._expected_counts.stores.create,
      storesNoopExisting: args._expected_counts.stores.noopExisting,
      offersCreated: args._expected_counts.offers.create,
      offersNoopExisting: args._expected_counts.offers.noopExisting,
      ledgerRows: args._expected_counts.writableEntities,
    };
    const responseBody = await body(response);
    assert.deepEqual(responseBody, {
      status,
      runId: RUN_ID,
      evaluationTimestamp: EVALUATION_TIMESTAMP,
      refreshedPlan: true,
      counts: { expected: args._expected_counts, actual },
      created: {
        stores: actual.storesCreated,
        offers: actual.offersCreated,
      },
      noops: {
        stores: actual.storesNoopExisting,
        offers: actual.offersNoopExisting,
      },
      ledgerRows: actual.ledgerRows,
    });
    assert.equal(serializedHasSecret(responseBody), false);
    assert.deepEqual(result.dataSource.operations, [
      "read:user_roles",
      "read:affiliate_integrations",
      "read:publishing_policies",
      "read:affiliate_integration_credentials",
      "read:catalog_snapshot",
      "read:user_roles",
      "rpc:apply_affiliate_persistence_plan_v2",
    ]);
  }
});

test("timestamp, triggeredBy, fingerprint, and RPC metadata come from one fresh server plan", async () => {
  const result = fixture();
  const response = await createAffiliateSyncApplyV2Handler(result.deps)(
    applyRequest(),
  );
  assert.equal(response.status, 200);
  assert.equal(result.activity.nowCalls, 1);
  assert.equal(result.activity.previewInputs.length, 1);
  assert.equal(
    result.activity.previewInputs[0]?.evaluationTimestamp,
    EVALUATION_TIMESTAMP,
  );
  assert.equal(result.activity.persistenceInputs.length, 1);
  const planningContext = result.activity.persistenceInputs[0]!.context;
  assert.deepEqual(planningContext, {
    integrationId: INTEGRATION_ID,
    provider: "impact",
    evaluationTimestamp: EVALUATION_TIMESTAMP,
    knownStoreSlugs: [],
    knownOfferKinds: [],
  });
  assert.equal(result.activity.preparations.length, 1);
  assert.equal(result.activity.preparations[0]?.triggeredBy, ADMIN_ID);
  assert.equal(result.dataSource.rpcCalls.length, 1);
  const args = persistenceRpcArgs(result.dataSource.rpcCalls[0]!);
  assert.equal(args._integration_id, INTEGRATION_ID);
  assert.equal(args._provider, "impact");
  assert.equal(
    args._persistence_contract_version,
    PERSISTENCE_CONTRACT_VERSION_V2,
  );
  assert.equal(
    args._plan_fingerprint_algorithm,
    PLAN_FINGERPRINT_ALGORITHM_V2,
  );
  assert.equal(args._evaluation_timestamp, EVALUATION_TIMESTAMP);
  assert.equal(args._triggered_by, ADMIN_ID);
  assert.equal(
    args._plan_fingerprint,
    await sha256Hex(result.activity.planned[0]!.canonicalPlanMaterialString),
  );
  assert.match(args._plan_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(serializedHasSecret(args), false);
  assert.equal(
    JSON.stringify(args).includes("privateProviderEnvelope"),
    false,
  );
});

test("jsonb key reordering and a create-to-noop revalidation shift remain valid", async () => {
  const result = fixture();
  result.dataSource.rpcImplementation = async (prepared) => {
    const args = persistenceRpcArgs(prepared);
    const expected = args._expected_counts;
    assert.equal(expected.stores.create, 1);
    assert.equal(expected.stores.noopExisting, 0);
    const reorderedExpected = {
      writableEntities: expected.writableEntities,
      writableOffers: expected.writableOffers,
      writableStores: expected.writableStores,
      offers: {
        noopUnresolved: expected.offers.noopUnresolved,
        noopHeld: expected.offers.noopHeld,
        noopExisting: expected.offers.noopExisting,
        create: expected.offers.create,
      },
      stores: {
        noopUnmatched: expected.stores.noopUnmatched,
        blockedAmbiguous: expected.stores.blockedAmbiguous,
        noopExisting: expected.stores.noopExisting,
        create: expected.stores.create,
      },
    };
    const value = validRpcValue(prepared);
    const counts = value.counts as Record<string, unknown>;
    const actual = counts.actual as Record<string, unknown>;
    actual.storesCreated = 0;
    actual.storesNoopExisting = 1;
    counts.expected = reorderedExpected;
    value.createdStores = [];
    value.noops = { stores: 1, offers: expected.offers.noopExisting };
    const ledger = value.ledger as Array<Record<string, unknown>>;
    ledger[0]!.outcome = "noop_existing";
    return { kind: "response", value };
  };

  const response = await createAffiliateSyncApplyV2Handler(result.deps)(
    applyRequest(),
  );
  assert.equal(response.status, 200);
  const responseBody = await body(response);
  assert.equal(responseBody.status, "committed");
  assert.deepEqual(
    (responseBody.counts as Record<string, unknown>).expected,
    persistenceRpcArgs(result.dataSource.rpcCalls[0]!)._expected_counts,
  );
  assert.deepEqual(responseBody.created, { stores: 0, offers: 1 });
  assert.deepEqual(responseBody.noops, { stores: 1, offers: 0 });
  assert.equal(responseBody.ledgerRows, 2);
  assert.equal(result.dataSource.rpcCalls.length, 1);
});

const RPC_STAGES: readonly ApplyV2RpcStage[] = [
  "request_validation",
  "replay_resolution",
  "store_revalidation",
  "store_insert",
  "offer_revalidation",
  "offer_insert",
  "reconciliation",
  "audit_persistence",
];

const RPC_BLOCKED_REASONS: readonly ApplyV2RpcBlockedReason[] = [
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
];

test("every allowlisted database blocker is mapped without retry or detail leakage", async () => {
  for (let index = 0; index < RPC_BLOCKED_REASONS.length; index += 1) {
    const rpcStage = RPC_STAGES[index % RPC_STAGES.length]!;
    const rpcReason = RPC_BLOCKED_REASONS[index]!;
    const result = fixture();
    result.dataSource.rpcImplementation = async () => ({
      kind: "response",
      value: { status: "blocked", stage: rpcStage, reason: rpcReason },
    });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await body(response), {
      status: "blocked",
      stage: "rpc_apply",
      reason: "rpc_blocked",
      rpcStage,
      rpcReason,
    });
    assert.equal(result.dataSource.rpcCalls.length, 1);
  }
});

test("every allowlisted internal database stage is mapped to a bounded failure", async () => {
  for (const rpcStage of RPC_STAGES) {
    const result = fixture();
    result.dataSource.rpcImplementation = async () => ({
      kind: "response",
      value: {
        status: "failed",
        stage: rpcStage,
        reason: "internal_failure",
      },
    });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), {
      status: "failed",
      stage: "rpc_apply",
      reason: "rpc_failed",
      rpcStage,
      rpcReason: "internal_failure",
    });
    assert.equal(result.dataSource.rpcCalls.length, 1);
  }
});

function mutateRpc(
  value: Record<string, unknown>,
  mutation: (clone: Record<string, unknown>) => void,
): Record<string, unknown> {
  const clone = structuredClone(value);
  mutation(clone);
  return clone;
}

test("malformed, empty, or provenance-mismatched database results are indeterminate", async () => {
  const malformations: Array<{
    name: string;
    options?: FixtureOptions;
    make: (valid: Record<string, unknown>) => unknown;
  }> = [
    { name: "null", make: () => null },
    { name: "empty object", make: () => ({}) },
    { name: "empty array", make: () => [] },
    { name: "empty string", make: () => "" },
    {
      name: "unknown status",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.status = "provider-controlled-status";
        }),
    },
    {
      name: "extra success key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.privateDetail = PROVIDER_RAW_SECRET;
        }),
    },
    {
      name: "invalid run id",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.runId = "not-a-uuid";
        }),
    },
    {
      name: "provider mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.provider = "awin";
        }),
    },
    {
      name: "integration mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.integrationId = COLLIDING_STORE_ID;
        }),
    },
    {
      name: "contract mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.persistenceContractVersion = "provider-version";
        }),
    },
    {
      name: "algorithm mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.planFingerprintAlgorithm = "provider-algorithm";
        }),
    },
    {
      name: "fingerprint mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.planFingerprint = "0".repeat(64);
        }),
    },
    {
      name: "timestamp mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.evaluationTimestamp = "2030-01-01T00:00:00.000Z";
        }),
    },
    {
      name: "expected counts mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const counts = clone.counts as Record<string, unknown>;
          const expected = counts.expected as Record<string, unknown>;
          expected.writableEntities = 99;
        }),
    },
    {
      name: "actual counts extra key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const counts = clone.counts as Record<string, unknown>;
          const actual = counts.actual as Record<string, unknown>;
          actual.privateCount = 1;
        }),
    },
    {
      name: "negative actual count",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const counts = clone.counts as Record<string, unknown>;
          const actual = counts.actual as Record<string, unknown>;
          actual.ledgerRows = -1;
        }),
    },
    {
      name: "aggregate count mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const counts = clone.counts as Record<string, unknown>;
          const actual = counts.actual as Record<string, unknown>;
          actual.ledgerRows = 1;
        }),
    },
    {
      name: "created array count mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.createdStores = [];
        }),
    },
    {
      name: "created store primitive",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.createdStores = [PROVIDER_RAW_SECRET];
        }),
    },
    {
      name: "created store null element",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as unknown[];
          stores[0] = null;
        }),
    },
    {
      name: "created store missing key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as Array<Record<string, unknown>>;
          delete stores[0]!.providerEntityId;
        }),
    },
    {
      name: "created store extra key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as Array<Record<string, unknown>>;
          stores[0]!.privateDetail = PROVIDER_RAW_SECRET;
        }),
    },
    {
      name: "created store identity mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as Array<Record<string, unknown>>;
          stores[0]!.entityId = COLLIDING_STORE_ID;
        }),
    },
    {
      name: "duplicate created store provider identity",
      options: { retrieve: async () => healthyFetchWithTwoEntities() },
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as Array<Record<string, unknown>>;
          stores[1]!.providerEntityId = stores[0]!.providerEntityId;
        }),
    },
    {
      name: "duplicate created store entity UUID",
      options: { retrieve: async () => healthyFetchWithTwoEntities() },
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const stores = clone.createdStores as Array<Record<string, unknown>>;
          stores[1]!.entityId = stores[0]!.entityId;
        }),
    },
    {
      name: "ledger primitive",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as unknown[];
          ledger[0] = PROVIDER_RAW_SECRET;
        }),
    },
    {
      name: "ledger null element",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as unknown[];
          ledger[0] = null;
        }),
    },
    {
      name: "ledger missing key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          delete ledger[0]!.offerKind;
        }),
    },
    {
      name: "ledger extra key",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.privateDetail = PROVIDER_RAW_SECRET;
        }),
    },
    {
      name: "duplicate ledger ordinal",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[1]!.instructionOrdinal = 0;
        }),
    },
    {
      name: "negative ledger ordinal",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.instructionOrdinal = -1;
        }),
    },
    {
      name: "fractional ledger ordinal",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.instructionOrdinal = 0.5;
        }),
    },
    {
      name: "ledger ordinal gap",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[1]!.instructionOrdinal = 7;
        }),
    },
    {
      name: "ledger entity kind mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.entityKind = "offer";
        }),
    },
    {
      name: "ledger planned action mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.plannedAction = "noop_existing";
        }),
    },
    {
      name: "ledger outcome mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.outcome = "provider_outcome";
        }),
    },
    {
      name: "ledger provider mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.provider = "awin";
        }),
    },
    {
      name: "ledger provider identity mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.providerEntityId = "other-store";
        }),
    },
    {
      name: "ledger invalid entity id",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.entityId = "not-a-uuid";
        }),
    },
    {
      name: "ledger unexpected existing entity id",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.expectedEntityId = COLLIDING_STORE_ID;
        }),
    },
    {
      name: "store ledger has parent",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[0]!.parentEntityId = COLLIDING_STORE_ID;
        }),
    },
    {
      name: "offer parent provider identity mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[1]!.parentProviderEntityId = "other-store";
        }),
    },
    {
      name: "offer parent entity mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[1]!.parentEntityId = COLLIDING_STORE_ID;
        }),
    },
    {
      name: "offer kind mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const ledger = clone.ledger as Array<Record<string, unknown>>;
          ledger[1]!.offerKind = "deal";
        }),
    },
    {
      name: "noop shape mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          clone.noops = { stores: 0, offers: 0, privateDetail: true };
        }),
    },
    {
      name: "created and noop reconciliation mismatch",
      make: (valid) =>
        mutateRpc(valid, (clone) => {
          const counts = clone.counts as Record<string, unknown>;
          const actual = counts.actual as Record<string, unknown>;
          actual.storesCreated = 0;
          actual.storesNoopExisting = 1;
          clone.createdStores = [];
          clone.noops = { stores: 1, offers: 0 };
        }),
    },
    {
      name: "blocked extra key",
      make: () => ({
        status: "blocked",
        stage: "request_validation",
        reason: "invalid_request",
        privateDetail: PROVIDER_RAW_SECRET,
      }),
    },
    {
      name: "blocked unknown stage",
      make: () => ({
        status: "blocked",
        stage: PROVIDER_RAW_SECRET,
        reason: "invalid_request",
      }),
    },
    {
      name: "blocked unknown reason",
      make: () => ({
        status: "blocked",
        stage: "request_validation",
        reason: PROVIDER_RAW_SECRET,
      }),
    },
    {
      name: "failed unknown reason",
      make: () => ({
        status: "failed",
        stage: "audit_persistence",
        reason: PROVIDER_RAW_SECRET,
      }),
    },
  ];

  for (const entry of malformations) {
    const result = fixture(entry.options);
    result.dataSource.rpcImplementation = async (prepared) => ({
      kind: "response",
      value: entry.make(validRpcValue(prepared)),
    });
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    await assertIndeterminate(response);
    assert.equal(serializedHasSecret(await body(response.clone())), false);
    assert.equal(result.dataSource.rpcCalls.length, 1, entry.name);
  }
});

test("RPC transport ambiguity is indeterminate and is never retried", async () => {
  const implementations: Array<
    (
      prepared: PreparedPersistenceExecutionV2,
    ) => Promise<ApplyV2RpcTransportResult>
  > = [
    async () => ({ kind: "transport_error" }),
    async () => {
      throw new Error(`transport ${EXCEPTION_SECRET}`);
    },
  ];
  for (const rpcImplementation of implementations) {
    const result = fixture();
    result.dataSource.rpcImplementation = rpcImplementation;
    const response = await createAffiliateSyncApplyV2Handler(result.deps)(
      applyRequest(),
    );
    assert.equal(response.status, 502);
    const responseBody = await body(response);
    assert.deepEqual(responseBody, {
      status: "indeterminate",
      stage: "rpc_apply",
      reason: "outcome_unknown",
    });
    assertCors(response, SITE_ORIGIN);
    assert.equal(result.dataSource.rpcCalls.length, 1);
    assert.equal(serializedHasSecret(responseBody), false);
  }
});
