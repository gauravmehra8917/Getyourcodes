import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../../_shared/affiliate-sync-v2/contracts.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { createAffiliateSyncSourceAuditV2Handler } from "../handler.ts";
import type {
  ImpactAuditTransportV2,
  SourceAuditV2HostDependencies,
  StoreCategoryTaxonomyHostResponseV2,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MODE = "store_category_taxonomy";
const ORIGIN = "https://admin.example";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";
const CAMPAIGN_PATH = `/Mediapartners/${ACCOUNT_SID}/Campaigns`;

const DEFAULT_CAMPAIGNS = [
  {
    CampaignId: "campaign-sensitive",
    AdvertiserId: "advertiser-sensitive",
    CampaignName: "Merchant Sensitive",
    Categories: ["fashion", "Home", "Fashion"],
    Category: "FASHION",
    Vertical: "Home",
    DestinationUrl: "https://destination.example/private",
    TrackingLink: "https://tracking.example/private",
    Credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    Secret: "secret-sensitive",
    Sql: "database-sensitive",
  },
  { CampaignId: "without-taxonomy", Details: { Categories: "Must not infer" } },
  {
    CampaignId: "invalid-taxonomy",
    Categories: ["Must discard", 42],
    Vertical: "Discard too",
  },
];

function page(body: unknown, status = 200): ImpactTransportResult {
  return {
    kind: "response",
    status,
    bodyText: JSON.stringify(body),
    retryAfterMs: null,
  };
}

function continued(next: string): ImpactTransportResult {
  return page({
    Campaigns: DEFAULT_CAMPAIGNS.slice(0, 1),
    "@page": "1",
    "@numpages": "2",
    "@nextpageuri": next,
  });
}

function harness(input: {
  results?: ImpactTransportResult[];
  integration?: Partial<StoredIntegrationV2>;
  authenticated?: boolean;
  admin?: boolean;
  rateRemaining?: number;
} = {}) {
  const requests: ImpactTransportRequest[] = [];
  const operations: string[] = [];
  const activity = {
    verified: 0,
    decryptions: 0,
    transports: 0,
    resets: 0,
    waits: 0,
  };
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
    ...input.integration,
  };
  const results = [
    ...(input.results ?? [page({ Campaigns: DEFAULT_CAMPAIGNS })]),
  ];
  const transport: ImpactAuditTransportV2 = {
    execute(request) {
      requests.push(request);
      if (new URL(request.url).pathname.endsWith("/Ads")) {
        return Promise.resolve(page({
          Ads: [{
            Id: "ad-sensitive",
            CampaignId: "campaign-sensitive",
            Code: "PRIVATE",
          }],
        }));
      }
      const result = results.shift();
      assert.ok(result, "unexpected additional Campaign request");
      return Promise.resolve(result);
    },
    wait() {
      activity.waits += 1;
      return Promise.resolve();
    },
    readRateSnapshot() {
      return {
        limit: null,
        remaining: requests.length ? input.rateRemaining ?? null : null,
        reset: null,
      };
    },
    resetRateSnapshot() {
      activity.resets += 1;
    },
    consumeResponseSizeLimitExceeded() {
      return false;
    },
  };
  const deps: SourceAuditV2HostDependencies = {
    verifyUser(authorization, jwt) {
      activity.verified += 1;
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      return Promise.resolve(
        input.authenticated === false ? null : { id: USER_ID },
      );
    },
    createDataSource() {
      return {
        hasAdminRole(id) {
          operations.push(`admin:${id}`);
          return Promise.resolve(input.admin ?? true);
        },
        readIntegration(id) {
          operations.push(`integration:${id}`);
          return Promise.resolve(integration);
        },
        readCredentialCiphertext(id) {
          operations.push(`credential:${id}`);
          return Promise.resolve(CIPHERTEXT);
        },
      };
    },
    decryptCredentialEnvelope(ciphertext) {
      activity.decryptions += 1;
      assert.equal(ciphertext, CIPHERTEXT);
      return Promise.resolve(
        JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN }),
      );
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
    siteUrl: ORIGIN,
  };
  return {
    handler: createAffiliateSyncSourceAuditV2Handler(deps),
    requests,
    operations,
    activity,
  };
}

function request(
  body: unknown = { integrationId: INTEGRATION_ID, audit: MODE },
  authorization: string | null = "Bearer verified-jwt",
): Request {
  const headers = new Headers({
    Origin: ORIGIN,
    "Content-Type": "application/json",
  });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("https://edge.example/affiliate-sync-source-audit-v2", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("taxonomy authenticates administrators, fetches Campaigns only and returns the exact aggregate shape", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual(fixture.operations, [
    `admin:${USER_ID}`,
    `integration:${INTEGRATION_ID}`,
    `credential:${INTEGRATION_ID}`,
  ]);
  assert.deepEqual(fixture.activity, {
    verified: 1,
    decryptions: 1,
    transports: 1,
    resets: 0,
    waits: 0,
  });
  assert.equal(fixture.requests.length, 1);
  const campaignRequest = new URL(fixture.requests[0]!.url);
  assert.equal(campaignRequest.origin, "https://api.impact.com");
  assert.equal(campaignRequest.pathname, CAMPAIGN_PATH);
  assert.deepEqual([...campaignRequest.searchParams.entries()], [
    ["Page", "1"],
    ["PageSize", "100"],
  ]);
  assert.equal(fixture.requests[0]!.method, "GET");
  assert.deepEqual(await response.json(), {
    host: {
      version: "v2-a11-s2a-1",
      readOnly: true,
      integrationId: INTEGRATION_ID,
      audit: MODE,
    },
    audit: {
      complete: true,
      campaignsEvaluated: 3,
      campaignsWithUsableTaxonomy: 1,
      campaignsWithoutTaxonomy: 1,
      invalidTaxonomyCampaigns: 1,
      distinctLabels: 2,
      labels: [
        { label: "FASHION", key: "fashion", campaignCount: 1 },
        { label: "Home", key: "home", campaignCount: 1 },
      ],
      labelsTruncated: false,
      fieldCoverage: {
        Categories: { present: 2, validString: 0, validArray: 1, malformed: 1 },
        Category: { present: 1, validString: 1, validArray: 0, malformed: 0 },
        Vertical: { present: 2, validString: 2, validArray: 0, malformed: 0 },
        Verticals: { present: 0, validString: 0, validArray: 0, malformed: 0 },
      },
    },
  });
});

test("taxonomy rejects missing or unverified authentication before privileged reads", async () => {
  for (
    const authorization of [
      null,
      "bearer verified-jwt",
      "Bearer verified-jwt extra",
    ]
  ) {
    const fixture = harness();
    assert.equal(
      (await fixture.handler(request(undefined, authorization))).status,
      401,
    );
    assert.equal(fixture.activity.verified, 0);
    assert.deepEqual(fixture.operations, []);
    assert.deepEqual(fixture.requests, []);
  }
  const fixture = harness({ authenticated: false });
  assert.equal((await fixture.handler(request())).status, 401);
  assert.deepEqual(fixture.operations, []);
  assert.equal(fixture.activity.decryptions, 0);
  assert.deepEqual(fixture.requests, []);
});

test("taxonomy rejects a verified non-admin before integration reads and provider work", async () => {
  const fixture = harness({ admin: false });
  const response = await fixture.handler(request());
  assert.equal(response.status, 403);
  assert.deepEqual(fixture.operations, [`admin:${USER_ID}`]);
  assert.equal(fixture.activity.decryptions, 0);
  assert.equal(fixture.activity.transports, 0);
  assert.deepEqual(fixture.requests, []);
});

test("both modes reject extra fields and unknown audit values with the existing error", async () => {
  for (const audit of [MODE, "coupon_ads_coverage"]) {
    for (
      const extra of [{ extra: true }, { url: "https://evil.example" }, {
        apply: true,
      }]
    ) {
      const fixture = harness();
      const response = await fixture.handler(
        request({ integrationId: INTEGRATION_ID, audit, ...extra }),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        host: { version: "v2-a11-s2a-1", readOnly: true },
        error: {
          code: "invalid_request",
          message: "The source-audit request is invalid.",
        },
      });
      assert.deepEqual(fixture.operations, [`admin:${USER_ID}`]);
      assert.deepEqual(fixture.requests, []);
    }
  }
  for (
    const audit of [
      "wrong",
      "STORE_CATEGORY_TAXONOMY",
      "store_category_taxonomy ",
      null,
      true,
      {},
    ]
  ) {
    const fixture = harness();
    assert.equal(
      (await fixture.handler(request({ integrationId: INTEGRATION_ID, audit })))
        .status,
      400,
    );
    assert.deepEqual(fixture.requests, []);
  }
});

test("taxonomy keeps the exact UUID and two-field request validation", async () => {
  for (
    const body of [
      null,
      [],
      {},
      { audit: MODE },
      { integrationId: INTEGRATION_ID },
      { integrationId: "not-a-uuid", audit: MODE },
    ]
  ) {
    const fixture = harness();
    assert.equal((await fixture.handler(request(body))).status, 400);
    assert.deepEqual(fixture.requests, []);
  }
});

test("coupon mode still fetches Ads and returns its existing response structure", async () => {
  const fixture = harness();
  const response = await fixture.handler(
    request({ integrationId: INTEGRATION_ID, audit: "coupon_ads_coverage" }),
  );
  assert.equal(response.status, 200);
  assert.equal(fixture.requests.length, 2);
  assert.equal(new URL(fixture.requests[0]!.url).pathname, CAMPAIGN_PATH);
  const ads = new URL(fixture.requests[1]!.url);
  assert.equal(ads.pathname, `/Mediapartners/${ACCOUNT_SID}/Ads`);
  assert.deepEqual([...ads.searchParams.entries()], [["Type", "COUPON"], [
    "Page",
    "1",
  ], ["PageSize", "100"]]);
  assert.equal(fixture.activity.resets, 1);
  const body = await response.json();
  assert.deepEqual(body.host, {
    version: "v2-a11-s2a-1",
    readOnly: true,
    integrationId: INTEGRATION_ID,
    audit: "coupon_ads_coverage",
  });
  assert.equal(body.audit.complete, true);
  assert.equal(body.audit.acceptedRecords, 1);
  assert.equal(Object.hasOwn(body.audit, "fieldCoverage"), false);
  assert.equal(Object.hasOwn(body.audit, "labels"), false);
});

test("taxonomy follows only approved Campaign continuations and aggregates every completed page", async () => {
  const next = `https://api.impact.com${CAMPAIGN_PATH}?Page=2&PageSize=100`;
  const fixture = harness({
    results: [
      continued(next),
      page({
        Campaigns: [{
          CampaignId: "page-two-sensitive",
          Categories: "Fashion",
        }],
        "@page": "2",
        "@numpages": "2",
      }),
    ],
  });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[1]!.url, next);
  assert.equal(
    fixture.requests.every((entry) =>
      new URL(entry.url).pathname === CAMPAIGN_PATH
    ),
    true,
  );
  assert.equal(fixture.activity.resets, 0);
  const body = await response.json() as StoreCategoryTaxonomyHostResponseV2;
  assert.equal(body.audit.campaignsEvaluated, 2);
  assert.deepEqual(body.audit.labels, [
    { label: "FASHION", key: "fashion", campaignCount: 2 },
    { label: "Home", key: "home", campaignCount: 1 },
  ]);
});

test("incomplete Campaign evidence fails closed without Ads or partial taxonomy", async () => {
  const next = `https://api.impact.com${CAMPAIGN_PATH}?Page=2&PageSize=100`;
  const cases: Array<{
    results: ImpactTransportResult[];
    integration?: Partial<StoredIntegrationV2>;
  }> = [
    { results: [page({ Wrong: [] })] },
    { results: [page({ Campaigns: "malformed" })] },
    {
      results: [
        continued("https://evil.example/private?token=secret-sensitive"),
      ],
    },
    { results: [continued(next)], integration: { maxPages: 1 } },
    { results: [continued(next), continued(next)] },
    {
      results: [page({ Campaigns: DEFAULT_CAMPAIGNS })],
      integration: { maxPages: 1, pageSize: 1 },
    },
    {
      results: [page({ secret: "secret-sensitive" }, 429)],
      integration: { retryAttempts: 20 },
    },
    { results: [page({ secret: "secret-sensitive" }, 500)] },
    { results: [{ kind: "timeout", errorCode: "secret-sensitive" }] },
    { results: [{ kind: "aborted", errorCode: "secret-sensitive" }] },
    { results: [{ kind: "transport_error", errorCode: "secret-sensitive" }] },
    { results: [continued(next), page({ Wrong: "secret-sensitive" })] },
  ];
  for (const input of cases) {
    const fixture = harness(input);
    const response = await fixture.handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      host: { version: "v2-a11-s2a-1", readOnly: true },
      error: {
        code: "campaign_fetch_failed",
        message: "Impact Campaign evidence could not be completed.",
      },
    });
    assert.equal(
      fixture.requests.every((entry) =>
        new URL(entry.url).pathname === CAMPAIGN_PATH
      ),
      true,
    );
    assert.equal(fixture.activity.resets, 0);
    assert.equal(fixture.activity.waits, 0);
  }
});

test("taxonomy retains the existing Campaign rate floor before completion or another page", async () => {
  for (
    const result of [
      page({ Campaigns: DEFAULT_CAMPAIGNS }),
      continued(`https://api.impact.com${CAMPAIGN_PATH}?Page=2`),
    ]
  ) {
    const fixture = harness({ results: [result], rateRemaining: 10 });
    const response = await fixture.handler(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "campaign_fetch_failed");
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.activity.resets, 0);
  }
});

test("taxonomy response never exposes raw Campaigns, IDs, URLs, credentials, secrets or database details", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const serialized = await response.text();
  for (
    const forbidden of [
      "CampaignId",
      "AdvertiserId",
      "campaign-sensitive",
      "advertiser-sensitive",
      "Merchant Sensitive",
      "raw",
      "http",
      "DestinationUrl",
      "TrackingLink",
      "Credentials",
      ACCOUNT_SID,
      AUTH_TOKEN,
      CIPHERTEXT,
      "secret-sensitive",
      "Sql",
      "database-sensitive",
      "Must discard",
      "Discard too",
      "Must not infer",
    ]
  ) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("taxonomy response is capped at 100 labels with a full pre-truncation count", async () => {
  const fixture = harness({
    results: [page({
      Campaigns: Array.from({ length: 101 }, (_, index) => ({
        CampaignId: `campaign-${index}`,
        Categories: `Label ${String(index).padStart(3, "0")}`,
      })),
    })],
  });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json() as StoreCategoryTaxonomyHostResponseV2;
  assert.equal(body.audit.campaignsEvaluated, 101);
  assert.equal(body.audit.distinctLabels, 101);
  assert.equal(body.audit.labels.length, 100);
  assert.equal(body.audit.labelsTruncated, true);
  assert.equal(body.audit.labels[0]!.key, "label 000");
  assert.equal(body.audit.labels[99]!.key, "label 099");
  assert.equal(fixture.requests.length, 1);
});

test("taxonomy uses the existing Campaign parser identity rule without AdvertiserId fallback", async () => {
  const fixture = harness({
    results: [page({
      Campaigns: [
        { AdvertiserId: "advertiser-sensitive", Categories: "Fashion" },
      ],
    })],
  });
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json() as StoreCategoryTaxonomyHostResponseV2;
  assert.equal(body.audit.campaignsEvaluated, 0);
  assert.deepEqual(body.audit.labels, []);
  assert.equal(fixture.requests.length, 1);
});
