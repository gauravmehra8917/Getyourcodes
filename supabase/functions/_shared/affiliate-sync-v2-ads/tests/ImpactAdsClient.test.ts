import assert from "node:assert/strict";
import test from "node:test";
import type { ImpactContinuationPolicy } from "../../affiliate-sync-v2/impact-url-safety.ts";
import {
  DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
  ImpactAdsCampaignClient,
  ImpactAdsClient,
  type ImpactAdsFetchLimitsV2,
  type ImpactAdsRateSnapshotV2,
  type ImpactAdsTransportRequestV2,
  type ImpactAdsTransportResultV2,
  type ImpactAdsTransportV2,
  RawAdDeduplicator,
} from "../index.ts";

const ORIGIN = "https://api.impact.com";
const CROSS_ORIGIN = "https://continuation.impact.com";
const SID = "account-sensitive";
const ADS =
  `${ORIGIN}/Mediapartners/${SID}/Ads?Type=COUPON&Page=1&PageSize=100`;
const CAMPAIGNS =
  `${ORIGIN}/Mediapartners/${SID}/Campaigns?Page=1&PageSize=100`;
const POLICY: ImpactContinuationPolicy = {
  approvedBaseUrl: ORIGIN,
  allowedOrigins: [ORIGIN],
  accountSidPathSegments: [SID],
};

class FakeTransport implements ImpactAdsTransportV2 {
  requests: ImpactAdsTransportRequestV2[] = [];
  waits: number[] = [];
  rate: ImpactAdsRateSnapshotV2 = { limit: null, remaining: null, reset: null };
  sizeExceeded = false;
  readonly fixture: (
    request: ImpactAdsTransportRequestV2,
    sequence: number,
    transport: FakeTransport,
  ) => ImpactAdsTransportResultV2 | Promise<ImpactAdsTransportResultV2>;

  constructor(
    fixture: (
      request: ImpactAdsTransportRequestV2,
      sequence: number,
      transport: FakeTransport,
    ) => ImpactAdsTransportResultV2 | Promise<ImpactAdsTransportResultV2>,
  ) {
    this.fixture = fixture;
  }
  async execute(request: ImpactAdsTransportRequestV2) {
    this.requests.push(request);
    return await this.fixture(request, this.requests.length, this);
  }
  async wait(delayMs: number) {
    this.waits.push(delayMs);
  }
  readRateSnapshot() {
    return { ...this.rate };
  }
  consumeResponseSizeLimitExceeded() {
    const value = this.sizeExceeded;
    this.sizeExceeded = false;
    return value;
  }
}

function response(body: unknown, status = 200): ImpactAdsTransportResultV2 {
  return {
    kind: "response",
    status,
    bodyText: JSON.stringify(body),
    retryAfterMs: null,
  };
}

function limits(
  input: Partial<ImpactAdsFetchLimitsV2> = {},
): ImpactAdsFetchLimitsV2 {
  return { ...DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2, ...input };
}

function adsClient(transport: ImpactAdsTransportV2, override = {}) {
  return new ImpactAdsClient({
    transport,
    continuationPolicy: POLICY,
    requestTimeoutMs: 5_000,
    limits: limits(override),
  });
}

test("Ads fetch follows the exact continuation and preserves request credentials policy", async () => {
  const next =
    `${ORIGIN}/Mediapartners/${SID}/Ads?Cursor=opaque%2Fvalue&Page=2`;
  const transport = new FakeTransport((_request, sequence) =>
    response(
      sequence === 1
        ? { Ads: [{ Id: "Ad-1" }], "@nextpageuri": next }
        : { Ads: [{ Id: "Ad-2" }] },
    )
  );
  const result = await adsClient(transport).fetch(ADS);
  assert.equal(result.diagnostics.complete, true);
  assert.equal(result.diagnostics.pagesFetched, 2);
  assert.equal(result.diagnostics.physicalRequests, 2);
  assert.deepEqual(transport.requests.map((request) => request.url), [
    ADS,
    next,
  ]);
  assert.deepEqual(
    transport.requests.map((request) => request.credentialDisposition),
    ["attach_if_same_origin", "attach_if_same_origin"],
  );
});

test("an explicitly allowed cross-origin continuation is exact and credential-free", async () => {
  const next = `${CROSS_ORIGIN}/opaque/path?Cursor=value%2F2`;
  const transport = new FakeTransport((_request, sequence) =>
    response(
      sequence === 1
        ? { Ads: [{ Id: "Ad-1" }], "@nextpageuri": next }
        : { Ads: [{ Id: "Ad-2" }] },
    )
  );
  const client = new ImpactAdsClient({
    transport,
    continuationPolicy: {
      ...POLICY,
      allowedOrigins: [ORIGIN, CROSS_ORIGIN],
    },
    requestTimeoutMs: 5_000,
    limits: limits(),
  });
  const result = await client.fetch(ADS);
  assert.equal(result.diagnostics.complete, true);
  assert.deepEqual(transport.requests.map((request) => request.url), [
    ADS,
    next,
  ]);
  assert.deepEqual(
    transport.requests.map((request) => request.credentialDisposition),
    ["attach_if_same_origin", "omit"],
  );
});

test("unapproved/repeated continuation and malformed page fail closed", async () => {
  for (
    const [next, expected] of [
      ["https://evil.example/next", "invalid_continuation"],
      [ADS, "continuation_loop"],
    ] as const
  ) {
    const transport = new FakeTransport(() =>
      response({ Ads: [], "@nextpageuri": next })
    );
    const result = await adsClient(transport).fetch(ADS);
    assert.equal(result.diagnostics.stopReason, expected);
    assert.equal(transport.requests.length, 1);
  }
  const malformed = new FakeTransport(() => response({ Wrong: [] }));
  const result = await adsClient(malformed).fetch(ADS);
  assert.equal(result.diagnostics.stopReason, "malformed_page");
  assert.equal(result.diagnostics.parseFailureReason, "missing_collection");
});

test("page, record and physical request limits have exact incomplete reasons", async () => {
  const pageTransport = new FakeTransport((_request, sequence) =>
    response({
      Ads: [{ Id: `Ad-${sequence}` }],
      "@nextpageuri": `${ORIGIN}/Mediapartners/${SID}/Ads?Page=${sequence + 1}`,
    })
  );
  const pageResult = await adsClient(pageTransport, { maxPages: 2 }).fetch(ADS);
  assert.equal(pageResult.diagnostics.stopReason, "page_limit");
  assert.equal(pageResult.diagnostics.pagesFetched, 2);

  const recordTransport = new FakeTransport(() =>
    response({
      Ads: [{ Id: "Ad-1" }, { Id: "Ad-2" }],
    })
  );
  const recordResult = await adsClient(recordTransport, { maxRecords: 1 })
    .fetch(ADS);
  assert.equal(recordResult.diagnostics.stopReason, "record_limit");
  assert.equal(recordResult.diagnostics.recordsDiscardedByLimit, 2);

  const requestTransport = new FakeTransport(() => response({}, 503));
  const requestResult = await adsClient(requestTransport, {
    maxPhysicalRequests: 2,
    maxAttemptsPerPage: 5,
  }).fetch(ADS);
  assert.equal(requestResult.diagnostics.stopReason, "physical_request_limit");
  assert.equal(requestResult.diagnostics.physicalRequests, 2);
});

test("an exact full record budget stops before an unnecessary continuation request", async () => {
  const next = `${ORIGIN}/Mediapartners/${SID}/Ads?Page=2`;
  const transport = new FakeTransport(() =>
    response({
      Ads: [{ Id: "Ad-1" }],
      "@nextpageuri": next,
    })
  );
  const result = await adsClient(transport, {
    maxPages: 3,
    maxRecords: 1,
  }).fetch(ADS);
  assert.equal(result.diagnostics.complete, false);
  assert.equal(result.diagnostics.stopReason, "record_limit");
  assert.equal(result.diagnostics.acceptedRecords, 1);
  assert.equal(transport.requests.length, 1);

  const pagePrecedence = await adsClient(
    new FakeTransport(() =>
      response({
        Ads: [{ Id: "Ad-1" }],
        "@nextpageuri": next,
      })
    ),
    { maxPages: 1, maxRecords: 1 },
  ).fetch(ADS);
  assert.equal(pagePrecedence.diagnostics.stopReason, "page_limit");
});

test("429 is never retried and numeric rate floor blocks the next physical request", async () => {
  const limited = new FakeTransport(() => response({}, 429));
  const limitedResult = await adsClient(limited, { maxAttemptsPerPage: 5 })
    .fetch(ADS);
  assert.equal(limitedResult.diagnostics.stopReason, "rate_limited");
  assert.equal(limited.requests.length, 1);
  assert.equal(limited.waits.length, 0);

  const next = `${ORIGIN}/Mediapartners/${SID}/Ads?Page=2`;
  const floor = new FakeTransport((_request, _sequence, transport) => {
    transport.rate.remaining = 10;
    return response({ Ads: [{ Id: "Ad-1" }], "@nextpageuri": next });
  });
  const floorResult = await adsClient(floor).fetch(ADS);
  assert.equal(floorResult.diagnostics.stopReason, "rate_limit_threshold");
  assert.equal(floor.requests.length, 1);
});

test("response byte cap and host stream-cap signal are distinct safe failures", async () => {
  const bodyCap = new FakeTransport(() => ({
    kind: "response",
    status: 200,
    bodyText: JSON.stringify({ Ads: [{ Id: "Ad-1" }] }),
    retryAfterMs: null,
  }));
  const bodyResult = await adsClient(bodyCap, { maxResponseBytes: 4 }).fetch(
    ADS,
  );
  assert.equal(bodyResult.diagnostics.stopReason, "response_size_limit");

  const streamCap = new FakeTransport((_request, _sequence, transport) => {
    transport.sizeExceeded = true;
    return { kind: "transport_error", errorCode: "private" };
  });
  const streamResult = await adsClient(streamCap).fetch(ADS);
  assert.equal(streamResult.diagnostics.stopReason, "response_size_limit");
  assert.equal(JSON.stringify(streamResult).includes("private"), false);
});

test("retry, timeout and caller cancellation remain bounded closed outcomes", async () => {
  const retry = new FakeTransport((_request, sequence) =>
    sequence === 1 ? response({}, 503) : response({ Ads: [{ Id: "Ad-1" }] })
  );
  const retryResult = await adsClient(retry, {
    maxAttemptsPerPage: 2,
  }).fetch(ADS);
  assert.equal(retryResult.diagnostics.complete, true);
  assert.equal(retryResult.diagnostics.retryCount, 1);
  assert.equal(retryResult.diagnostics.physicalRequests, 2);
  assert.deepEqual(retry.waits, [500]);

  const waiting = new FakeTransport((request) =>
    new Promise<ImpactAdsTransportResultV2>((resolve) => {
      const signal = request.signal!;
      if (signal.aborted) {
        resolve({ kind: "aborted", errorCode: "private" });
        return;
      }
      signal.addEventListener(
        "abort",
        () => resolve({ kind: "aborted", errorCode: "private" }),
        { once: true },
      );
    })
  );
  const timeoutResult = await new ImpactAdsClient({
    transport: waiting,
    continuationPolicy: POLICY,
    requestTimeoutMs: 1,
    limits: limits(),
  }).fetch(ADS);
  assert.equal(timeoutResult.diagnostics.stopReason, "timeout");
  assert.equal(timeoutResult.diagnostics.physicalRequests, 1);

  const controller = new AbortController();
  const cancelling = new FakeTransport(() => {
    controller.abort();
    return { kind: "aborted", errorCode: "private" };
  });
  const cancelledResult = await adsClient(cancelling).fetch(
    ADS,
    controller.signal,
  );
  assert.equal(cancelledResult.diagnostics.stopReason, "cancelled");
  assert.equal(cancelledResult.diagnostics.physicalRequests, 1);
  assert.equal(JSON.stringify(cancelledResult).includes("private"), false);
});

test("duplicate exact AdIds fetched on separate pages deduplicate once and retain conflicts", async () => {
  const next = `${ORIGIN}/Mediapartners/${SID}/Ads?Page=2`;
  const transport = new FakeTransport((_request, sequence) =>
    response(
      sequence === 1
        ? {
          Ads: [{ Id: "Ad-shared", CampaignId: "Campaign-first" }],
          "@nextpageuri": next,
        }
        : {
          Ads: [{ Id: "Ad-shared", CampaignId: "Campaign-second" }],
        },
    )
  );
  const fetched = await adsClient(transport).fetch(ADS);
  assert.equal(fetched.records.length, 2);
  const deduplicated = RawAdDeduplicator.deduplicate(fetched.records);
  assert.equal(deduplicated.uniqueAds.length, 1);
  assert.equal(deduplicated.uniqueAds[0]?.campaignId, "Campaign-first");
  assert.deepEqual(deduplicated.diagnostics, {
    acceptedInputRecords: 2,
    uniqueAds: 1,
    duplicateRecordsRemoved: 1,
    duplicatedAdIdentities: 1,
    identitiesWithConflictingProviderFields: 1,
  });
});

test("Campaign client is isolated, bounded, and carries rate state into later Ads", async () => {
  const transport = new FakeTransport((_request, _sequence, current) => {
    current.rate = { limit: 1000, remaining: 9, reset: 1800000000 };
    return response({ Campaigns: [{ CampaignId: "Campaign-A" }] });
  });
  const campaignResult = await new ImpactAdsCampaignClient({
    transport,
    continuationPolicy: POLICY,
    requestTimeoutMs: 5_000,
    limits: limits({
      maxPages: 50,
      maxRecords: 5_000,
      maxPhysicalRequests: 50,
    }),
  }).fetch(CAMPAIGNS);
  assert.equal(campaignResult.diagnostics.complete, true);
  assert.equal(campaignResult.records.length, 1);
  const adsResult = await adsClient(transport).fetch(ADS);
  assert.equal(adsResult.diagnostics.stopReason, "rate_limit_threshold");
  assert.equal(transport.requests.length, 1);
});

test("Campaign client forwards a pre-cancelled caller signal without provider contact", async () => {
  const transport = new FakeTransport(() => response({ Campaigns: [] }));
  const controller = new AbortController();
  controller.abort();
  const result = await new ImpactAdsCampaignClient({
    transport,
    continuationPolicy: POLICY,
    requestTimeoutMs: 5_000,
    limits: limits({
      maxPages: 50,
      maxRecords: 5_000,
      maxPhysicalRequests: 50,
    }),
  }).fetch(CAMPAIGNS, controller.signal);
  assert.equal(result.diagnostics.stopReason, "cancelled");
  assert.equal(result.diagnostics.physicalRequests, 0);
  assert.equal(transport.requests.length, 0);
});
