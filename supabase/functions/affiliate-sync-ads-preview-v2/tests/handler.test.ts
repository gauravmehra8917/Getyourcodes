import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactAdsTransportRequestV2,
  ImpactAdsTransportResultV2,
  ImpactAdsTransportV2,
} from "../../_shared/affiliate-sync-v2-ads/index.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { createAffiliateSyncAdsPreviewV2Handler } from "../handler.ts";
import type {
  AdsPreviewV2DataSource,
  AdsPreviewV2HostDependencies,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ORIGIN = "https://admin.example";
const CIPHERTEXT = "ciphertext-sensitive";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const PRIVATE_PROVIDER_PAGE = "private-provider-page";
const PRIVATE_PROVIDER_PAGE_SIZE = "https://private.invalid/page-size";

const integration: StoredIntegrationV2 = {
  id: INTEGRATION_ID,
  providerName: "impact",
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

class FakeDataSource implements AdsPreviewV2DataSource {
  readonly operations: string[] = [];
  admin = true;
  integration: StoredIntegrationV2 | null = structuredClone(integration);
  policy = {
    enabled: true,
    minimumCouponsPerStore: 0,
    maximumCouponsPerStore: 20,
    minimumDealsPerStore: 0,
    maximumDealsPerStore: 18,
  };
  storeRows: Array<{ id: unknown; providerEntityId: unknown }> = [{
    id: "store-sensitive",
    providerEntityId: "campaign-sensitive",
  }];
  ciphertext: string | null = CIPHERTEXT;
  throwAt: "admin" | "integration" | "policy" | "stores" | "credential" | null =
    null;

  async hasAdminRole(userId: string): Promise<boolean> {
    this.operations.push(`admin:${userId}`);
    if (this.throwAt === "admin") throw new Error("secret-admin-error");
    return this.admin;
  }

  async readIntegration(id: string): Promise<StoredIntegrationV2 | null> {
    this.operations.push(`integration:${id}`);
    if (this.throwAt === "integration") {
      throw new Error("secret-integration-error");
    }
    return this.integration;
  }

  async readCredentialCiphertext(id: string): Promise<string | null> {
    this.operations.push(`credential:${id}`);
    if (this.throwAt === "credential") {
      throw new Error("secret-credential-error");
    }
    return this.ciphertext;
  }

  async readPublishingPolicy(id: string | null) {
    this.operations.push(`policy:${id ?? "default"}`);
    if (this.throwAt === "policy") throw new Error("secret-policy-error");
    return this.policy;
  }

  async readImpactStoreIdentityRows() {
    this.operations.push("stores");
    if (this.throwAt === "stores") throw new Error("secret-store-error");
    return this.storeRows;
  }
}

class FixtureTransport implements ImpactAdsTransportV2 {
  readonly requests: ImpactAdsTransportRequestV2[] = [];
  campaignBody: unknown = {
    "@page": PRIVATE_PROVIDER_PAGE,
    "@pagesize": PRIVATE_PROVIDER_PAGE_SIZE,
    Campaigns: [{
      CampaignId: "campaign-sensitive",
      AdvertiserId: "advertiser-sensitive",
      CampaignName: "Merchant Sensitive",
    }],
  };
  adsBody: unknown = {
    "@page": PRIVATE_PROVIDER_PAGE,
    "@pagesize": PRIVATE_PROVIDER_PAGE_SIZE,
    Ads: [{
      Id: "ad-sensitive",
      CampaignId: "campaign-sensitive",
      AdvertiserId: "advertiser-sensitive",
      DealId: "deal-sensitive",
      Name: "Ad Title Sensitive",
      Description: "Description Sensitive",
      DealDefaultPromoCode: "PROMO-SENSITIVE",
      Code: "IGNORED-SENSITIVE",
      TrackingLink: "https://tracking.example/private",
      LandingPageUrl: "https://landing.example/private",
    }],
  };
  rate = { limit: null, remaining: null, reset: null };

  async execute(
    request: ImpactAdsTransportRequestV2,
  ): Promise<ImpactAdsTransportResultV2> {
    this.requests.push(request);
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
    return { ...this.rate };
  }

  consumeResponseSizeLimitExceeded(): boolean {
    return false;
  }
}

function harness(input: {
  source?: FakeDataSource;
  transport?: FixtureTransport;
  user?: { id: string } | null;
  siteUrl?: string | null;
  now?: string;
} = {}) {
  const source = input.source ?? new FakeDataSource();
  const transport = input.transport ?? new FixtureTransport();
  const activity = { verifies: 0, sources: 0, decryptions: 0, transports: 0 };
  const dependencies: AdsPreviewV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      activity.verifies += 1;
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      return input.user === undefined ? { id: USER_ID } : input.user;
    },
    createDataSource() {
      activity.sources += 1;
      return source;
    },
    async decryptCredentialEnvelope(ciphertext) {
      activity.decryptions += 1;
      assert.equal(ciphertext, CIPHERTEXT);
      return JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    },
    createImpactTransport(credentials, origin) {
      activity.transports += 1;
      assert.deepEqual(credentials, {
        accountSid: ACCOUNT_SID,
        authToken: AUTH_TOKEN,
      });
      assert.equal(origin, "https://api.impact.com");
      return transport;
    },
    now: () => input.now ?? "2026-09-07T00:00:00.000Z",
    siteUrl: input.siteUrl === undefined
      ? `${SITE_ORIGIN}/admin/path`
      : input.siteUrl,
  };
  return {
    handler: createAffiliateSyncAdsPreviewV2Handler(dependencies),
    source,
    transport,
    activity,
  };
}

function request(
  body: unknown = { integrationId: INTEGRATION_ID, preview: true },
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
    ? "Bearer verified-jwt"
    : options.authorization;
  if (origin !== null) headers.set("Origin", origin);
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("https://edge.example/affiliate-sync-ads-preview-v2", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("successful host uses strict trust order and returns aggregate-only preview", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.source.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
    "policy:default",
    "stores",
    `credential:${INTEGRATION_ID}`,
  ]);
  assert.deepEqual(fixture.activity, {
    verifies: 1,
    sources: 1,
    decryptions: 1,
    transports: 1,
  });
  assert.equal(fixture.transport.requests.length, 2);
  assert.equal(fixture.transport.requests[0]?.url.includes("/Campaigns"), true);
  assert.equal(fixture.transport.requests[1]?.url.includes("/Ads"), true);

  const body = await bodyOf(response);
  assert.deepEqual(body.host, {
    version: "v2-a11-s3",
    readOnly: true,
    integrationId: INTEGRATION_ID,
    existingOfferMatching: "not_evaluated",
  });
  const result = body.result as Record<string, unknown>;
  assert.equal(result.complete, true);
  const serialized = JSON.stringify(body);
  for (
    const value of [
      ACCOUNT_SID,
      AUTH_TOKEN,
      CIPHERTEXT,
      "store-sensitive",
      "campaign-sensitive",
      "advertiser-sensitive",
      "ad-sensitive",
      "deal-sensitive",
      "Merchant Sensitive",
      "Ad Title Sensitive",
      "Description Sensitive",
      "PROMO-SENSITIVE",
      "IGNORED-SENSITIVE",
      "tracking.example",
      "landing.example",
      PRIVATE_PROVIDER_PAGE,
      PRIVATE_PROVIDER_PAGE_SIZE,
    ]
  ) assert.equal(serialized.includes(value), false, value);
});

test("only normalized SITE_URL and exact localhost origins pass CORS", async () => {
  for (
    const origin of [
      SITE_ORIGIN,
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
    ]
  ) {
    const fixture = harness();
    const response = await fixture.handler(
      request(undefined, { origin, method: "OPTIONS" }),
    );
    assert.equal(response.status, 204);
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
    assert.equal(
      response.headers.has("Access-Control-Allow-Credentials"),
      false,
    );
    assert.deepEqual(fixture.activity, {
      verifies: 0,
      sources: 0,
      decryptions: 0,
      transports: 0,
    });
  }

  for (
    const origin of [
      null,
      "null",
      "http://localhost:8081",
      "https://localhost:8080",
      "https://preview--dealio-dash.lovable.app",
      "https://id-preview--039ee3ad-3ac4-45eb-84ef-ab28307d72ac.lovable.app",
      "https://admin.example.evil.invalid",
      "https://evil.example",
    ]
  ) {
    const fixture = harness();
    const response = await fixture.handler(
      request(undefined, { origin, method: "OPTIONS" }),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
    assert.deepEqual(fixture.activity, {
      verifies: 0,
      sources: 0,
      decryptions: 0,
      transports: 0,
    });
    assert.deepEqual(fixture.source.operations, []);
  }
});

test("method, strict Bearer, verified user, admin and exact body gate all reads", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const fixture = harness();
    const response = await fixture.handler(request(undefined, { method }));
    assert.equal(response.status, 405);
    assert.equal(fixture.activity.verifies, 0);
  }
  for (
    const authorization of [
      null,
      "",
      "bearer verified-jwt",
      "Bearer",
      "Bearer  verified-jwt",
      "Bearer verified-jwt extra",
    ]
  ) {
    const fixture = harness();
    assert.equal(
      (await fixture.handler(request(undefined, { authorization }))).status,
      401,
    );
    assert.equal(fixture.activity.sources, 0);
  }
  for (const user of [null, { id: "not-a-uuid" }]) {
    const fixture = harness({ user });
    assert.equal((await fixture.handler(request())).status, 401);
    assert.deepEqual(fixture.source.operations, []);
  }
  const nonAdminSource = new FakeDataSource();
  nonAdminSource.admin = false;
  const nonAdmin = harness({ source: nonAdminSource });
  assert.equal((await nonAdmin.handler(request())).status, 403);
  assert.deepEqual(nonAdminSource.operations, [`admin:${USER_ID}`]);

  for (
    const body of [
      null,
      {},
      { integrationId: INTEGRATION_ID },
      { integrationId: INTEGRATION_ID, preview: false },
      { integrationId: INTEGRATION_ID, preview: true, extra: true },
      { integrationId: "not-a-uuid", preview: true },
    ]
  ) {
    const fixture = harness();
    assert.equal((await fixture.handler(request(body))).status, 400);
    assert.deepEqual(fixture.source.operations, [`admin:${USER_ID}`]);
  }
});

test("integration row must bind exactly to the requested UUID before trusted reads", async () => {
  const source = new FakeDataSource();
  source.integration = { ...integration, id: USER_ID };
  const fixture = harness({ source });
  const response = await fixture.handler(request());
  assert.equal(response.status, 422);
  assert.deepEqual(source.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
  ]);
  assert.equal(fixture.activity.decryptions, 0);
  assert.equal(fixture.transport.requests.length, 0);
});

test("an incomplete or quarantined Campaign fetch blocks Ads retrieval", async () => {
  for (
    const campaignBody of [
      { Wrong: [] },
      { Campaigns: [{ AdvertiserId: "advertiser-sensitive" }] },
    ]
  ) {
    const transport = new FixtureTransport();
    transport.campaignBody = campaignBody;
    const fixture = harness({ transport });
    const response = await fixture.handler(request());
    assert.equal(response.status, 200);
    assert.equal(transport.requests.length, 1);
    const body = await bodyOf(response);
    const result = body.result as Record<string, unknown>;
    assert.equal(result.complete, false);
    assert.equal(result.blockedStage, "campaign_fetch");
  }
});

test("an incomplete Ads fetch is reported as blocked aggregate evidence", async () => {
  const transport = new FixtureTransport();
  transport.adsBody = { Wrong: [] };
  const fixture = harness({ transport });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.equal(transport.requests.length, 2);
  const result = (await bodyOf(response)).result as Record<string, unknown>;
  assert.equal(result.complete, false);
  assert.equal(result.blockedStage, "ads_fetch");
});

test("read and validation failures return only fixed credential-free errors", async () => {
  for (
    const item of [
      { throwAt: "integration", status: 500, code: "internal_error" },
      { throwAt: "policy", status: 500, code: "policy_read_failed" },
      { throwAt: "stores", status: 500, code: "catalog_snapshot_failed" },
      { throwAt: "credential", status: 422, code: "credentials_unavailable" },
    ] as const
  ) {
    const source = new FakeDataSource();
    source.throwAt = item.throwAt;
    const response = await harness({ source }).handler(request());
    assert.equal(response.status, item.status);
    const body = await bodyOf(response);
    assert.equal((body.error as Record<string, unknown>).code, item.code);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("secret-"), false);
    assert.equal(serialized.includes(CIPHERTEXT), false);
  }
});
