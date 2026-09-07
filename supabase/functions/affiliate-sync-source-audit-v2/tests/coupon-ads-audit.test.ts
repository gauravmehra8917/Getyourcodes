import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactContinuationPolicy,
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../../_shared/affiliate-sync-v2/index.ts";
import { ImpactAuditTransportHost } from "../ImpactAuditTransportHost.ts";
import {
  buildCampaignAdvertiserIndexV2,
  COUPON_ADS_MAX_PAGES,
  COUPON_ADS_MAX_PHYSICAL_REQUESTS,
  COUPON_ADS_RATE_REMAINING_FLOOR,
  ImpactCouponAdsAuditClient,
} from "../ImpactCouponAdsAuditClient.ts";
import type {
  CampaignAdvertiserIndexV2,
  ImpactAuditTransportV2,
  ImpactRateSnapshotV2,
} from "../types.ts";

const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const ORIGIN = "https://api.impact.com";
const INITIAL =
  `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Type=COUPON&Page=1&PageSize=100`;
const POLICY: ImpactContinuationPolicy = {
  approvedBaseUrl: ORIGIN,
  allowedOrigins: [ORIGIN],
  accountSidPathSegments: [ACCOUNT_SID],
};

type ExecuteFixture = (
  request: ImpactTransportRequest,
  physicalRequest: number,
  transport: FakeAuditTransport,
) => ImpactTransportResult | Promise<ImpactTransportResult>;

class FakeAuditTransport implements ImpactAuditTransportV2 {
  readonly requests: ImpactTransportRequest[] = [];
  readonly waits: number[] = [];
  rate: ImpactRateSnapshotV2 = { limit: null, remaining: null, reset: null };
  responseSizeExceeded = false;
  private readonly fixture: ExecuteFixture;

  constructor(fixture: ExecuteFixture) {
    this.fixture = fixture;
  }

  async execute(
    request: ImpactTransportRequest,
  ): Promise<ImpactTransportResult> {
    this.requests.push(request);
    return await this.fixture(request, this.requests.length, this);
  }

  async wait(delayMs: number): Promise<void> {
    this.waits.push(delayMs);
  }

  readRateSnapshot(): ImpactRateSnapshotV2 {
    return { ...this.rate };
  }

  resetRateSnapshot(): void {
    this.rate = { limit: null, remaining: null, reset: null };
  }

  consumeResponseSizeLimitExceeded(): boolean {
    const exceeded = this.responseSizeExceeded;
    this.responseSizeExceeded = false;
    return exceeded;
  }
}

function response(value: unknown, status = 200): ImpactTransportResult {
  return {
    kind: "response",
    status,
    bodyText: JSON.stringify(value),
    retryAfterMs: null,
  };
}

function page(
  pageNumber: number,
  ads: unknown[] = [],
  next?: string | null,
): Record<string, unknown> {
  return {
    "@page": String(pageNumber),
    "@numpages": next === undefined || next === null
      ? String(pageNumber)
      : String(Math.max(pageNumber + 1, COUPON_ADS_MAX_PAGES + 1)),
    ...(next === undefined ? {} : { "@nextpageuri": next }),
    Ads: ads,
  };
}

function client(
  transport: ImpactAuditTransportV2,
  maxAttemptsPerPage = 1,
): ImpactCouponAdsAuditClient {
  return new ImpactCouponAdsAuditClient({
    transport,
    continuationPolicy: POLICY,
    requestTimeoutMs: 5_000,
    maxAttemptsPerPage,
  });
}

const NO_CAMPAIGNS: CampaignAdvertiserIndexV2 = new Map();

test("trusted initial Ads URL and exact provider continuation are used", async () => {
  const exact =
    `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Cursor=opaque%2Fvalue&Page=2`;
  const transport = new FakeAuditTransport((_request, sequence) =>
    sequence === 1
      ? response(page(1, [{ Id: "ad-1" }], exact))
      : response(page(2, [{ Id: "ad-2" }]))
  );
  const result = await client(transport).audit(INITIAL, NO_CAMPAIGNS);
  assert.equal(result.complete, true);
  assert.equal(result.stopReason, "completed");
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.physicalRequests, 2);
  assert.equal(transport.requests[0]?.url, INITIAL);
  assert.equal(transport.requests[1]?.url, exact);
  assert.deepEqual(
    transport.requests.map((request) => request.credentialDisposition),
    ["attach_if_same_origin", "attach_if_same_origin"],
  );
  const initial = new URL(transport.requests[0]!.url);
  assert.equal(initial.pathname, `/Mediapartners/${ACCOUNT_SID}/Ads`);
  assert.deepEqual([...initial.searchParams.entries()], [
    ["Type", "COUPON"],
    ["Page", "1"],
    ["PageSize", "100"],
  ]);
});

test("an initial resource other than the exact trusted coupon Ads request is rejected", async () => {
  const transport = new FakeAuditTransport(() => response(page(1)));
  for (
    const invalid of [
      `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Type=BANNER&Page=1&PageSize=100`,
      `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Type=COUPON&Page=2&PageSize=100`,
      `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Type=COUPON&Page=1&PageSize=50`,
      `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Promotions?Type=COUPON&Page=1&PageSize=100`,
      `${INITIAL}&Url=https://browser-controlled.invalid`,
    ]
  ) {
    const result = await client(transport).audit(invalid, NO_CAMPAIGNS);
    assert.equal(result.stopReason, "invalid_continuation");
    assert.equal(result.physicalRequests, 0);
  }
  assert.equal(transport.requests.length, 0);
});

test("unapproved and repeated continuations fail closed without another request", async () => {
  for (
    const [next, reason] of [
      ["https://evil.example/Ads?Page=2", "invalid_continuation"],
      [INITIAL, "continuation_loop"],
    ] as const
  ) {
    const transport = new FakeAuditTransport(() => response(page(1, [], next)));
    const result = await client(transport).audit(INITIAL, NO_CAMPAIGNS);
    assert.equal(result.complete, false);
    assert.equal(result.stopReason, reason);
    assert.equal(transport.requests.length, 1);
  }
});

test("25 terminal pages complete but a 25th-page continuation reports page_limit", async () => {
  for (const terminalAtLimit of [true, false]) {
    const transport = new FakeAuditTransport((_request, sequence) => {
      const next = sequence === COUPON_ADS_MAX_PAGES && terminalAtLimit
        ? undefined
        : `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Page=${
          sequence + 1
        }&PageSize=100&Type=COUPON`;
      return response(page(sequence, [{ Id: `ad-${sequence}` }], next));
    });
    const result = await client(transport).audit(INITIAL, NO_CAMPAIGNS);
    assert.equal(result.pagesFetched, COUPON_ADS_MAX_PAGES);
    assert.equal(result.physicalRequests, COUPON_ADS_MAX_PAGES);
    assert.equal(result.complete, terminalAtLimit);
    assert.equal(
      result.stopReason,
      terminalAtLimit ? "completed" : "page_limit",
    );
  }
});

test("every retry counts and the absolute 35-request budget prevents request 36", async () => {
  let successfulPages = 0;
  const transport = new FakeAuditTransport((_request, physicalRequest) => {
    if (physicalRequest % 2 === 1) return response({}, 503);
    successfulPages += 1;
    const next = `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Type=COUPON&Page=${
      successfulPages + 1
    }&PageSize=100`;
    return response(
      page(successfulPages, [{ Id: `ad-${successfulPages}` }], next),
    );
  });
  const result = await client(transport, 2).audit(INITIAL, NO_CAMPAIGNS);
  assert.equal(result.stopReason, "physical_request_limit");
  assert.equal(result.complete, false);
  assert.equal(result.physicalRequests, COUPON_ADS_MAX_PHYSICAL_REQUESTS);
  assert.equal(transport.requests.length, COUPON_ADS_MAX_PHYSICAL_REQUESTS);
  assert.equal(successfulPages, 17);
  assert.equal(transport.waits.length, 17);
});

test("HTTP 429 is never retried", async () => {
  const transport = new FakeAuditTransport(() => response({}, 429));
  const result = await client(transport, 10).audit(INITIAL, NO_CAMPAIGNS);
  assert.equal(result.stopReason, "rate_limited");
  assert.equal(result.physicalRequests, 1);
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.waits.length, 0);
});

test("a safe numeric remaining-rate floor stops before another page", async () => {
  const next = `${ORIGIN}/Mediapartners/${ACCOUNT_SID}/Ads?Page=2`;
  const transport = new FakeAuditTransport((_request, _sequence, current) => {
    current.rate = {
      limit: 1_000,
      remaining: COUPON_ADS_RATE_REMAINING_FLOOR,
      reset: 1_800_000_000,
    };
    return response(page(1, [{ Id: "ad-1" }], next));
  });
  const result = await client(transport).audit(INITIAL, NO_CAMPAIGNS);
  assert.equal(result.stopReason, "rate_limit_threshold");
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.physicalRequests, 1);
  assert.deepEqual(result.rate, transport.rate);
});

test("malformed, oversized, timeout, abort and transport failures remain closed literals", async () => {
  const cases: Array<readonly [ImpactTransportResult, string, boolean]> = [
    [response({ Unexpected: [] }), "malformed_page", false],
    [{ kind: "timeout", errorCode: "private-timeout" }, "timeout", false],
    [{ kind: "aborted", errorCode: "private-abort" }, "cancelled", false],
    [
      { kind: "transport_error", errorCode: "private-network" },
      "transport_error",
      false,
    ],
    [
      { kind: "transport_error", errorCode: "private-size" },
      "response_size_limit",
      true,
    ],
  ];
  for (const [fixture, expected, sizeExceeded] of cases) {
    const transport = new FakeAuditTransport((_request, _sequence, current) => {
      current.responseSizeExceeded = sizeExceeded;
      return fixture;
    });
    const result = await client(transport).audit(INITIAL, NO_CAMPAIGNS);
    assert.equal(result.stopReason, expected);
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});

test("aggregate identity, campaign, deal and field-shape evidence is exact and leak-free", async () => {
  const sentinels = [
    "ad-secret-1",
    "ad-secret-2",
    "ad-secret-3",
    "ad-secret-4",
    "campaign-secret-known",
    "campaign-secret-unknown",
    "advertiser-secret-known",
    "advertiser-secret-conflict",
    "deal-secret-1",
    "deal-secret-2",
    "COUPON-SECRET",
    "DEFAULT-SECRET",
    "https://tracking.example/secret",
    "Merchant Secret Name",
  ];
  const ads = [
    {
      Id: sentinels[0],
      CampaignId: sentinels[4],
      AdvertiserId: sentinels[6],
      AdvertiserName: sentinels[12],
      DealId: sentinels[8],
      Code: sentinels[10],
      DealDefaultPromoCode: null,
      TrackingLink: sentinels[11],
      LandingPageUrl: "https://landing.example/secret",
      StartDate: "2026-01-01",
      EndDate: "2026-12-31",
    },
    {
      Id: sentinels[0],
      CampaignId: sentinels[4],
      AdvertiserId: sentinels[6],
      DealId: sentinels[8],
      Code: null,
      DealDefaultPromoCode: sentinels[10],
    },
    {
      Id: sentinels[1],
      CampaignId: sentinels[4],
      AdvertiserId: sentinels[7],
      DealId: sentinels[8],
      Code: "  ",
      DealDefaultPromoCode: { private: sentinels[10] },
    },
    {
      Id: sentinels[2],
      CampaignId: sentinels[5],
      AdvertiserId: "advertiser-secret-other",
      Code: { private: sentinels[10] },
      DealDefaultPromoCode: "",
    },
    { Id: sentinels[3], DealId: sentinels[9] },
    { CampaignId: sentinels[4], Code: sentinels[10] },
    null,
  ];
  const campaignIndex: CampaignAdvertiserIndexV2 = new Map([
    [sentinels[4], new Set([sentinels[6]])],
  ]);
  const transport = new FakeAuditTransport(() => response(page(1, ads)));
  const result = await client(transport).audit(INITIAL, campaignIndex);
  assert.equal(result.complete, true);
  assert.deepEqual(
    {
      pages: result.pagesFetched,
      physical: result.physicalRequests,
      raw: result.rawRecords,
      accepted: result.acceptedRecords,
      quarantined: result.quarantinedRecords,
    },
    { pages: 1, physical: 1, raw: 7, accepted: 5, quarantined: 2 },
  );
  assert.deepEqual(result.identity, {
    distinctAdIds: 4,
    missingAdId: 1,
    duplicateAdIdRecords: 1,
    distinctCampaignIds: 2,
    missingCampaignId: 1,
    campaignIdsFoundInCampaignIndex: 1,
    campaignIdsMissingFromCampaignIndex: 1,
    distinctAdvertiserIds: 3,
    missingAdvertiserId: 1,
    campaignAdvertiserCrossCheckAvailable: 3,
    campaignAdvertiserConflicts: 1,
  });
  assert.deepEqual(result.merchantCoverage, {
    distinctCampaignIds: 2,
    distinctAdvertiserIds: 3,
  });
  assert.deepEqual(result.offerShape, {
    withDealId: 4,
    distinctDealIds: 2,
    withoutDealId: 1,
    withTrackingLink: 1,
    withLandingPageUrl: 1,
    withStartDate: 1,
    withEndDate: 1,
    dealDefaultPromoCode: {
      missing: 1,
      null: 1,
      emptyOrWhitespaceString: 1,
      nonemptyString: 1,
      otherShape: 1,
    },
    code: {
      missing: 1,
      null: 1,
      emptyOrWhitespaceString: 1,
      nonemptyString: 1,
      otherShape: 1,
    },
  });
  assert.deepEqual(result.dealCardinality, {
    dealIdsWithOneAd: 1,
    dealIdsWithMultipleAds: 1,
    maxAdsPerDeal: 2,
  });
  assert.equal(
    result.rawRecords,
    result.acceptedRecords + result.quarantinedRecords,
  );
  const serialized = JSON.stringify(result);
  for (const sentinel of sentinels) {
    assert.equal(serialized.includes(sentinel), false);
  }
});

test("Campaign index retains exact advertiser evidence without name fallback", () => {
  const index = buildCampaignAdvertiserIndexV2([
    {
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      campaignName: "Same Name",
      destinationUrl: null,
      trackingUrl: null,
      raw: {},
      provenance: {
        stream: "campaigns",
        fetchSequence: 1,
        sanitizedRequestUrl: "https://api.impact.com/redacted",
        sanitizedSourceContinuationUrl: null,
        providerPage: "1",
        providerPageSize: "100",
        recordIndex: 0,
      },
    },
    {
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-B",
      campaignName: "Same Name",
      destinationUrl: null,
      trackingUrl: null,
      raw: {},
      provenance: {
        stream: "campaigns",
        fetchSequence: 2,
        sanitizedRequestUrl: "https://api.impact.com/redacted",
        sanitizedSourceContinuationUrl: null,
        providerPage: "2",
        providerPageSize: "100",
        recordIndex: 0,
      },
    },
  ]);
  assert.deepEqual([...index.keys()], ["Campaign-A"]);
  assert.deepEqual([...index.get("Campaign-A")!], [
    "Advertiser-A",
    "Advertiser-B",
  ]);
  assert.equal(index.has("Same Name"), false);
});

test("a duplicate Campaign advertiser identity is explicitly conflicting", async () => {
  const campaignIndex: CampaignAdvertiserIndexV2 = new Map([
    ["Campaign-A", new Set(["Advertiser-A", "Advertiser-B"])],
  ]);
  const transport = new FakeAuditTransport(() =>
    response(page(1, [
      { Id: "Ad-1", CampaignId: "Campaign-A", AdvertiserId: "Advertiser-A" },
      { Id: "Ad-2", CampaignId: "Campaign-A", AdvertiserId: "Advertiser-C" },
    ]))
  );
  const result = await client(transport).audit(INITIAL, campaignIndex);
  assert.equal(result.identity.campaignAdvertiserCrossCheckAvailable, 2);
  assert.equal(result.identity.campaignAdvertiserConflicts, 2);
});

test("audit transport preserves credential security and exposes only fixed numeric rate headers", async () => {
  const observed: Array<
    { url: string; headers: Headers; redirect: RequestRedirect }
  > = [];
  const transport = new ImpactAuditTransportHost({
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    approvedCredentialOrigin: ORIGIN,
    fetchImplementation: async (input, init) => {
      observed.push({
        url: String(input),
        headers: new Headers(init?.headers),
        redirect: init?.redirect ?? "follow",
      });
      return new Response(JSON.stringify(page(1)), {
        status: 200,
        headers: {
          "X-RateLimit-Limit": "1000",
          "X-RateLimit-Remaining": "999",
          "X-RateLimit-Reset": "1800000000",
          "X-Provider-Secret": "must-never-surface",
        },
      });
    },
  });
  const result = await transport.execute({
    method: "GET",
    url: INITIAL,
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.equal(result.kind, "response");
  assert.equal(observed[0]?.url, INITIAL);
  assert.equal(observed[0]?.headers.get("Accept"), "application/json");
  assert.equal(observed[0]?.headers.get("IR-Version"), "15");
  assert.equal(observed[0]?.headers.has("Authorization"), true);
  assert.equal(observed[0]?.redirect, "error");
  assert.deepEqual(transport.readRateSnapshot(), {
    limit: 1000,
    remaining: 999,
    reset: 1800000000,
  });
  assert.equal(
    JSON.stringify(transport.readRateSnapshot()).includes("must-never"),
    false,
  );
});

test("a malformed preferred rate header cannot hide a valid fixed numeric alias", async () => {
  const transport = new ImpactAuditTransportHost({
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    approvedCredentialOrigin: ORIGIN,
    fetchImplementation: async () =>
      new Response(JSON.stringify(page(1)), {
        status: 200,
        headers: {
          "X-RateLimit-Limit": "private-invalid-value",
          "X-RateLimit-Remaining": "not-a-number",
          "X-RateLimit-Remaining-Hour": "0",
          "X-RateLimit-Reset": "arbitrary-provider-text",
        },
      }),
  });
  await transport.execute({
    method: "GET",
    url: INITIAL,
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.deepEqual(transport.readRateSnapshot(), {
    limit: null,
    remaining: 0,
    reset: null,
  });
  const serialized = JSON.stringify(transport.readRateSnapshot());
  assert.equal(serialized.includes("private-invalid-value"), false);
  assert.equal(serialized.includes("arbitrary-provider-text"), false);
});

test("audit transport rejects credential-origin mismatch and redirected responses", async () => {
  let fetches = 0;
  const mismatch = new ImpactAuditTransportHost({
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    approvedCredentialOrigin: ORIGIN,
    fetchImplementation: async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const mismatchResult = await mismatch.execute({
    method: "GET",
    url: "https://other.impact.example/private",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.deepEqual(mismatchResult, {
    kind: "transport_error",
    errorCode: "credential_origin_mismatch",
  });
  assert.equal(fetches, 0);

  const redirected = new ImpactAuditTransportHost({
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    approvedCredentialOrigin: ORIGIN,
    fetchImplementation: async () => {
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  });
  const redirectResult = await redirected.execute({
    method: "GET",
    url: INITIAL,
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.deepEqual(redirectResult, {
    kind: "transport_error",
    errorCode: "redirect_rejected",
  });
});

test("client timeout and caller cancellation propagate through real request signals", async () => {
  const waitingTransport = (onExecute?: (signal: AbortSignal) => void) =>
    new FakeAuditTransport((request) =>
      new Promise<ImpactTransportResult>((resolve) => {
        const signal = request.signal!;
        onExecute?.(signal);
        if (signal.aborted) {
          resolve({ kind: "aborted", errorCode: "closed" });
          return;
        }
        signal.addEventListener(
          "abort",
          () => resolve({ kind: "aborted", errorCode: "closed" }),
          { once: true },
        );
      })
    );

  const timeoutTransport = waitingTransport();
  const timeoutResult = await new ImpactCouponAdsAuditClient({
    transport: timeoutTransport,
    continuationPolicy: POLICY,
    requestTimeoutMs: 1,
    maxAttemptsPerPage: 1,
  }).audit(INITIAL, NO_CAMPAIGNS);
  assert.equal(timeoutResult.stopReason, "timeout");
  assert.equal(timeoutResult.physicalRequests, 1);

  const controller = new AbortController();
  const cancelledTransport = waitingTransport(() => controller.abort());
  const cancelledResult = await client(cancelledTransport).audit(
    INITIAL,
    NO_CAMPAIGNS,
    controller.signal,
  );
  assert.equal(cancelledResult.stopReason, "cancelled");
  assert.equal(cancelledResult.physicalRequests, 1);
});

test("audit transport hard-caps the response stream before text allocation", async () => {
  const transport = new ImpactAuditTransportHost({
    credentials: { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    approvedCredentialOrigin: ORIGIN,
    maxResponseBytes: 4,
    fetchImplementation: async () => new Response("12345", { status: 200 }),
  });
  const result = await transport.execute({
    method: "GET",
    url: INITIAL,
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.equal(result.kind, "transport_error");
  assert.equal(transport.consumeResponseSizeLimitExceeded(), true);
  assert.equal(transport.consumeResponseSizeLimitExceeded(), false);
});
