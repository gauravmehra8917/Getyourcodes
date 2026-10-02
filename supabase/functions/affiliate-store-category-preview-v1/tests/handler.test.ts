import assert from "node:assert/strict";
import test from "node:test";
import { createCategoryPreviewHandler } from "../handler.ts";
import type { CategoryPreviewDataSource, CategoryPreviewDependencies } from "../types.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import type {
  ImpactAdsTransportV2,
  ImpactAdsTransportRequestV2,
} from "../../_shared/affiliate-sync-v2-ads/ads-diagnostics.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const STORE = "33333333-3333-4333-8333-333333333333";
const CATEGORY = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "https://admin.example";
const integration: StoredIntegrationV2 = {
  id: ID,
  providerName: "impact",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: { campaigns: "/Mediapartners/{AccountSID}/Campaigns" },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 10,
  pageSize: 100,
  maxPages: 50,
  publishingPolicyId: null,
};

function harness(
  options: {
    user?: { id: string } | null;
    admin?: boolean;
    integration?: StoredIntegrationV2 | null;
    taxonomy?: unknown;
    categoryId?: string | null;
    failAt?: string;
    body?: unknown;
    siteUrl?: string | null;
  } = {},
) {
  const operations: string[] = [];
  const op = (name: string) => {
    operations.push(name);
    if (options.failAt === name) throw new Error("secret SQL stack Authorization credential");
  };
  const source: CategoryPreviewDataSource = {
    async hasAdminRole() {
      op("admin");
      return options.admin ?? true;
    },
    async readIntegration() {
      op("integration");
      return options.integration === undefined ? integration : options.integration;
    },
    async readStores() {
      op("stores");
      return [
        {
          id: STORE,
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: "private-campaign",
          categoryId: options.categoryId ?? null,
        },
      ];
    },
    async readCategoryIds() {
      op("categories");
      return [CATEGORY];
    },
    async readMappings() {
      op("mappings");
      return [
        {
          id: USER,
          provider: "impact",
          normalizedProviderCategoryKey: "fashion",
          categoryId: CATEGORY,
          priority: 100,
          enabled: true,
        },
      ];
    },
    async readCredentialCiphertext() {
      op("ciphertext");
      return "private-ciphertext";
    },
  };
  const requests: ImpactAdsTransportRequestV2[] = [];
  const transport: ImpactAdsTransportV2 = {
    async execute(request) {
      op("fetch");
      requests.push(request);
      return {
        kind: "response",
        status: 200,
        retryAfterMs: null,
        bodyText: JSON.stringify(
          options.body ?? {
            Campaigns: [
              {
                CampaignId: "private-campaign",
                Category: options.taxonomy ?? "Fashion",
                CampaignName: "private-name",
                TrackingLink: "private-url",
                Credential: "private-provider-data",
              },
            ],
          },
        ),
      };
    },
    async wait() {
      throw new Error("no retry expected");
    },
    readRateSnapshot: () => ({ limit: null, remaining: null, reset: null }),
    consumeResponseSizeLimitExceeded: () => false,
  };
  const dependencies: CategoryPreviewDependencies = {
    siteUrl: options.siteUrl === undefined ? ORIGIN : options.siteUrl,
    async verifyUser(authorization, jwt) {
      op("verify");
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      return options.user === undefined ? { id: USER } : options.user;
    },
    createDataSource() {
      op("source");
      return source;
    },
    async decryptCredentialEnvelope() {
      op("decrypt");
      return JSON.stringify({ accountSid: "private-account", authToken: "private-token" });
    },
    createImpactTransport(credentials, origin) {
      op("transport");
      assert.equal(origin, "https://api.impact.com");
      assert.equal(credentials.authToken, "private-token");
      return transport;
    },
  };
  return {
    handler: createCategoryPreviewHandler(dependencies),
    operations,
    requests,
    dependencies,
    source,
  };
}

function request(
  body: unknown = { integrationId: ID, preview: true },
  options: { origin?: string | null; method?: string; authorization?: string | null } = {},
) {
  const method = options.method ?? "POST";
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const auth = options.authorization === undefined ? "Bearer verified-jwt" : options.authorization;
  if (origin !== null) headers.set("Origin", origin);
  if (auth !== null) headers.set("Authorization", auth);
  return new Request("https://edge.example/category-preview", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

test("success uses authenticated admin trust order and returns only aggregate category counts", async () => {
  const h = harness();
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(h.operations, [
    "verify",
    "source",
    "admin",
    "integration",
    "stores",
    "categories",
    "mappings",
    "ciphertext",
    "decrypt",
    "transport",
    "fetch",
  ]);
  assert.equal(h.requests.length, 1);
  assert.equal(new URL(h.requests[0]!.url).pathname, "/Mediapartners/private-account/Campaigns");
  const body = await response.json();
  assert.deepEqual(body.host, { version: "p1c-a1-v1", readOnly: true, integrationId: ID });
  assert.equal(body.result.summary.assignable, 1);
  assert.deepEqual(body.result.unmappedLabels, []);
  assert.equal(body.result.unmappedLabelsTruncated, false);
  for (const secret of ["private-", STORE, CATEGORY, "Fashion", "Authorization", "ciphertext"]) {
    assert.equal(JSON.stringify(body).includes(secret), false, secret);
  }
});

test("non-null store category is protected during preview", async () => {
  const response = await harness({ categoryId: CATEGORY, taxonomy: { broken: true } }).handler(
    request(),
  );
  const body = await response.json();
  assert.equal(body.result.summary.alreadyCategorized, 1);
  assert.equal(body.result.summary.assignable, 0);
  assert.deepEqual(body.result.unmappedLabels, []);
  assert.equal(body.result.unmappedLabelsTruncated, false);
});

test("malformed provider records are counted without payload disclosure or assignment", async () => {
  const response = await harness({
    body: {
      Campaigns: [
        null,
        { AdvertiserId: "private-campaign", Category: "Fashion" },
        { CampaignId: "private-campaign", Category: 12 },
      ],
    },
  }).handler(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.summary.invalidSource, 3);
  assert.equal(body.result.summary.assignable, 0);
});

test("CORS accepts configured and exact local origins; preflight does no trusted work", async () => {
  for (const origin of [
    ORIGIN,
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ]) {
    const h = harness();
    const response = await h.handler(request(undefined, { origin, method: "OPTIONS" }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Vary"), "Origin");
    assert.deepEqual(h.operations, []);
  }
  for (const origin of [null, "null", "https://admin.example.evil", "http://localhost:8081"]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { origin }))).status, 403);
    assert.deepEqual(h.operations, []);
  }
  assert.equal((await harness({ siteUrl: "invalid" }).handler(request())).status, 403);
  assert.equal(
    (
      await harness({ siteUrl: null }).handler(
        request(undefined, { origin: "http://localhost:8080", method: "OPTIONS" }),
      )
    ).status,
    204,
  );
});

test("methods, strict bearer authentication and verified user gate privileged reads", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { method }))).status, 405);
    assert.deepEqual(h.operations, []);
  }
  for (const authorization of [null, "", "bearer jwt", "Bearer  jwt", "Bearer jwt extra"]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { authorization }))).status, 401);
    assert.deepEqual(h.operations, []);
  }
  for (const user of [null, { id: "invalid" }]) {
    const h = harness({ user });
    assert.equal((await h.handler(request())).status, 401);
    assert.deepEqual(h.operations, ["verify"]);
  }
});

test("admin authorization is required before integration, catalog or credential reads", async () => {
  const h = harness({ admin: false });
  assert.equal((await h.handler(request())).status, 403);
  assert.deepEqual(h.operations, ["verify", "source", "admin"]);
});

test("exact preview-only request body rejects apply fields and oversized input", async () => {
  for (const body of [
    null,
    [],
    {},
    { integrationId: ID },
    { integrationId: ID, preview: false },
    { integrationId: "invalid", preview: true },
    { integrationId: ID, preview: true, apply: true },
    { integrationId: ID, preview: true, extra: "x".repeat(2000) },
  ]) {
    const h = harness();
    assert.equal((await h.handler(request(body))).status, 400);
    assert.deepEqual(h.operations, ["verify", "source", "admin"]);
  }
});

test("integration identity, enabled state, provider and configuration are enforced", async () => {
  for (const [row, status] of [
    [null, 404],
    [{ ...integration, id: USER }, 422],
    [{ ...integration, isEnabled: false }, 409],
    [{ ...integration, providerName: "other" }, 422],
    [{ ...integration, authenticationType: "bearer" }, 422],
    [{ ...integration, endpointConfiguration: { campaigns: "/unapproved/{AccountSID}/Ads" } }, 422],
  ] as const) {
    const h = harness({ integration: row });
    assert.equal((await h.handler(request())).status, status);
    assert.equal(h.requests.length, 0);
  }
});

test("all failure responses hide provider, SQL and credential exception text", async () => {
  for (const [failAt, status] of [
    ["verify", 401],
    ["source", 403],
    ["admin", 403],
    ["integration", 500],
    ["stores", 500],
    ["categories", 500],
    ["mappings", 500],
    ["ciphertext", 422],
    ["decrypt", 422],
    ["transport", 502],
    ["fetch", 502],
  ] as const) {
    const response = await harness({ failAt }).handler(request());
    assert.equal(response.status, status, failAt);
    const body = await response.text();
    assert.equal(body.includes("secret SQL"), false);
    assert.equal(body.includes("private-"), false);
  }
});

test("incomplete and malformed Campaign pages fail closed", async () => {
  for (const body of [
    { Wrong: [] },
    { Campaigns: [], "@page": 1, "@numpages": 2 },
    { Campaigns: [], "@nextpageuri": "https://evil.example/steal" },
  ]) {
    const h = harness({ body });
    const response = await h.handler(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "campaign_fetch_failed");
    assert.equal(h.requests.length, 1);
  }
});

test("fixed Campaign bounds stop pagination without returning partial assignable evidence", async () => {
  const h = harness();
  h.dependencies.createImpactTransport = () => ({
    async execute(req) {
      h.requests.push(req);
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("Page"));
      url.searchParams.set("Page", String(page + 1));
      return {
        kind: "response",
        status: 200,
        retryAfterMs: null,
        bodyText: JSON.stringify({
          Campaigns: Array.from({ length: 100 }, (_, i) => ({
            CampaignId: `c-${page}-${i}`,
            Category: "Fashion",
          })),
          "@nextpageuri": url.toString(),
        }),
      };
    },
    async wait() {},
    readRateSnapshot: () => ({ limit: null, remaining: null, reset: null }),
    consumeResponseSizeLimitExceeded: () => false,
  });
  const response = await h.handler(request());
  assert.equal(response.status, 502);
  assert.equal(h.requests.length, 10);
});

test("oversized Campaign response is held before parsing", async () => {
  const h = harness({ body: { Campaigns: [], Unused: "x".repeat(2_000_001) } });
  assert.equal((await h.handler(request())).status, 502);
});

test("catalog overflow fails before secrets and transport", async () => {
  const h = harness();
  h.source.readCategoryIds = async () => Array(10_001).fill(CATEGORY);
  assert.equal((await h.handler(request())).status, 500);
  assert.equal(h.operations.includes("ciphertext"), false);
});

test("preview Campaign identities match Ads canonical strings including whitespace and numbers", async () => {
  for (const campaignId of [" private-campaign ", 123, -1.5]) {
    const h = harness({ body: { Campaigns: [{ CampaignId: campaignId, Category: "Fashion" }] } });
    h.source.readStores = async () => [
      {
        id: STORE,
        provider: "impact",
        providerEntityNamespace: "campaign",
        providerEntityId: typeof campaignId === "string" ? campaignId.trim() : String(campaignId),
        categoryId: null,
      },
    ];
    const response = await h.handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.summary.assignable, 1);
  }
});

test("admin preview returns bounded unmapped observations without IDs, secrets or provider metadata", async () => {
  const h = harness({
    body: {
      "@page": 1,
      "@numpages": 1,
      "@pagesize": 100,
      Private: "private-raw-payload",
      Campaigns: [
        {
          CampaignId: "private-campaign",
          Categories: [" travel ", "Travel", "Travel"],
          Credential: "private-provider-secret",
          TrackingLink: "private-affiliate-url",
          AdvertiserId: "private-advertiser",
        },
        {
          CampaignId: "private-campaign-2",
          Categories: ["TRAVEL", "Hotels"],
          CampaignName: "private-name",
        },
      ],
    },
  });
  h.source.readStores = async () =>
    ["private-campaign", "private-campaign-2"].map((providerEntityId) => ({
      id: STORE,
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId,
      categoryId: null,
    }));
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.result.unmappedLabels, [
    { label: "Hotels", key: "hotels", campaignCount: 1 },
    { label: "TRAVEL", key: "travel", campaignCount: 2 },
  ]);
  assert.equal(body.result.unmappedLabelsTruncated, false);
  assert.equal(body.result.summary.distinctUnmappedLabels, 2);
  assert.deepEqual(Object.keys(body.result).sort(), [
    "complete",
    "summary",
    "unmappedLabels",
    "unmappedLabelsTruncated",
  ]);
  for (const forbidden of [
    "private-",
    STORE,
    CATEGORY,
    USER,
    "@page",
    "@numpages",
    "@pagesize",
    "Authorization",
    "ciphertext",
    "baseUrl",
    "endpointConfiguration",
    "CampaignId",
    "providerEntityId",
  ]) {
    assert.equal(JSON.stringify(body).includes(forbidden), false, forbidden);
  }
  const unauthorized = harness({ admin: false, taxonomy: "Travel" });
  const rejected = await unauthorized.handler(request());
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.text()).includes("unmappedLabels"), false);
  assert.equal(unauthorized.requests.length, 0);
});

test("public preview caps observations at 100 while reporting the full distinct total", async () => {
  for (const size of [100, 101]) {
    const campaigns = Array.from({ length: size }, (_, index) => ({
      CampaignId: `private-${index}`,
      Category: `Label ${String(index).padStart(3, "0")}`,
    }));
    const h = harness({ body: { Campaigns: [...campaigns].reverse() } });
    h.source.readStores = async () =>
      campaigns.map((campaign) => ({
        id: STORE,
        provider: "impact",
        providerEntityNamespace: "campaign",
        providerEntityId: campaign.CampaignId,
        categoryId: null,
      }));
    const response = await h.handler(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.summary.distinctUnmappedLabels, size);
    assert.equal(body.result.unmappedLabels.length, 100);
    assert.equal(body.result.unmappedLabelsTruncated, size > 100);
    assert.deepEqual(body.result.unmappedLabels[0], {
      label: "Label 000",
      key: "label 000",
      campaignCount: 1,
    });
    assert.deepEqual(body.result.unmappedLabels[99], {
      label: "Label 099",
      key: "label 099",
      campaignCount: 1,
    });
  }
});

test("public unmapped work excludes manually categorized and assignable stores", async () => {
  const h = harness({
    body: {
      Campaigns: [
        { CampaignId: "private-campaign", Category: "Manual Category" },
        { CampaignId: "private-campaign-2", Categories: ["Fashion", "Other Label"] },
      ],
    },
  });
  h.source.readStores = async () =>
    ["private-campaign", "private-campaign-2"].map((providerEntityId, index) => ({
      id: STORE,
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId,
      categoryId: index === 0 ? CATEGORY : null,
    }));
  const response = await h.handler(request());
  const body = await response.json();
  assert.equal(body.result.summary.alreadyCategorized, 1);
  assert.equal(body.result.summary.assignable, 1);
  assert.equal(body.result.summary.distinctUnmappedLabels, 0);
  assert.deepEqual(body.result.unmappedLabels, []);
  assert.equal(body.result.unmappedLabelsTruncated, false);
});
