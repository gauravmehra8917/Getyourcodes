import assert from "node:assert/strict";
import test from "node:test";
import { ImpactClientV2, type ImpactClientV2Options } from "../ImpactClientV2.ts";
import type { ImpactTransport } from "../contracts.ts";
import type { ImpactContinuationPolicy } from "../impact-url-safety.ts";
import { FixtureImpactTransport, type FixtureTransportStep } from "./fixture-transport.ts";

const policy: ImpactContinuationPolicy = {
  approvedBaseUrl: "https://api.impact.com",
  allowedOrigins: ["https://api.impact.com", "https://api-us.impact.com"],
  accountSidPathSegments: ["2303074"],
};
const initial = "/Mediapartners/2303074/Promotions?Page=1&PageSize=2";

function response(body: unknown, status = 200, retryAfterMs: number | null = null): FixtureTransportStep {
  return { result: { kind: "response", status, bodyText: JSON.stringify(body), retryAfterMs } };
}

function promotions(records: unknown[], next?: string): Record<string, unknown> {
  return { "@page": "1", "@pagesize": "2", Promotions: records, ...(next ? { "@nextpageuri": next } : {}) };
}

function campaigns(records: unknown[], next?: string): Record<string, unknown> {
  return { "@page": "1", "@pagesize": "2", Campaigns: records, ...(next ? { "@nextpageuri": next } : {}) };
}

function client(steps: FixtureTransportStep[], overrides: Partial<ImpactClientV2Options> = {}) {
  const transport = new FixtureImpactTransport(steps);
  const instance = new ImpactClientV2({
    transport,
    continuationPolicy: policy,
    limits: {
      maxPages: 10, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 3,
      baseBackoffMs: 100, maxBackoffMs: 1_000, maxRetryAfterMs: 2_000,
    },
    requestTimeoutMs: 1_000,
    ...overrides,
  });
  return { instance, transport };
}

test("follows exact Promotion continuations without reconstructing page parameters", async () => {
  const next = "/Mediapartners/2303074/Promotions?Page=2&PageSize=2&Sort=UpdatedDate&Opaque=retain-order";
  const expectedNext = `https://api.impact.com${next}`;
  const { instance, transport } = client([
    { ...response(promotions([{ PromotionIds: "one" }], next)), expectedCredentialDisposition: "attach_if_same_origin" },
    { ...response(promotions([{ PromotionIds: "two" }])), expectedUrl: expectedNext, expectedCredentialDisposition: "attach_if_same_origin" },
  ]);
  const result = await instance.fetchPromotions(initial);
  assert.deepEqual(result.records.map((record) => record.promotionId), ["one", "two"]);
  assert.equal(result.diagnostics.stopReason, "completed");
  assert.equal(transport.requests[1]?.url, expectedNext);
  assert.equal(transport.requests[1]?.url.includes("retain-order"), true);
  assert.equal(result.records[1]?.provenance.sanitizedSourceContinuationUrl?.includes("Opaque=retain-order"), true);
});

test("omits host credentials for allowed cross-origin continuations", async () => {
  const { instance, transport } = client([
    response(promotions([{ PromotionIds: "one" }], "https://api-us.impact.com/Promotions?Page=2")),
    { ...response(promotions([{ PromotionIds: "two" }])), expectedCredentialDisposition: "omit" },
  ]);
  const result = await instance.fetchPromotions(initial);
  assert.equal(result.diagnostics.stopReason, "completed");
  assert.equal(transport.requests[1]?.credentialDisposition, "omit");
});

test("applies the identical continuation controls to Campaigns", async () => {
  const { instance, transport } = client([
    response(campaigns([{ CampaignId: "campaign-one" }], "/Mediapartners/2303074/Campaigns?Page=2&Sort=Name")),
    { ...response(campaigns([{ CampaignId: "campaign-two", AdvertiserId: "advertiser-two" }])), expectedUrl: "https://api.impact.com/Mediapartners/2303074/Campaigns?Page=2&Sort=Name" },
  ]);
  const result = await instance.fetchCampaigns("/Mediapartners/2303074/Campaigns?Page=1");
  assert.deepEqual(result.records.map((record) => [record.campaignId, record.advertiserId]), [
    ["campaign-one", null], ["campaign-two", "advertiser-two"],
  ]);
  assert.equal(result.diagnostics.stopReason, "completed");
  assert.equal(transport.requests.length, 2);
  assert.equal("promotionIdShapeCounts" in result.diagnostics, false);
});

test("rejects unsafe continuations and detects a repeated continuation before refetching", async () => {
  const unsafe = client([response(promotions([{ PromotionIds: "one" }], "http://api.impact.com/Promotions?Page=2"))]);
  const unsafeResult = await unsafe.instance.fetchPromotions(initial);
  assert.equal(unsafeResult.diagnostics.stopReason, "invalid_continuation");
  assert.equal(unsafe.transport.requests.length, 1);

  const loopUrl = "/Mediapartners/2303074/Promotions?Page=2";
  const loop = client([
    response(promotions([{ PromotionIds: "one" }], loopUrl)),
    response(promotions([{ PromotionIds: "two" }], loopUrl)),
  ]);
  const loopResult = await loop.instance.fetchPromotions(initial);
  assert.equal(loopResult.diagnostics.stopReason, "continuation_loop");
  assert.equal(loop.transport.requests.length, 2);
});

test("honors Retry-After and retries retryable provider failures with deterministic backoff", async () => {
  const retryAfter = client([
    response({ error: "slow down" }, 429, 350),
    response(promotions([{ PromotionIds: "one" }])),
  ]);
  const retryAfterResult = await retryAfter.instance.fetchPromotions(initial);
  assert.equal(retryAfterResult.diagnostics.stopReason, "completed");
  assert.deepEqual(retryAfter.transport.waits, [350]);
  assert.deepEqual(retryAfterResult.diagnostics.retries[0], {
    stream: "promotions",
    fetchSequence: 1,
    sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=1&PageSize=2",
    attempts: 2,
    retryDelaysMs: [350],
    finalStatus: 200,
  });

  const backoff = client([
    response({ error: "retry" }, 503),
    response(promotions([{ PromotionIds: "one" }])),
  ], { jitter: (delay) => delay + 7 });
  const backoffResult = await backoff.instance.fetchPromotions(initial);
  assert.equal(backoffResult.diagnostics.stopReason, "completed");
  assert.deepEqual(backoff.transport.waits, [107]);

  const capped = client([
    response({ error: "retry" }, 503),
    response(promotions([{ PromotionIds: "one" }])),
  ], {
    jitter: (delay) => delay * 99,
    limits: { maxPages: 2, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 250, maxRetryAfterMs: 100 },
  });
  await capped.instance.fetchPromotions(initial);
  assert.deepEqual(capped.transport.waits, [250]);
});

test("stops provider failures without unbounded retries", async () => {
  const nonRetryable = client([response({ error: "denied" }, 401)]);
  const nonRetryableResult = await nonRetryable.instance.fetchPromotions(initial);
  assert.equal(nonRetryableResult.diagnostics.stopReason, "provider_error");
  assert.equal(nonRetryable.transport.requests.length, 1);

  const exhausted = client([
    response({ error: "retry" }, 503),
    response({ error: "retry" }, 503),
  ], { limits: { maxPages: 2, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 2, baseBackoffMs: 10, maxBackoffMs: 100, maxRetryAfterMs: 100 } });
  const exhaustedResult = await exhausted.instance.fetchPromotions(initial);
  assert.equal(exhaustedResult.diagnostics.stopReason, "provider_error");
  assert.equal(exhausted.transport.requests.length, 2);
  assert.deepEqual(exhausted.transport.waits, [10]);
  assert.equal(exhaustedResult.diagnostics.retries[0]?.attempts, 2);
});

test("preserves timeout, cancellation, and transport-error outcomes", async () => {
  const timeout = client([{ result: { kind: "timeout", errorCode: "deadline" } }]);
  assert.equal((await timeout.instance.fetchPromotions(initial)).diagnostics.stopReason, "timeout");

  const controller = new AbortController();
  controller.abort();
  const cancelled = client([response(promotions([{ PromotionIds: "not-requested" }]))]);
  const cancelledResult = await cancelled.instance.fetchPromotions(initial, controller.signal);
  assert.equal(cancelledResult.diagnostics.stopReason, "cancelled");
  assert.equal(cancelled.transport.requests.length, 0);

  const transportError = client([{ result: { kind: "transport_error", errorCode: "network" } }]);
  assert.equal((await transportError.instance.fetchPromotions(initial)).diagnostics.stopReason, "transport_error");

  const transportAborted = client([{ result: { kind: "aborted", errorCode: "host_abort" } }]);
  assert.equal((await transportAborted.instance.fetchPromotions(initial)).diagnostics.stopReason, "cancelled");
});

test("enforces client timeouts and propagates a caller abort to the transport signal", async () => {
  let timeoutSignal: AbortSignal | undefined;
  const timeoutTransport: ImpactTransport = {
    execute: ({ signal }) => new Promise((resolve) => {
      timeoutSignal = signal;
      signal?.addEventListener("abort", () => resolve({ kind: "timeout", errorCode: "deadline" }), { once: true });
    }),
    wait: async () => {},
  };
  const timeoutClient = new ImpactClientV2({
    transport: timeoutTransport,
    continuationPolicy: policy,
    limits: { maxPages: 2, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, maxRetryAfterMs: 1 },
    requestTimeoutMs: 1,
  });
  const timeoutResult = await timeoutClient.fetchPromotions(initial);
  assert.equal(timeoutResult.diagnostics.stopReason, "timeout");
  assert.equal(timeoutSignal?.aborted, true);

  let started: (() => void) | null = null;
  const callerTransport: ImpactTransport = {
    execute: ({ signal }) => new Promise((resolve) => {
      started?.();
      signal?.addEventListener("abort", () => resolve({ kind: "aborted", errorCode: "caller_abort" }), { once: true });
    }),
    wait: async () => {},
  };
  const callerClient = new ImpactClientV2({
    transport: callerTransport,
    continuationPolicy: policy,
    limits: { maxPages: 2, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, maxRetryAfterMs: 1 },
    requestTimeoutMs: 1_000,
  });
  const controller = new AbortController();
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const inFlight = callerClient.fetchPromotions(initial, controller.signal);
  await requestStarted;
  controller.abort();
  assert.equal((await inFlight).diagnostics.stopReason, "cancelled");
});

test("enforces page, record, and response-size limits without partial page acceptance", async () => {
  const pageLimited = client([
    response(promotions([{ PromotionIds: "one" }], "/Mediapartners/2303074/Promotions?Page=2")),
  ], { limits: { maxPages: 1, maxRecords: 20, maxResponseBytes: 10_000, maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 100, maxRetryAfterMs: 100 } });
  const pageLimitedResult = await pageLimited.instance.fetchPromotions(initial);
  assert.equal(pageLimitedResult.diagnostics.stopReason, "page_limit");
  assert.equal(pageLimited.transport.requests.length, 1);

  const recordLimited = client([
    response(promotions([{ PromotionIds: "one" }, { PromotionIds: "two" }])),
  ], { limits: { maxPages: 2, maxRecords: 1, maxResponseBytes: 10_000, maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 100, maxRetryAfterMs: 100 } });
  const recordLimitedResult = await recordLimited.instance.fetchPromotions(initial);
  assert.equal(recordLimitedResult.diagnostics.stopReason, "record_limit");
  assert.equal(recordLimitedResult.records.length, 0);
  assert.equal(recordLimitedResult.diagnostics.pages[0]?.accepted, false);

  const oversized = client([
    { result: { kind: "response", status: 200, bodyText: JSON.stringify(promotions([{ PromotionIds: "too-large" }])), retryAfterMs: null } },
  ], { limits: { maxPages: 2, maxRecords: 20, maxResponseBytes: 10, maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 100, maxRetryAfterMs: 100 } });
  const oversizedResult = await oversized.instance.fetchPromotions(initial);
  assert.equal(oversizedResult.diagnostics.stopReason, "provider_error");
  assert.deepEqual(oversizedResult.diagnostics.pageErrors.map((entry) => entry.code), ["response_size_limit_exceeded"]);
});

test("keeps sanitized page provenance for accepted and quarantined records", async () => {
  const { instance } = client([
    response(promotions([null, { PromotionIds: "one" }], "/Mediapartners/2303074/Promotions?Page=2&token=secret")),
    response(promotions([{ PromotionIds: "two" }])),
  ]);
  const result = await instance.fetchPromotions(initial);
  assert.deepEqual(result.records.map((record) => [record.promotionId, record.provenance.fetchSequence]), [["one", 1], ["two", 2]]);
  assert.deepEqual(result.quarantinedRecords.map((record) => [record.reason, record.provenance.fetchSequence, record.provenance.recordIndex]), [["malformed_record", 1, 0]]);
  assert.equal(result.records[1]?.provenance.sanitizedSourceContinuationUrl?.includes("secret"), false);
  assert.equal(result.records[1]?.provenance.sanitizedSourceContinuationUrl?.includes("%5BREDACTED%5D"), true);
});

test("aggregates closed quarantine reasons across Promotion pages without leaking record data", async () => {
  const next = "/Mediapartners/2303074/Promotions?Page=2&cursor=quarantine-cursor-secret";
  const { instance } = client([
    response(promotions([
      null,
      {
        PromotionIds: "",
        PromotionTitle: "quarantined-title-secret",
        TrackingLink: "https://provider.example/quarantined-url-secret",
      },
      { PromotionIds: "accepted-one" },
    ], next)),
    response({
      "@page": "2",
      "@numpages": "2",
      "@nextpageuri": null,
      Promotions: [
        42,
        { PromotionIds: ["quarantined-id-secret"] },
        { PromotionIds: "accepted-two" },
      ],
    }),
  ]);

  const result = await instance.fetchPromotions(initial);
  assert.equal(result.diagnostics.pagesFetched, 2);
  assert.equal(result.diagnostics.rawRecordCount, 6);
  assert.equal(result.diagnostics.acceptedRecordCount, 2);
  assert.equal(result.diagnostics.quarantinedRecordCount, 4);
  assert.deepEqual(result.diagnostics.quarantineReasonCounts, {
    malformed_record: 2,
    missing_promotion_id: 2,
    missing_campaign_id: 0,
  });
  assert.deepEqual(result.diagnostics.promotionIdShapeCounts, {
    missing: 0,
    null: 0,
    nonempty_string: 2,
    empty_or_whitespace_string: 1,
    number: 0,
    array: 1,
    object: 0,
    boolean: 0,
    other: 0,
  });
  assert.equal(
    Object.values(result.diagnostics.quarantineReasonCounts).reduce((total, count) => total + count, 0),
    result.diagnostics.quarantinedRecordCount,
  );
  assert.equal(
    Object.values(result.diagnostics.promotionIdShapeCounts ?? {}).reduce((total, count) => total + count, 0),
    result.diagnostics.rawRecordCount - result.diagnostics.quarantineReasonCounts.malformed_record,
  );
  assert.deepEqual(result.records.map((record) => record.promotionId), ["accepted-one", "accepted-two"]);
  const publicDiagnostics = JSON.stringify(result.diagnostics);
  for (const privateValue of [
    "quarantined-title-secret",
    "quarantined-url-secret",
    "quarantined-id-secret",
    "quarantine-cursor-secret",
  ]) assert.equal(publicDiagnostics.includes(privateValue), false);
});

test("completes when a later page has a metadata-proven null terminal continuation", async () => {
  const next = "/Mediapartners/2303074/Promotions?Page=2&cursor=opaque-provider-value";
  const { instance, transport } = client([
    response(promotions([{ PromotionIds: "accepted-page-one" }], next)),
    response({
      "@page": "2",
      "@numpages": "2",
      Promotions: [{ PromotionIds: "accepted-page-two" }],
      "@nextpageuri": null,
    }),
  ]);

  const result = await instance.fetchPromotions(initial);
  assert.equal(result.diagnostics.stopReason, "completed");
  assert.equal(result.diagnostics.parseFailureReason, null);
  assert.equal(result.diagnostics.pagesFetched, 2);
  assert.deepEqual(result.records.map((record) => record.promotionId), ["accepted-page-one", "accepted-page-two"]);
  assert.equal(result.diagnostics.rawRecordCount, 2);
  assert.equal(result.diagnostics.acceptedRecordCount, 2);
  assert.equal(result.diagnostics.pages[1]?.accepted, true);
  assert.equal(transport.requests.length, 2);
  assert.equal(JSON.stringify(result.diagnostics).includes("opaque-provider-value"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("@nextpageuri"), false);
});

test("retains prior accepted pages when a later non-terminal null continuation is malformed", async () => {
  const next = "/Mediapartners/2303074/Promotions?Page=2&cursor=opaque-provider-value";
  const { instance, transport } = client([
    response(promotions([{ PromotionIds: "accepted-page-one" }], next)),
    response({
      "@page": "2",
      "@numpages": "3",
      Promotions: [{ PromotionIds: "unaccepted-page-two-secret" }],
      "@nextpageuri": null,
    }),
  ]);

  const result = await instance.fetchPromotions(initial);
  assert.equal(result.diagnostics.stopReason, "malformed_page");
  assert.equal(result.diagnostics.parseFailureReason, "invalid_nextpageuri");
  assert.equal(result.diagnostics.pagesFetched, 2);
  assert.deepEqual(result.records.map((record) => record.promotionId), ["accepted-page-one"]);
  assert.equal(result.diagnostics.rawRecordCount, 1);
  assert.equal(result.diagnostics.acceptedRecordCount, 1);
  assert.equal(result.diagnostics.pages[1]?.accepted, false);
  assert.equal(
    result.diagnostics.pageErrors[0]?.detail,
    "Impact page did not satisfy the strict parser contract",
  );
  assert.equal(transport.requests.length, 2);
  assert.equal(JSON.stringify(result.diagnostics).includes("unaccepted-page-two-secret"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("opaque-provider-value"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("@nextpageuri"), false);
});
