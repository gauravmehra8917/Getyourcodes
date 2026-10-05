import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../../_shared/affiliate-sync-v2/contracts.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { resolveCouponAdsAuditConfigV2 } from "../impact-audit-configuration.ts";
import { createAffiliateSyncSourceAuditV2Handler } from "../handler.ts";
import type {
  ImpactAuditTransportV2,
  ImpactRateSnapshotV2,
  SourceAuditV2DataSource,
  SourceAuditV2HostDependencies,
  StoreCategoryTaxonomyHostResponseV2,
  StoreCategoryTaxonomyPageHostResponseV2,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ORIGIN = "https://admin.example";
const CREDENTIALS = {
  accountSid: "account-sensitive",
  authToken: "token-sensitive",
};
const CAMPAIGNS_PATH = `/Mediapartners/${CREDENTIALS.accountSid}/Campaigns`;
const PAGE_MODE = "store_category_taxonomy_page";

function campaignPage(
  page: number,
  campaigns: unknown[] = [{
    CampaignId: `campaign-sensitive-${page}`,
    AdvertiserId: `advertiser-sensitive-${page}`,
    CampaignName: `merchant-sensitive-${page}`,
    Category: `Category ${page}`,
  }],
  hasMore = false,
): Record<string, unknown> {
  return {
    "@page": String(page),
    "@numpages": String(hasMore ? page + 1 : page),
    "@nextpageuri": hasMore
      ? `${CAMPAIGNS_PATH}?Page=${page + 1}&PageSize=100&cursor=secret-cursor`
      : null,
    Campaigns: campaigns,
  };
}

function providerResponse(body: unknown, status = 200): ImpactTransportResult {
  return {
    kind: "response",
    status,
    bodyText: JSON.stringify(body),
    retryAfterMs: null,
  };
}

class CampaignTransport implements ImpactAuditTransportV2 {
  readonly requests: ImpactTransportRequest[] = [];
  readonly waits: number[] = [];
  rate: ImpactRateSnapshotV2 = { limit: null, remaining: null, reset: null };
  rateResets = 0;
  respond: (request: ImpactTransportRequest) => ImpactTransportResult = (
    request,
  ) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/Ads")) return providerResponse({ Ads: [] });
    assert.equal(url.pathname, CAMPAIGNS_PATH);
    return providerResponse(campaignPage(Number(url.searchParams.get("Page"))));
  };

  async execute(
    request: ImpactTransportRequest,
  ): Promise<ImpactTransportResult> {
    this.requests.push(request);
    return this.respond(request);
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

function harness() {
  const integration: StoredIntegrationV2 = {
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
    retryAttempts: 20,
    pageSize: 100,
    maxPages: 50,
    publishingPolicyId: null,
  };
  const operations: string[] = [];
  const dataSource: SourceAuditV2DataSource = Object.freeze({
    async hasAdminRole(userId: string) {
      operations.push(`admin:${userId}`);
      return true;
    },
    async readIntegration(integrationId: string) {
      operations.push(`integration:${integrationId}`);
      return integration;
    },
    async readCredentialCiphertext(integrationId: string) {
      operations.push(`credential:${integrationId}`);
      return "ciphertext-sensitive";
    },
  });
  const transport = new CampaignTransport();
  const activity = { decryptions: 0, transports: 0 };
  const dependencies: SourceAuditV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      return { id: USER_ID };
    },
    createDataSource: () => dataSource,
    async decryptCredentialEnvelope(ciphertext) {
      assert.equal(ciphertext, "ciphertext-sensitive");
      activity.decryptions += 1;
      return JSON.stringify(CREDENTIALS);
    },
    createImpactTransport(credentials, origin) {
      assert.deepEqual(credentials, CREDENTIALS);
      assert.equal(origin, "https://api.impact.com");
      activity.transports += 1;
      return transport;
    },
    siteUrl: SITE_ORIGIN,
  };
  return {
    handler: createAffiliateSyncSourceAuditV2Handler(dependencies),
    integration,
    dataSource,
    operations,
    transport,
    activity,
  };
}

function pageRequest(page: unknown = 1): Record<string, unknown> {
  return { integrationId: INTEGRATION_ID, audit: PAGE_MODE, page };
}

function request(body: unknown = pageRequest(), signal?: AbortSignal): Request {
  return new Request("https://edge.example/affiliate-sync-source-audit-v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SITE_ORIGIN,
      Authorization: "Bearer verified-jwt",
    },
    body: JSON.stringify(body),
    signal,
  });
}

function assertOnlyCampaigns(transport: CampaignTransport, count = 1): void {
  assert.equal(transport.requests.length, count);
  for (const entry of transport.requests) {
    assert.equal(new URL(entry.url).pathname, CAMPAIGNS_PATH);
    assert.equal(entry.method, "GET");
    assert.equal(entry.redirect, "error");
    assert.equal(entry.credentialDisposition, "attach_if_same_origin");
  }
  assert.deepEqual(transport.waits, []);
  assert.equal(transport.rateResets, 0);
}

async function assertClosed(response: Response): Promise<void> {
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    host: { version: "v2-a11-s2a-1", readOnly: true },
    error: {
      code: "campaign_fetch_failed",
      message: "Impact Campaign evidence could not be completed.",
    },
  });
}

for (const page of [1, 50]) {
  test(`paged taxonomy accepts page ${page} and returns its exact bounded shape`, async () => {
    const fixture = harness();
    const response = await fixture.handler(request(pageRequest(page)));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      host: {
        version: "v2-a11-s2a-1",
        readOnly: true,
        integrationId: INTEGRATION_ID,
        audit: PAGE_MODE,
      },
      page: { requested: page, recordsEvaluated: 1, hasMore: false },
      audit: {
        complete: true,
        campaignsEvaluated: 1,
        campaignsWithUsableTaxonomy: 1,
        campaignsWithoutTaxonomy: 0,
        invalidTaxonomyCampaigns: 0,
        distinctLabels: 1,
        labels: [{
          label: `Category ${page}`,
          key: `category ${page}`,
          campaignCount: 1,
        }],
        labelsTruncated: false,
        fieldCoverage: {
          Categories: {
            present: 0,
            validString: 0,
            validArray: 0,
            malformed: 0,
          },
          Category: { present: 1, validString: 1, validArray: 0, malformed: 0 },
          Vertical: { present: 0, validString: 0, validArray: 0, malformed: 0 },
          Verticals: {
            present: 0,
            validString: 0,
            validArray: 0,
            malformed: 0,
          },
        },
      },
    });
    assertOnlyCampaigns(fixture.transport);
    assert.equal(
      new URL(fixture.transport.requests[0]!.url).searchParams.get("Page"),
      String(page),
    );
  });
}

for (
  const [label, page] of [
    ["zero", 0],
    ["negative", -1],
    ["above fifty", 51],
    ["decimal", 1.5],
    ["string", "1"],
    ["null", null],
    ["true", true],
    ["false", false],
    ["array", [1]],
    ["object", { Page: 1 }],
  ] as const
) {
  test(`paged taxonomy rejects ${label} page before integration or provider reads`, async () => {
    const fixture = harness();
    const response = await fixture.handler(request(pageRequest(page)));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
    assert.deepEqual(fixture.operations, [`admin:${USER_ID}`]);
    assert.deepEqual(fixture.activity, { decryptions: 0, transports: 0 });
    assert.deepEqual(fixture.transport.requests, []);
  });
}

test("paged taxonomy requires exactly three fields and refuses client paging capabilities", async () => {
  const bodies: unknown[] = [
    { integrationId: INTEGRATION_ID, audit: PAGE_MODE },
    { ...pageRequest(), extra: true },
    { ...pageRequest(), PageSize: 500 },
    { ...pageRequest(), pageSize: 500 },
    { ...pageRequest(), url: "https://evil.example" },
    { ...pageRequest(), continuationUrl: "https://evil.example" },
    { ...pageRequest(), continuationToken: "secret-cursor" },
    { ...pageRequest(), integrationId: "not-a-uuid" },
    { ...pageRequest(), audit: "unknown" },
    null,
    [],
  ];
  for (const body of bodies) {
    const fixture = harness();
    const response = await fixture.handler(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.operations, [`admin:${USER_ID}`]);
    assert.deepEqual(fixture.activity, { decryptions: 0, transports: 0 });
    assert.deepEqual(fixture.transport.requests, []);
  }
});

test("existing modes still accept only their original two-field requests", async () => {
  for (const audit of ["coupon_ads_coverage", "store_category_taxonomy"]) {
    const fixture = harness();
    const response = await fixture.handler(
      request({ integrationId: INTEGRATION_ID, audit }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.host.audit, audit);
    assert.deepEqual(Object.keys(body).sort(), ["audit", "host"]);
    assert.equal(
      fixture.transport.requests.length,
      audit === "coupon_ads_coverage" ? 2 : 1,
    );
    for (const extra of [{ page: 1 }, { PageSize: 100 }, { extra: true }]) {
      const rejected = harness();
      const invalid = await rejected.handler(
        request({ integrationId: INTEGRATION_ID, audit, ...extra }),
      );
      assert.equal(invalid.status, 400);
      assert.deepEqual(rejected.transport.requests, []);
    }
  }
});

test("requested page replaces only Page and retains every approved URL setting", async () => {
  const fixture = harness();
  fixture.integration.pageSize = 321;
  fixture.integration.endpointConfiguration.campaigns =
    "GET /Mediapartners/{AccountSID}/Campaigns?Status=ACTIVE&Page=7&PageSize=3&Filter=a%20b&Filter=c";
  const original = new URL(
    resolveCouponAdsAuditConfigV2(fixture.integration, CREDENTIALS)
      .campaignsInitialUrl,
  );
  const response = await fixture.handler(request(pageRequest(50)));
  assert.equal(response.status, 200);
  assertOnlyCampaigns(fixture.transport);
  const actual = new URL(fixture.transport.requests[0]!.url);
  assert.equal(actual.origin, original.origin);
  assert.equal(actual.pathname, original.pathname);
  assert.equal(actual.searchParams.get("Page"), "50");
  assert.equal(original.searchParams.get("Page"), "7");
  assert.equal(actual.searchParams.get("PageSize"), "3");
  assert.deepEqual(
    [...actual.searchParams].filter(([key]) => key !== "Page"),
    [...original.searchParams].filter(([key]) => key !== "Page"),
  );
});

test("Campaign PageSize follows stored configuration when the endpoint omits it", async () => {
  const fixture = harness();
  fixture.integration.pageSize = 321;
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assertOnlyCampaigns(fixture.transport);
  assert.equal(
    new URL(fixture.transport.requests[0]!.url).searchParams.get("PageSize"),
    "321",
  );
});

test("maxPages=1 accepts page_limit and evaluates only that one physical Campaign page", async () => {
  const fixture = harness();
  fixture.transport.respond = () =>
    providerResponse(campaignPage(2, undefined, true));
  const response = await fixture.handler(request(pageRequest(2)));
  assert.equal(response.status, 200);
  const body = await response.json() as StoreCategoryTaxonomyPageHostResponseV2;
  assert.deepEqual(body.page, {
    requested: 2,
    recordsEvaluated: 1,
    hasMore: true,
  });
  assert.deepEqual(body.audit.labels, [{
    label: "Category 2",
    key: "category 2",
    campaignCount: 1,
  }]);
  assertOnlyCampaigns(fixture.transport);
});

test("completed without a continuation returns hasMore=false even on an empty page", async () => {
  for (const envelope of [campaignPage(1, []), { Campaigns: [] }]) {
    const fixture = harness();
    fixture.transport.respond = () => providerResponse(envelope);
    const response = await fixture.handler(request());
    assert.equal(response.status, 200);
    const body = await response
      .json() as StoreCategoryTaxonomyPageHostResponseV2;
    assert.deepEqual(body.page, {
      requested: 1,
      recordsEvaluated: 0,
      hasMore: false,
    });
    assert.equal(body.audit.complete, true);
    assert.equal(body.audit.campaignsEvaluated, 0);
    assertOnlyCampaigns(fixture.transport);
  }
});

test("maxRecords equals the approved PageSize and refuses an oversized page", async () => {
  for (const count of [3, 4]) {
    const fixture = harness();
    fixture.integration.endpointConfiguration.campaigns =
      "/Mediapartners/{AccountSID}/Campaigns?PageSize=3";
    fixture.transport.respond = () =>
      providerResponse(
        campaignPage(
          1,
          Array.from({ length: count }, (_, index) => ({
            CampaignId: `private-campaign-${index}`,
            Category: `Label ${index}`,
          })),
          true,
        ),
      );
    const response = await fixture.handler(request());
    if (count === 3) {
      assert.equal(response.status, 200);
      const body = await response
        .json() as StoreCategoryTaxonomyPageHostResponseV2;
      assert.equal(body.page.recordsEvaluated, 3);
      assert.equal(body.page.hasMore, true);
    } else {
      await assertClosed(response);
    }
    assertOnlyCampaigns(fixture.transport);
  }
});

test("malformed Campaign envelopes and malformed continuation metadata fail closed", async () => {
  const invalidBodies: unknown[] = [
    null,
    [],
    { Wrong: [] },
    { Campaigns: {} },
    { Campaigns: [], "@nextpageuri": false },
    { Campaigns: [], "@nextpageuri": "" },
    { Campaigns: [], "@nextpageuri": null },
  ];
  for (const body of invalidBodies) {
    const fixture = harness();
    fixture.transport.respond = () => providerResponse(body);
    await assertClosed(await fixture.handler(request()));
    assertOnlyCampaigns(fixture.transport);
  }
  const fixture = harness();
  fixture.transport.respond = () => ({
    kind: "response",
    status: 200,
    bodyText: "{invalid secret-json",
    retryAfterMs: null,
  });
  await assertClosed(await fixture.handler(request()));
  assertOnlyCampaigns(fixture.transport);
});

test("invalid continuation URLs fail closed without following or exposing them", async () => {
  for (
    const next of [
      "https://evil.example/private?token=secret-token",
      "http://api.impact.com/private",
      "https://user:password@api.impact.com/private",
      "javascript:alert(1)",
    ]
  ) {
    const fixture = harness();
    fixture.transport.respond = () =>
      providerResponse({ ...campaignPage(1), "@nextpageuri": next });
    await assertClosed(await fixture.handler(request()));
    assertOnlyCampaigns(fixture.transport);
  }
});

for (const status of [401, 429, 503]) {
  test(`provider HTTP ${status} fails closed with maxAttempts=1 despite stored retries`, async () => {
    const fixture = harness();
    fixture.transport.respond = () =>
      providerResponse({ secret: "secret-provider-error" }, status);
    await assertClosed(await fixture.handler(request()));
    assertOnlyCampaigns(fixture.transport);
  });
}

test("provider timeout, abort, transport failure and thrown errors fail closed", async () => {
  for (
    const result of [
      { kind: "timeout", errorCode: null },
      { kind: "aborted", errorCode: null },
      { kind: "transport_error", errorCode: "secret-transport-code" },
    ] as const
  ) {
    const fixture = harness();
    fixture.transport.respond = () => result;
    await assertClosed(await fixture.handler(request()));
    assertOnlyCampaigns(fixture.transport);
  }
  const fixture = harness();
  fixture.transport.respond = () => {
    throw new Error("secret-provider-exception");
  };
  await assertClosed(await fixture.handler(request()));
  assertOnlyCampaigns(fixture.transport);
});

test("caller cancellation fails closed before a physical provider request", async () => {
  const fixture = harness();
  const controller = new AbortController();
  controller.abort();
  await assertClosed(
    await fixture.handler(request(pageRequest(), controller.signal)),
  );
  assertOnlyCampaigns(fixture.transport, 0);
});

test("rate floor fails closed both before fetching and after either successful stop", async () => {
  const initial = harness();
  initial.transport.rate.remaining = 10;
  await assertClosed(await initial.handler(request()));
  assertOnlyCampaigns(initial.transport, 0);
  for (const remaining of [0, 10, 11]) {
    for (const hasMore of [false, true]) {
      const fixture = harness();
      fixture.transport.respond = () => {
        fixture.transport.rate = { limit: 1000, remaining, reset: 1800000000 };
        return providerResponse(campaignPage(1, undefined, hasMore));
      };
      const response = await fixture.handler(request());
      if (remaining <= 10) await assertClosed(response);
      else {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).page.hasMore, hasMore);
      }
      assertOnlyCampaigns(fixture.transport);
    }
  }
});

test("response-size failure returns no partial taxonomy or provider body", async () => {
  const fixture = harness();
  fixture.transport.respond = () => ({
    kind: "response",
    status: 200,
    bodyText: " ".repeat(5 * 1024 * 1024 + 1),
    retryAfterMs: null,
  });
  await assertClosed(await fixture.handler(request()));
  assertOnlyCampaigns(fixture.transport);
});

test("invalid server PageSize fails before transport creation rather than loosening the record bound", async () => {
  for (const size of ["0", "-1", "1.5", "bad", "100&PageSize=200"]) {
    const fixture = harness();
    fixture.integration.endpointConfiguration.campaigns =
      `/Mediapartners/{AccountSID}/Campaigns?PageSize=${size}`;
    const response = await fixture.handler(request());
    assert.equal(response.status, 422);
    assert.equal(
      (await response.json()).error.code,
      "invalid_integration_config",
    );
    assert.equal(fixture.activity.transports, 0);
    assertOnlyCampaigns(fixture.transport, 0);
  }
});

test("page_limit remains a failure for both existing modes", async () => {
  for (const audit of ["coupon_ads_coverage", "store_category_taxonomy"]) {
    const fixture = harness();
    fixture.integration.maxPages = 1;
    fixture.transport.respond = () =>
      providerResponse(campaignPage(1, undefined, true));
    await assertClosed(
      await fixture.handler(request({ integrationId: INTEGRATION_ID, audit })),
    );
    assertOnlyCampaigns(fixture.transport);
  }
});

test("full taxonomy still crawls every Campaign page and coupon coverage starts Ads only afterward", async () => {
  for (const audit of ["coupon_ads_coverage", "store_category_taxonomy"]) {
    const fixture = harness();
    fixture.transport.respond = (entry) => {
      const url = new URL(entry.url);
      if (url.pathname.endsWith("/Ads")) return providerResponse({ Ads: [] });
      const page = Number(url.searchParams.get("Page"));
      return providerResponse(campaignPage(page, undefined, page === 1));
    };
    const response = await fixture.handler(
      request({ integrationId: INTEGRATION_ID, audit }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["audit", "host"]);
    assert.equal(
      fixture.transport.requests.length,
      audit === "coupon_ads_coverage" ? 3 : 2,
    );
    assert.equal(
      new URL(fixture.transport.requests[0]!.url).pathname,
      CAMPAIGNS_PATH,
    );
    assert.equal(
      new URL(fixture.transport.requests[1]!.url).pathname,
      CAMPAIGNS_PATH,
    );
    assert.equal(
      new URL(fixture.transport.requests[1]!.url).searchParams.get("Page"),
      "2",
    );
    if (audit === "store_category_taxonomy") {
      assert.equal(body.audit.campaignsEvaluated, 2);
      assert.equal(body.audit.distinctLabels, 2);
      assert.equal(fixture.transport.rateResets, 0);
    } else {
      assert.equal(
        new URL(fixture.transport.requests[2]!.url).pathname,
        `/Mediapartners/${CREDENTIALS.accountSid}/Ads`,
      );
      assert.equal(body.audit.complete, true);
      assert.equal(fixture.transport.rateResets, 1);
    }
  }
});

test("paged taxonomy exposes only aggregates and the approved integration ID", async () => {
  const fixture = harness();
  fixture.transport.respond = () =>
    providerResponse(campaignPage(1, [{
      CampaignId: "campaign-sensitive",
      AdvertiserId: "advertiser-sensitive",
      CampaignName: "merchant-sensitive",
      StoreId: "store-sensitive",
      CategoryId: "category-sensitive",
      Categories: ["Health & Beauty"],
      raw: "raw-sensitive",
      providerUrl: "https://api.impact.com/private?token=secret-token",
      credentials: CREDENTIALS,
    }], true));
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json() as StoreCategoryTaxonomyPageHostResponseV2;
  assert.deepEqual(Object.keys(body).sort(), ["audit", "host", "page"]);
  assert.deepEqual(body.page, {
    requested: 1,
    recordsEvaluated: 1,
    hasMore: true,
  });
  assert.deepEqual(body.audit.labels, [{
    label: "Health & Beauty",
    key: "health & beauty",
    campaignCount: 1,
  }]);
  const serialized = JSON.stringify(body);
  for (
    const prohibited of [
      "CampaignId",
      "AdvertiserId",
      "StoreId",
      "CategoryId",
      "campaign-sensitive",
      "advertiser-sensitive",
      "merchant-sensitive",
      "store-sensitive",
      "category-sensitive",
      "raw-sensitive",
      "api.impact.com",
      "secret-cursor",
      "secret-token",
      "nextpageuri",
      "continuation",
      "providerUrl",
      CREDENTIALS.accountSid,
      CREDENTIALS.authToken,
      "ciphertext-sensitive",
      "verified-jwt",
    ]
  ) assert.equal(serialized.includes(prohibited), false, prohibited);
  assertOnlyCampaigns(fixture.transport);
});

test("paged mode succeeds with exactly the three read-only data capabilities and no RPC", async () => {
  const fixture = harness();
  assert.deepEqual(Object.keys(fixture.dataSource).sort(), [
    "hasAdminRole",
    "readCredentialCiphertext",
    "readIntegration",
  ]);
  assert.equal(Object.isFrozen(fixture.dataSource), true);
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
    `credential:${INTEGRATION_ID}`,
  ]);
  assertOnlyCampaigns(fixture.transport);
});

test("paged and full modes retain identical taxonomy normalization and invalid-campaign exclusion", async () => {
  const campaigns = [
    {
      CampaignId: "one",
      Categories: [" Health   & Beauty ", "health & beauty"],
      Category: "HEALTH & BEAUTY",
      Vertical: "Home/Garden",
    },
    { CampaignId: "two", Category: " Health & Beauty " },
    { CampaignId: "three", Category: "Ignored", Verticals: ["Valid", 42] },
    { CampaignId: "four" },
    {
      CampaignId: "five",
      Categories: null,
      Category: "",
      Vertical: "   ",
      Verticals: [],
    },
    { CampaignId: "six", Category: "Control\u0001" },
    { CampaignId: "seven", Category: "Zero\u200bWidth" },
    { CampaignId: "eight", Categories: Array(33).fill("Too many") },
    { CampaignId: "nine", Category: "x".repeat(161) },
    { CampaignId: "ten", Category: "!!!" },
  ];
  const summaries: StoreCategoryTaxonomyPageHostResponseV2["audit"][] = [];
  for (
    const body of [pageRequest(), {
      integrationId: INTEGRATION_ID,
      audit: "store_category_taxonomy",
    }]
  ) {
    const fixture = harness();
    fixture.transport.respond = () =>
      providerResponse(campaignPage(1, campaigns));
    const response = await fixture.handler(request(body));
    assert.equal(response.status, 200);
    const result = await response.json() as StoreCategoryTaxonomyHostResponseV2;
    summaries.push(result.audit);
    assertOnlyCampaigns(fixture.transport);
  }
  assert.deepEqual(summaries[0], summaries[1]);
  assert.deepEqual(summaries[0], {
    complete: true,
    campaignsEvaluated: 10,
    campaignsWithUsableTaxonomy: 2,
    campaignsWithoutTaxonomy: 2,
    invalidTaxonomyCampaigns: 6,
    distinctLabels: 2,
    labels: [
      { label: "HEALTH & BEAUTY", key: "health & beauty", campaignCount: 2 },
      { label: "Home/Garden", key: "home/garden", campaignCount: 1 },
    ],
    labelsTruncated: false,
    fieldCoverage: {
      Categories: { present: 2, validString: 0, validArray: 1, malformed: 1 },
      Category: { present: 7, validString: 3, validArray: 0, malformed: 4 },
      Vertical: { present: 2, validString: 2, validArray: 0, malformed: 0 },
      Verticals: { present: 2, validString: 0, validArray: 1, malformed: 1 },
    },
  });
});

test("each page keeps the existing deterministic 100-label cap", async () => {
  const fixture = harness();
  fixture.integration.pageSize = 101;
  fixture.transport.respond = () =>
    providerResponse(
      campaignPage(
        1,
        Array.from({ length: 101 }, (_, index) => ({
          CampaignId: `private-${index}`,
          Category: `Label ${String(index).padStart(3, "0")}`,
        })),
        true,
      ),
    );
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json() as StoreCategoryTaxonomyPageHostResponseV2;
  assert.deepEqual(body.page, {
    requested: 1,
    recordsEvaluated: 101,
    hasMore: true,
  });
  assert.equal(body.audit.campaignsEvaluated, 101);
  assert.equal(body.audit.distinctLabels, 101);
  assert.equal(body.audit.labels.length, 100);
  assert.equal(body.audit.labelsTruncated, true);
  assert.equal(body.audit.labels[0]!.label, "Label 000");
  assert.equal(body.audit.labels[99]!.label, "Label 099");
  assertOnlyCampaigns(fixture.transport);
});
