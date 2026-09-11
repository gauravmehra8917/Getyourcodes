import assert from "node:assert/strict";
import test from "node:test";
import {
  type ImpactAdsTransportRequestV2,
  type ImpactAdsTransportResultV2,
  type ImpactAdsTransportV2,
} from "../../_shared/affiliate-sync-v2-ads/index.ts";
import {
  type AdsCatalogPlanningContextV2,
  AdsPersistencePlannerV2,
} from "../../_shared/affiliate-sync-v2-ads-persistence/index.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { createAffiliateSyncAdsApplyV2Handler } from "../handler.ts";
import {
  adsPersistenceRpcArgsV2,
  prepareAdsPersistenceExecutionV2,
  type PreparedAdsPersistenceExecutionV2,
} from "../persistence-execution.ts";
import type {
  AdsApplyV2DataSource,
  AdsApplyV2HostDependencies,
  AdsApplyV2RpcTransportResult,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const EXISTING_STORE_ID = "44444444-4444-4444-8444-444444444444";
const EXISTING_OFFER_ID = "55555555-5555-4555-8555-555555555555";
const SITE_ORIGIN = "https://admin.example";
const EVALUATION = "2026-06-01T00:00:00.000Z";
const AUTHORIZATION = "Bearer jwt-sensitive";
const JWT = "jwt-sensitive";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";
const COUPON_CODE = "Save 20! sensitive";
const CAMPAIGN_ID = "Campaign-sensitive";
const AD_ID = "Ad-sensitive";
const SECRET_ERROR = "exception-sensitive";

const integration: StoredIntegrationV2 = {
  id: INTEGRATION_ID,
  providerName: "Impact.com",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: {
    campaigns: "/Mediapartners/{AccountSID}/Campaigns",
  },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 0,
  pageSize: 100,
  maxPages: 50,
  publishingPolicyId: null,
};

class FixtureTransport implements ImpactAdsTransportV2 {
  readonly requests: ImpactAdsTransportRequestV2[] = [];
  campaignBody: unknown = {
    "@page": "1",
    "@numpages": "1",
    Campaigns: [{
      CampaignId: CAMPAIGN_ID,
      AdvertiserId: "Advertiser-sensitive",
      CampaignName: "Sensitive & Store",
      CampaignTrackingLink: "https://track.example/campaign-sensitive",
      WebsiteUrl: "https://destination.example/campaign-sensitive",
    }],
  };
  adsBody: unknown = {
    "@page": "1",
    "@numpages": "1",
    Ads: [{
      Id: AD_ID,
      CampaignId: CAMPAIGN_ID,
      AdvertiserId: "Advertiser-sensitive",
      DealId: "Deal-sensitive",
      Name: "Sensitive title",
      Description: "Sensitive description",
      DealDefaultPromoCode: COUPON_CODE,
      Code: "MUST-NOT-BE-USED",
      TrackingLink: "https://track.example/ad-sensitive",
      LandingPageUrl: "https://landing.example/ad-sensitive",
      DealStartDate: "2026-05-01T00:00:00Z",
      DealEndDate: "2026-12-31T23:59:59Z",
      DiscountPercent: 20,
      MinimumPurchaseAmount: 50,
      MinimumPurchaseAmountCurrency: "USD",
    }],
  };
  failure: ImpactAdsTransportResultV2 | null = null;

  async execute(
    request: ImpactAdsTransportRequestV2,
  ): Promise<ImpactAdsTransportResultV2> {
    this.requests.push(request);
    if (this.failure) return this.failure;
    return {
      kind: "response",
      status: 200,
      bodyText: JSON.stringify(
        request.url.includes("/Campaigns") ? this.campaignBody : this.adsBody,
      ),
      retryAfterMs: null,
    };
  }
  async wait(): Promise<void> {}
  readRateSnapshot() {
    return { limit: null, remaining: null, reset: null };
  }
  consumeResponseSizeLimitExceeded(): boolean {
    return false;
  }
}

function emptyCatalog(): AdsCatalogPlanningContextV2 {
  return { stores: [], offers: [] };
}

class FakeDataSource implements AdsApplyV2DataSource {
  readonly operations: string[] = [];
  readonly roleIds: string[] = [];
  readonly rpcCalls: PreparedAdsPersistenceExecutionV2[] = [];
  roleResults: Array<boolean | Error> = [true, true];
  integration: StoredIntegrationV2 | null = structuredClone(integration);
  ciphertext: string | null = CIPHERTEXT;
  catalog: AdsCatalogPlanningContextV2 = emptyCatalog();
  throwAt: "integration" | "credential" | "catalog" | null = null;
  rpcImplementation: (
    prepared: PreparedAdsPersistenceExecutionV2,
  ) => Promise<AdsApplyV2RpcTransportResult> = async (prepared) => ({
    kind: "response",
    value: validRpcValue(prepared),
  });
  private roleIndex = 0;

  async hasAdminRole(userId: string): Promise<boolean> {
    this.operations.push("read:user_roles");
    this.roleIds.push(userId);
    const result = this.roleResults[this.roleIndex] ??
      this.roleResults[this.roleResults.length - 1] ?? false;
    this.roleIndex += 1;
    if (result instanceof Error) throw result;
    return result;
  }
  async readIntegration(id: string): Promise<StoredIntegrationV2 | null> {
    this.operations.push("read:affiliate_integrations");
    assert.equal(id, INTEGRATION_ID);
    if (this.throwAt === "integration") throw new Error(SECRET_ERROR);
    return this.integration;
  }
  async readCredentialCiphertext(id: string): Promise<string | null> {
    this.operations.push("read:affiliate_integration_credentials");
    assert.equal(id, INTEGRATION_ID);
    if (this.throwAt === "credential") throw new Error(SECRET_ERROR);
    return this.ciphertext;
  }
  async loadCatalogPlanningContext(): Promise<AdsCatalogPlanningContextV2> {
    this.operations.push("read:catalog_snapshot");
    if (this.throwAt === "catalog") throw new Error(SECRET_ERROR);
    return this.catalog;
  }
  async applyPersistencePlan(
    prepared: PreparedAdsPersistenceExecutionV2,
  ): Promise<AdsApplyV2RpcTransportResult> {
    this.operations.push("rpc:apply_affiliate_persistence_plan_v2");
    this.rpcCalls.push(prepared);
    return await this.rpcImplementation(prepared);
  }
}

function evidenceUuid(kind: "store" | "offer", index: number): string {
  const offset = kind === "store" ? 1 : 1_000_001;
  return `66666666-6666-4666-8666-${
    (offset + index).toString(16).padStart(12, "0")
  }`;
}

function validRpcValue(
  prepared: PreparedAdsPersistenceExecutionV2,
  status: "committed" | "replayed_existing" = "committed",
): Record<string, unknown> {
  const args = adsPersistenceRpcArgsV2(prepared);
  const stores = args._store_instructions.map((instruction, index) => ({
    instructionOrdinal: instruction.instructionOrdinal,
    entityKind: "store",
    plannedAction: instruction.action,
    outcome: instruction.action === "create" ? "created" : "noop_existing",
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: instruction.providerEntityId,
    entityId: instruction.action === "create"
      ? evidenceUuid("store", index)
      : instruction.expectedExistingStoreId!,
    expectedEntityId: instruction.expectedExistingStoreId,
    parentProviderEntityNamespace: null,
    parentProviderEntityId: null,
    parentEntityId: null,
    offerKind: null,
  }));
  const storeIds = new Map(
    stores.map((entry) => [entry.providerEntityId, entry.entityId]),
  );
  const offers = args._offer_instructions.map((instruction, index) => ({
    instructionOrdinal: instruction.instructionOrdinal,
    entityKind: "offer",
    plannedAction: instruction.action,
    outcome: instruction.action === "create" ? "created" : "noop_existing",
    provider: "impact",
    providerEntityNamespace: "ad",
    providerEntityId: instruction.providerEntityId,
    entityId: instruction.action === "create"
      ? evidenceUuid("offer", index)
      : instruction.existingOfferId!,
    expectedEntityId: instruction.existingOfferId,
    parentProviderEntityNamespace: "campaign",
    parentProviderEntityId: instruction.parentProviderEntityId,
    parentEntityId: storeIds.get(instruction.parentProviderEntityId)!,
    offerKind: "coupon",
  }));
  const ledger = [...stores, ...offers];
  const createdStores = stores.filter((entry) => entry.outcome === "created")
    .map((entry) => ({
      entityId: entry.entityId,
      providerEntityId: entry.providerEntityId,
    }));
  const createdOffers = offers.filter((entry) => entry.outcome === "created")
    .map((entry) => ({
      entityId: entry.entityId,
      providerEntityId: entry.providerEntityId,
    }));
  const actual = {
    storesCreated: createdStores.length,
    storesNoopExisting: stores.length - createdStores.length,
    offersCreated: createdOffers.length,
    offersNoopExisting: offers.length - createdOffers.length,
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
    counts: { expected: args._expected_counts, actual },
    createdStores,
    createdOffers,
    noops: {
      stores: actual.storesNoopExisting,
      offers: actual.offersNoopExisting,
    },
    ledger,
  };
}

function harness(input: {
  source?: FakeDataSource;
  transport?: FixtureTransport;
  user?: { id: string } | null;
  verifyError?: boolean;
  createSourceError?: boolean;
  decryptError?: boolean;
  siteUrl?: string | null;
  plannerError?: boolean;
  preparationError?: boolean;
} = {}) {
  const source = input.source ?? new FakeDataSource();
  const transport = input.transport ?? new FixtureTransport();
  const activity = {
    verifies: 0,
    sourceCreations: 0,
    decryptions: 0,
    transports: 0,
    plans: 0,
    preparations: 0,
  };
  const dependencies: AdsApplyV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      activity.verifies += 1;
      assert.equal(authorization, AUTHORIZATION);
      assert.equal(jwt, JWT);
      if (input.verifyError) throw new Error(SECRET_ERROR);
      return input.user === undefined ? { id: ADMIN_ID } : input.user;
    },
    createDataSource() {
      activity.sourceCreations += 1;
      if (input.createSourceError) throw new Error(SECRET_ERROR);
      return source;
    },
    async decryptCredentialEnvelope(ciphertext) {
      activity.decryptions += 1;
      assert.equal(ciphertext, CIPHERTEXT);
      if (input.decryptError) throw new Error(SECRET_ERROR);
      return JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    },
    createImpactTransport(credentials, origin, maxBytes) {
      activity.transports += 1;
      assert.deepEqual(credentials, {
        accountSid: ACCOUNT_SID,
        authToken: AUTH_TOKEN,
      });
      assert.equal(origin, "https://api.impact.com");
      assert.equal(maxBytes, 5 * 1024 * 1024);
      return transport;
    },
    persistencePlan(planInput) {
      activity.plans += 1;
      if (input.plannerError) throw new Error(SECRET_ERROR);
      return AdsPersistencePlannerV2.plan(planInput);
    },
    async prepareExecution(plan, triggeredBy) {
      activity.preparations += 1;
      assert.equal(triggeredBy, ADMIN_ID);
      if (input.preparationError) throw new Error(SECRET_ERROR);
      return await prepareAdsPersistenceExecutionV2(plan, triggeredBy);
    },
    now: () => new Date(EVALUATION),
    siteUrl: input.siteUrl === undefined
      ? `${SITE_ORIGIN}/admin/path`
      : input.siteUrl,
  };
  return {
    handler: createAffiliateSyncAdsApplyV2Handler(dependencies),
    source,
    transport,
    activity,
  };
}

function request(
  body: unknown = {
    integrationId: INTEGRATION_ID,
    execute: true,
    mode: "full",
  },
  options: {
    method?: string;
    origin?: string | null;
    authorization?: string | null;
  } = {},
): Request {
  const method = options.method ?? "POST";
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = options.origin === undefined ? SITE_ORIGIN : options.origin;
  const authorization = options.authorization === undefined
    ? AUTHORIZATION
    : options.authorization;
  if (origin !== null) headers.set("Origin", origin);
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("https://edge.example/affiliate-sync-ads-apply-v2", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function assertCors(response: Response, origin: string): void {
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
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
}

function serializedLeaksSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return [
    JWT,
    ACCOUNT_SID,
    AUTH_TOKEN,
    CIPHERTEXT,
    COUPON_CODE,
    CAMPAIGN_ID,
    AD_ID,
    "Sensitive title",
    "Sensitive description",
    "track.example",
    "landing.example",
    SECRET_ERROR,
  ].some((secret) => serialized.includes(secret));
}

test("OPTIONS terminates before auth, database, credentials, provider and RPC work", async () => {
  for (
    const origin of [
      SITE_ORIGIN,
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
    ]
  ) {
    const fixture = harness();
    const response = await fixture.handler(request(undefined, {
      method: "OPTIONS",
      origin,
      authorization: null,
    }));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, origin);
    assert.deepEqual(fixture.activity, {
      verifies: 0,
      sourceCreations: 0,
      decryptions: 0,
      transports: 0,
      plans: 0,
      preparations: 0,
    });
    assert.deepEqual(fixture.source.operations, []);
    assert.equal(fixture.transport.requests.length, 0);
  }
});

test("missing, unapproved and deceptive origins fail closed before all work", async () => {
  for (
    const origin of [
      null,
      "https://admin.example.evil.invalid",
      "http://localhost:8081",
      "https://localhost:8080",
      "https://preview--another-project.lovable.app",
    ]
  ) {
    const fixture = harness();
    const response = await fixture.handler(request(undefined, { origin }));
    assert.equal(response.status, 403);
    assert.deepEqual(await bodyOf(response), {
      status: "failed",
      stage: "cors",
      reason: "origin_not_allowed",
    });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal(fixture.activity.verifies, 0);
    assert.deepEqual(fixture.source.operations, []);
    assert.equal(fixture.transport.requests.length, 0);
  }
});

test("strict authentication and first admin check precede request/provider work", async () => {
  for (
    const authorization of [
      null,
      "",
      "bearer token",
      "Bearer",
      "Bearer token extra",
    ]
  ) {
    const fixture = harness();
    const response = await fixture.handler(
      request(undefined, { authorization }),
    );
    assert.equal(response.status, 401);
    assert.equal(fixture.activity.sourceCreations, 0);
    assert.deepEqual(fixture.source.operations, []);
    assert.equal(fixture.transport.requests.length, 0);
  }

  const nonAdmin = harness();
  nonAdmin.source.roleResults = [false];
  const response = await nonAdmin.handler(request());
  assert.equal(response.status, 403);
  assert.deepEqual(nonAdmin.source.operations, ["read:user_roles"]);
  assert.equal(nonAdmin.transport.requests.length, 0);
});

test("request is closed intent only and rejects executable or unknown material", async () => {
  const invalidBodies: unknown[] = [
    { integrationId: INTEGRATION_ID, execute: false, mode: "full" },
    { integrationId: INTEGRATION_ID, execute: true },
    {
      integrationId: INTEGRATION_ID,
      execute: true,
      mode: "full",
      canaryAdId: AD_ID,
    },
    { integrationId: INTEGRATION_ID, execute: true, mode: "canary" },
    {
      integrationId: INTEGRATION_ID,
      execute: true,
      mode: "canary",
      canaryAdId: " Ad ",
    },
    {
      integrationId: INTEGRATION_ID,
      execute: true,
      mode: "canary",
      canaryAdId: AD_ID,
      couponCode: "ATTACK",
    },
    {
      integrationId: INTEGRATION_ID,
      execute: true,
      mode: "full",
      storePlan: [],
      offerPlan: [],
      affiliateUrl: "https://evil.invalid",
      seoTitle: "attacker",
      dbId: ADMIN_ID,
      providerPayload: {},
    },
  ];
  for (const body of invalidBodies) {
    const fixture = harness();
    const response = await fixture.handler(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await bodyOf(response), {
      status: "failed",
      stage: "request",
      reason: "invalid_request",
    });
    assert.equal(fixture.transport.requests.length, 0);
    assert.equal(
      fixture.source.operations.includes("read:affiliate_integrations"),
      false,
    );
    assert.equal(fixture.source.rpcCalls.length, 0);
  }
});

test("successful full execution owns retrieval, planning, second admin check and sole RPC", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.source.operations, [
    "read:user_roles",
    "read:affiliate_integrations",
    "read:affiliate_integration_credentials",
    "read:catalog_snapshot",
    "read:user_roles",
    "rpc:apply_affiliate_persistence_plan_v2",
  ]);
  assert.equal(fixture.transport.requests.length, 2);
  assert.equal(fixture.transport.requests[0]?.url.includes("/Campaigns"), true);
  assert.equal(fixture.transport.requests[1]?.url.includes("/Ads"), true);
  const adsUrl = new URL(fixture.transport.requests[1]!.url);
  assert.equal(adsUrl.pathname, `/Mediapartners/${ACCOUNT_SID}/Ads`);
  assert.equal(adsUrl.searchParams.get("Type"), "COUPON");
  assert.equal(fixture.source.rpcCalls.length, 1);
  const rpcArgs = adsPersistenceRpcArgsV2(fixture.source.rpcCalls[0]!);
  assert.equal(
    rpcArgs._store_instructions[0]?.providerEntityNamespace,
    "campaign",
  );
  assert.equal(rpcArgs._offer_instructions[0]?.providerEntityNamespace, "ad");
  assert.equal(
    rpcArgs._offer_instructions[0]?.projection?.couponCode,
    COUPON_CODE,
  );

  const result = await bodyOf(response);
  assert.deepEqual(result, {
    status: "committed",
    runId: RUN_ID,
    mode: "full",
    evaluationTimestamp: EVALUATION,
    refreshedPlan: true,
    counts: {
      expected: rpcArgs._expected_counts,
      actual: {
        storesCreated: 1,
        storesNoopExisting: 0,
        offersCreated: 1,
        offersNoopExisting: 0,
        ledgerRows: 2,
      },
    },
    created: { stores: 1, coupons: 1 },
    noops: { stores: 0, coupons: 0 },
    ledgerRows: 2,
  });
  assert.equal(serializedLeaksSecret(result), false);
});

test("jsonb key reordering in expected counts remains valid", async () => {
  const source = new FakeDataSource();
  source.rpcImplementation = async (prepared) => {
    const value = validRpcValue(prepared);
    const expected = adsPersistenceRpcArgsV2(prepared)._expected_counts;
    const counts = value.counts as Record<string, unknown>;
    counts.expected = {
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
    return { kind: "response", value };
  };

  const fixture = harness({ source });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const result = await bodyOf(response);
  assert.equal(result.status, "committed");
  assert.deepEqual(result.created, { stores: 1, coupons: 1 });
  assert.equal(source.rpcCalls.length, 1);
});

test("parser-valid provider timestamps without seconds reach persistence", async () => {
  const transport = new FixtureTransport();
  const ad = (transport.adsBody as { Ads: Array<Record<string, unknown>> })
    .Ads[0]!;
  ad.DealStartDate = "2026-05-01T12:34Z";
  ad.DealEndDate = "2026-12-31T23:59z";

  const fixture = harness({ transport });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const args = adsPersistenceRpcArgsV2(fixture.source.rpcCalls[0]!);
  assert.equal(
    args._offer_instructions[0]?.projection?.metadata.dealStartDate,
    "2026-05-01T12:34Z",
  );
  assert.equal(
    args._offer_instructions[0]?.projection?.metadata.dealEndDate,
    "2026-12-31T23:59z",
  );
});

test("exact existing canary is a valid zero-create NOOP execution", async () => {
  const source = new FakeDataSource();
  source.catalog = {
    stores: [{
      storeId: EXISTING_STORE_ID,
      slug: "curated-sensitive-store",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: CAMPAIGN_ID,
    }],
    offers: [{
      offerId: EXISTING_OFFER_ID,
      storeId: EXISTING_STORE_ID,
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: AD_ID,
      couponType: "code",
    }],
  };
  const fixture = harness({ source });
  const response = await fixture.handler(request({
    integrationId: INTEGRATION_ID,
    execute: true,
    mode: "canary",
    canaryAdId: AD_ID,
  }));
  assert.equal(response.status, 200);
  const result = await bodyOf(response);
  assert.equal(result.status, "committed");
  assert.equal(result.mode, "canary");
  assert.deepEqual(result.created, { stores: 0, coupons: 0 });
  assert.deepEqual(result.noops, { stores: 1, coupons: 1 });
  assert.equal(JSON.stringify(result).includes(AD_ID), false);
  assert.equal(source.rpcCalls.length, 1);
});

test("unknown, no-code and conflicting canaries are bounded zero-write blockers", async () => {
  const cases: Array<{ selected: string; adsBody?: unknown }> = [
    { selected: "unknown-ad" },
    {
      selected: AD_ID,
      adsBody: {
        "@page": "1",
        "@numpages": "1",
        Ads: [{
          Id: AD_ID,
          CampaignId: CAMPAIGN_ID,
          DealDefaultPromoCode: "N/A",
        }],
      },
    },
    {
      selected: AD_ID,
      adsBody: {
        "@page": "1",
        "@numpages": "1",
        Ads: [
          {
            Id: AD_ID,
            CampaignId: CAMPAIGN_ID,
            DealDefaultPromoCode: "SAVE10",
          },
          {
            Id: AD_ID,
            CampaignId: CAMPAIGN_ID,
            DealDefaultPromoCode: "SAVE20",
          },
        ],
      },
    },
  ];
  for (const current of cases) {
    const transport = new FixtureTransport();
    if (current.adsBody) transport.adsBody = current.adsBody;
    const fixture = harness({ transport });
    const response = await fixture.handler(request({
      integrationId: INTEGRATION_ID,
      execute: true,
      mode: "canary",
      canaryAdId: current.selected,
    }));
    assert.equal(response.status, 409);
    const result = await bodyOf(response);
    assert.deepEqual(Object.keys(result).sort(), [
      "blockerReasonCounts",
      "reason",
      "stage",
      "status",
    ]);
    assert.equal(result.status, "blocked");
    assert.equal(JSON.stringify(result).includes(current.selected), false);
    assert.equal(serializedLeaksSecret(result), false);
    assert.equal(fixture.source.rpcCalls.length, 0);
  }
});

test("incomplete Campaigns, quarantined Campaigns and incomplete Ads prevent all writes", async () => {
  const malformedCampaign = new FixtureTransport();
  malformedCampaign.campaignBody = {
    Campaigns: [],
    "@page": "1",
    "@numpages": "2",
  };
  const campaignFixture = harness({ transport: malformedCampaign });
  const campaignResponse = await campaignFixture.handler(request());
  assert.equal(campaignResponse.status, 409);
  assert.equal(malformedCampaign.requests.length, 1);
  assert.equal(campaignFixture.source.rpcCalls.length, 0);

  const quarantinedCampaign = new FixtureTransport();
  quarantinedCampaign.campaignBody = {
    "@page": "1",
    "@numpages": "1",
    Campaigns: [{ CampaignName: "Missing ID" }],
  };
  const quarantineFixture = harness({ transport: quarantinedCampaign });
  const quarantineResponse = await quarantineFixture.handler(request());
  assert.equal(quarantineResponse.status, 409);
  assert.equal(quarantinedCampaign.requests.length, 1);
  assert.equal(quarantineFixture.source.rpcCalls.length, 0);

  const malformedAds = new FixtureTransport();
  malformedAds.adsBody = { Ads: [], "@page": "1", "@numpages": "2" };
  const adsFixture = harness({ transport: malformedAds });
  const adsResponse = await adsFixture.handler(request());
  assert.equal(adsResponse.status, 409);
  assert.equal(malformedAds.requests.length, 2);
  assert.equal(
    adsFixture.source.operations.includes("read:catalog_snapshot"),
    false,
  );
  assert.equal(adsFixture.source.rpcCalls.length, 0);
});

test("second admin verification is the final awaited gate before mutation", async () => {
  const fixture = harness();
  fixture.source.roleResults = [true, false];
  const response = await fixture.handler(request());
  assert.equal(response.status, 403);
  assert.equal(fixture.source.roleIds.length, 2);
  assert.equal(fixture.source.operations.at(-1), "read:user_roles");
  assert.equal(fixture.source.rpcCalls.length, 0);
});

test("transport uncertainty and malformed RPC evidence remain indeterminate and private", async () => {
  for (
    const rpcImplementation of [
      async () => ({ kind: "transport_error" as const }),
      async () => ({
        kind: "response" as const,
        value: { status: "committed", secret: SECRET_ERROR },
      }),
    ]
  ) {
    const source = new FakeDataSource();
    source.rpcImplementation = rpcImplementation;
    const fixture = harness({ source });
    const response = await fixture.handler(request());
    assert.equal(response.status, 502);
    const result = await bodyOf(response);
    assert.deepEqual(result, {
      status: "indeterminate",
      stage: "rpc_apply",
      reason: "outcome_unknown",
    });
    assert.equal(serializedLeaksSecret(result), false);
  }
});

test("all caught host exceptions produce fixed bounded responses without sensitive material", async () => {
  const cases = [
    harness({ verifyError: true }),
    harness({ createSourceError: true }),
    harness({ decryptError: true }),
    harness({ plannerError: true }),
    harness({ preparationError: true }),
  ];
  cases[3]!.source.throwAt = "catalog";
  for (const fixture of cases) {
    const response = await fixture.handler(request());
    const result = await bodyOf(response);
    assert.equal(serializedLeaksSecret(result), false);
    assert.deepEqual(Object.keys(result).sort(), ["reason", "stage", "status"]);
  }
});
