import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../../_shared/affiliate-sync-v2/index.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { createAffiliateSyncSourceAuditV2Handler } from "../handler.ts";
import type {
  ImpactAuditTransportV2,
  ImpactRateSnapshotV2,
  SourceAuditV2DataSource,
  SourceAuditV2HostDependencies,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";
const SITE_ORIGIN = "https://admin.example";

const healthyIntegration: StoredIntegrationV2 = {
  id: INTEGRATION_ID,
  providerName: "Impact.com",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: {
    campaigns: "/Mediapartners/{AccountSID}/Campaigns",
    promotions: "/Mediapartners/{AccountSID}/Promotions",
  },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 0,
  pageSize: 100,
  maxPages: 50,
  publishingPolicyId: null,
};

class FakeDataSource implements SourceAuditV2DataSource {
  readonly operations: string[] = [];
  admin = true;
  integration: StoredIntegrationV2 | null = structuredClone(healthyIntegration);
  ciphertext: string | null = CIPHERTEXT;
  throwAt: "admin" | "integration" | "credential" | null = null;

  async hasAdminRole(userId: string): Promise<boolean> {
    this.operations.push(`admin:${userId}`);
    if (this.throwAt === "admin") throw new Error("secret-admin-error");
    return this.admin;
  }

  async readIntegration(
    integrationId: string,
  ): Promise<StoredIntegrationV2 | null> {
    this.operations.push(`integration:${integrationId}`);
    if (this.throwAt === "integration") {
      throw new Error("secret-integration-error");
    }
    return this.integration;
  }

  async readCredentialCiphertext(
    integrationId: string,
  ): Promise<string | null> {
    this.operations.push(`credential:${integrationId}`);
    if (this.throwAt === "credential") {
      throw new Error("secret-credential-error");
    }
    return this.ciphertext;
  }
}

class AuditPageTransport implements ImpactAuditTransportV2 {
  readonly requests: ImpactTransportRequest[] = [];
  readonly waits: number[] = [];
  campaignsMalformed = false;
  adsMalformed = false;
  campaignContinuation: string | null = null;
  campaignRate: ImpactRateSnapshotV2 | null = null;
  rateResets = 0;
  rate: ImpactRateSnapshotV2 = { limit: null, remaining: null, reset: null };

  async execute(
    request: ImpactTransportRequest,
  ): Promise<ImpactTransportResult> {
    this.requests.push(request);
    const campaigns = request.url.includes("/Campaigns");
    if (campaigns && this.campaignRate !== null) {
      this.rate = { ...this.campaignRate };
    }
    const body = campaigns
      ? this.campaignsMalformed ? { Wrong: [] } : {
        ...(this.campaignContinuation === null ? {} : {
          "@page": "1",
          "@numpages": "2",
          "@nextpageuri": this.campaignContinuation,
        }),
        Campaigns: [{
          CampaignId: "campaign-sensitive",
          AdvertiserId: "advertiser-sensitive",
          CampaignName: "Merchant Sensitive",
        }],
      }
      : this.adsMalformed
      ? { Wrong: [] }
      : {
        Ads: [{
          Id: "ad-sensitive",
          CampaignId: "campaign-sensitive",
          AdvertiserId: "advertiser-sensitive",
          AdvertiserName: "Merchant Sensitive",
          DealId: "deal-sensitive",
          Code: "CODE-SENSITIVE",
          DealDefaultPromoCode: "DEFAULT-SENSITIVE",
          TrackingLink: "https://tracking.example/private",
          LandingPageUrl: "https://landing.example/private",
        }],
      };
    return {
      kind: "response",
      status: 200,
      bodyText: JSON.stringify(body),
      retryAfterMs: null,
    };
  }

  async wait(delayMs: number): Promise<void> {
    this.waits.push(delayMs);
  }

  readRateSnapshot(): ImpactRateSnapshotV2 {
    return { ...this.rate };
  }

  resetRateSnapshot(): void {
    this.rateResets += 1;
    this.rate = { limit: null, remaining: null, reset: null };
  }

  consumeResponseSizeLimitExceeded(): boolean {
    return false;
  }
}

function harness(input: {
  dataSource?: FakeDataSource;
  transport?: AuditPageTransport;
  user?: { id: string } | null;
  verifyThrows?: boolean;
  decryptThrows?: boolean;
  transportThrows?: boolean;
  siteUrl?: string | null;
} = {}) {
  const dataSource = input.dataSource ?? new FakeDataSource();
  const transport = input.transport ?? new AuditPageTransport();
  const activity = {
    verified: 0,
    dataSources: 0,
    decryptions: 0,
    transports: 0,
  };
  const deps: SourceAuditV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      activity.verified += 1;
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      if (input.verifyThrows) throw new Error("private-auth-error");
      return input.user === undefined ? { id: USER_ID } : input.user;
    },
    createDataSource() {
      activity.dataSources += 1;
      return dataSource;
    },
    async decryptCredentialEnvelope(ciphertext) {
      activity.decryptions += 1;
      assert.equal(ciphertext, CIPHERTEXT);
      if (input.decryptThrows) throw new Error("secret-decryption-error");
      return JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    },
    createImpactTransport(credentials, origin) {
      activity.transports += 1;
      assert.deepEqual(credentials, {
        accountSid: ACCOUNT_SID,
        authToken: AUTH_TOKEN,
      });
      assert.equal(origin, "https://api.impact.com");
      if (input.transportThrows) throw new Error("secret-transport-error");
      return transport;
    },
    siteUrl: input.siteUrl === undefined
      ? `${SITE_ORIGIN}/admin/path/`
      : input.siteUrl,
  };
  return {
    handler: createAffiliateSyncSourceAuditV2Handler(deps),
    dataSource,
    transport,
    activity,
  };
}

function request(
  body: unknown = {
    integrationId: INTEGRATION_ID,
    audit: "coupon_ads_coverage",
  },
  options: {
    origin?: string | null;
    authorization?: string | null;
    method?: string;
  } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = options.origin === undefined ? SITE_ORIGIN : options.origin;
  const authorization = options.authorization === undefined
    ? "Bearer verified-jwt"
    : options.authorization;
  if (origin !== null) headers.set("Origin", origin);
  if (authorization !== null) headers.set("Authorization", authorization);
  const method = options.method ?? "POST";
  return new Request("https://edge.example/affiliate-sync-source-audit-v2", {
    method,
    headers,
    body: method === "OPTIONS" || method === "GET" || method === "HEAD"
      ? undefined
      : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("successful host flow is authenticated, exact, trusted and aggregate-only", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    SITE_ORIGIN,
  );
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.deepEqual(fixture.dataSource.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
    `credential:${INTEGRATION_ID}`,
  ]);
  assert.deepEqual(fixture.activity, {
    verified: 1,
    dataSources: 1,
    decryptions: 1,
    transports: 1,
  });
  assert.equal(fixture.transport.requests.length, 2);
  assert.equal(fixture.transport.requests[0]?.url.includes("/Campaigns"), true);
  const adsRequest = new URL(fixture.transport.requests[1]!.url);
  assert.equal(adsRequest.origin, "https://api.impact.com");
  assert.equal(adsRequest.pathname, `/Mediapartners/${ACCOUNT_SID}/Ads`);
  assert.deepEqual([...adsRequest.searchParams.entries()], [
    ["Type", "COUPON"],
    ["Page", "1"],
    ["PageSize", "100"],
  ]);

  const body = await json(response);
  assert.deepEqual(body.host, {
    version: "v2-a11-s2a-1",
    readOnly: true,
    integrationId: INTEGRATION_ID,
    audit: "coupon_ads_coverage",
  });
  const audit = body.audit as Record<string, unknown>;
  assert.equal(audit.complete, true);
  assert.equal(audit.acceptedRecords, 1);
  const serialized = JSON.stringify(body);
  for (
    const secret of [
      ACCOUNT_SID,
      AUTH_TOKEN,
      CIPHERTEXT,
      "ad-sensitive",
      "campaign-sensitive",
      "advertiser-sensitive",
      "deal-sensitive",
      "Merchant Sensitive",
      "CODE-SENSITIVE",
      "DEFAULT-SENSITIVE",
      "tracking.example",
      "landing.example",
    ]
  ) assert.equal(serialized.includes(secret), false);
});

test("coupon Ads PageSize stays hard-fixed at 100 regardless of stored page size", async () => {
  const source = new FakeDataSource();
  source.integration!.pageSize = 321;
  const fixture = harness({ dataSource: source });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const campaignRequest = new URL(fixture.transport.requests[0]!.url);
  const adsRequest = new URL(fixture.transport.requests[1]!.url);
  assert.equal(campaignRequest.searchParams.get("PageSize"), "321");
  assert.equal(adsRequest.searchParams.get("PageSize"), "100");
});

test("only configured SITE_URL origin and exact localhost origins are allowed", async () => {
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
      response.headers.get("Access-Control-Allow-Methods"),
      "POST, OPTIONS",
    );
    assert.equal(
      response.headers.get("Access-Control-Allow-Headers"),
      "authorization, apikey, content-type, x-client-info",
    );
    assert.equal(
      response.headers.has("Access-Control-Allow-Credentials"),
      false,
    );
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
      verified: 0,
      dataSources: 0,
      decryptions: 0,
      transports: 0,
    });
    assert.deepEqual(fixture.dataSource.operations, []);
    assert.equal(fixture.transport.requests.length, 0);
  }
});

test("OPTIONS terminates before authentication, privileged reads and provider work", async () => {
  const fixture = harness();
  const response = await fixture.handler(
    request(undefined, { method: "OPTIONS" }),
  );
  assert.equal(response.status, 204);
  assert.deepEqual(fixture.activity, {
    verified: 0,
    dataSources: 0,
    decryptions: 0,
    transports: 0,
  });
  assert.deepEqual(fixture.dataSource.operations, []);
  assert.deepEqual(fixture.transport.requests, []);
});

test("method and strict Bearer checks precede privileged work", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const fixture = harness();
    const response = await fixture.handler(request(undefined, { method }));
    assert.equal(response.status, 405);
    assert.equal(fixture.activity.verified, 0);
    assert.equal(fixture.activity.dataSources, 0);
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
    const response = await fixture.handler(
      request(undefined, { authorization }),
    );
    assert.equal(response.status, 401);
    assert.equal(fixture.activity.verified, 0);
    assert.equal(fixture.activity.dataSources, 0);
  }
});

test("unverified and non-admin users cannot reach request or integration processing", async () => {
  for (const user of [null, { id: "not-a-uuid" }]) {
    const fixture = harness({ user });
    const response = await fixture.handler(request());
    assert.equal(response.status, 401);
    assert.equal(fixture.activity.dataSources, 0);
    assert.deepEqual(fixture.dataSource.operations, []);
  }
  const nonAdminSource = new FakeDataSource();
  nonAdminSource.admin = false;
  const nonAdmin = harness({ dataSource: nonAdminSource });
  const response = await nonAdmin.handler(request());
  assert.equal(response.status, 403);
  assert.deepEqual(nonAdminSource.operations, [`admin:${USER_ID}`]);
  assert.equal(nonAdmin.activity.decryptions, 0);
  assert.equal(nonAdmin.activity.transports, 0);
});

test("secret-bearing thrown host failures return only fixed classifications", async () => {
  const fixtures: Array<{
    configure(source: FakeDataSource): void;
    options?: {
      verifyThrows?: boolean;
      decryptThrows?: boolean;
      transportThrows?: boolean;
    };
    expectedStatus: number;
  }> = [
    {
      configure() {},
      options: { verifyThrows: true },
      expectedStatus: 401,
    },
    {
      configure(source) {
        source.throwAt = "admin";
      },
      expectedStatus: 403,
    },
    {
      configure(source) {
        source.throwAt = "integration";
      },
      expectedStatus: 500,
    },
    {
      configure(source) {
        source.throwAt = "credential";
      },
      expectedStatus: 422,
    },
    {
      configure() {},
      options: { decryptThrows: true },
      expectedStatus: 422,
    },
    {
      configure() {},
      options: { transportThrows: true },
      expectedStatus: 502,
    },
  ];
  for (const fixtureCase of fixtures) {
    const source = new FakeDataSource();
    fixtureCase.configure(source);
    const fixture = harness({ dataSource: source, ...fixtureCase.options });
    const response = await fixture.handler(request());
    assert.equal(response.status, fixtureCase.expectedStatus);
    const serialized = JSON.stringify(await json(response));
    assert.equal(serialized.includes("secret-"), false);
    assert.equal(serialized.includes(ACCOUNT_SID), false);
    assert.equal(serialized.includes(AUTH_TOKEN), false);
    assert.equal(serialized.includes(CIPHERTEXT), false);
  }
});

test("request body accepts exactly integrationId plus coupon_ads_coverage", async () => {
  const invalidBodies: unknown[] = [
    null,
    [],
    {},
    { integrationId: INTEGRATION_ID },
    { audit: "coupon_ads_coverage" },
    { integrationId: "not-a-uuid", audit: "coupon_ads_coverage" },
    { integrationId: INTEGRATION_ID, audit: "wrong" },
    {
      integrationId: INTEGRATION_ID,
      audit: "coupon_ads_coverage",
      extra: true,
    },
    {
      integrationId: INTEGRATION_ID,
      audit: "coupon_ads_coverage",
      url: "https://evil.example",
    },
  ];
  for (const body of invalidBodies) {
    const fixture = harness();
    const response = await fixture.handler(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.dataSource.operations, [`admin:${USER_ID}`]);
    assert.equal(fixture.activity.decryptions, 0);
    assert.equal(fixture.activity.transports, 0);
  }
});

test("integration, provider and credential failures are fixed and pre-provider", async () => {
  const cases: Array<
    readonly [
      (source: FakeDataSource) => void,
      number,
      string,
    ]
  > = [
    [(source) => source.integration = null, 404, "integration_not_found"],
    [
      (source) =>
        source.integration!.id = "33333333-3333-4333-8333-333333333333",
      422,
      "invalid_integration_config",
    ],
    [
      (source) => source.integration!.isEnabled = false,
      409,
      "integration_disabled",
    ],
    [
      (source) => source.integration!.providerName = "other",
      422,
      "provider_not_impact",
    ],
    [(source) => source.ciphertext = null, 422, "credentials_unavailable"],
    [
      (source) => source.integration!.authenticationType = "bearer",
      422,
      "invalid_integration_config",
    ],
  ];
  for (const [mutate, status, code] of cases) {
    const source = new FakeDataSource();
    mutate(source);
    const fixture = harness({ dataSource: source });
    const response = await fixture.handler(request());
    assert.equal(response.status, status);
    assert.equal(
      ((await json(response)).error as Record<string, unknown>).code,
      code,
    );
    assert.equal(fixture.activity.transports, 0);
    assert.equal(fixture.transport.requests.length, 0);
  }
});

test("a mismatched integration row cannot select another credential", async () => {
  const source = new FakeDataSource();
  source.integration!.id = "33333333-3333-4333-8333-333333333333";
  const fixture = harness({ dataSource: source });
  const response = await fixture.handler(request());
  assert.equal(response.status, 422);
  assert.deepEqual(source.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
  ]);
  assert.equal(fixture.activity.decryptions, 0);
  assert.equal(fixture.activity.transports, 0);
  assert.equal(fixture.transport.requests.length, 0);
});

test("Campaign evidence must complete before any Ads request", async () => {
  const transport = new AuditPageTransport();
  transport.campaignsMalformed = true;
  const fixture = harness({ transport });
  const response = await fixture.handler(request());
  assert.equal(response.status, 502);
  assert.equal(
    ((await json(response)).error as Record<string, unknown>).code,
    "campaign_fetch_failed",
  );
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]?.url.includes("/Campaigns"), true);
  assert.equal(
    transport.requests.some((entry) => entry.url.includes("/Ads")),
    false,
  );
});

test("a low numeric Campaign rate budget stops before another Campaign or Ads request", async () => {
  for (
    const continuation of [null, "https://api.impact.com/campaigns?page=2"]
  ) {
    const transport = new AuditPageTransport();
    transport.campaignRate = {
      limit: 1_000,
      remaining: 10,
      reset: 1_800_000_000,
    };
    transport.campaignContinuation = continuation;
    const fixture = harness({ transport });
    const response = await fixture.handler(request());
    assert.equal(response.status, 502);
    assert.equal(
      ((await json(response)).error as Record<string, unknown>).code,
      "campaign_fetch_failed",
    );
    assert.equal(transport.requests.length, 1);
    assert.equal(transport.requests[0]?.url.includes("/Campaigns"), true);
    assert.equal(transport.rateResets, 0);
  }
});

test("a malformed Ads page returns bounded incomplete evidence, not provider data", async () => {
  const transport = new AuditPageTransport();
  transport.adsMalformed = true;
  const fixture = harness({ transport });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const body = await json(response);
  const audit = body.audit as Record<string, unknown>;
  assert.equal(audit.complete, false);
  assert.equal(audit.stopReason, "malformed_page");
  assert.equal(JSON.stringify(body).includes("Wrong"), false);
});
