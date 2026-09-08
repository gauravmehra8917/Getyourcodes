import {
  type ImpactContinuationPolicy,
  validateImpactContinuation,
} from "../affiliate-sync-v2/impact-url-safety.ts";
import type {
  ImpactAdsCredentialDispositionV2,
  ImpactAdsFetchDiagnosticsV2,
  ImpactAdsFetchLimitsV2,
  ImpactAdsFetchStopReasonV2,
  ImpactAdsPageDiagnosticV2,
  ImpactAdsParseFailureReasonV2,
  ImpactAdsQuarantineReasonCountsV2,
  ImpactAdsTransportResultV2,
  ImpactAdsTransportV2,
} from "./ads-diagnostics.ts";

interface ParsedPageV2<T> {
  ok: true;
  records: T[];
  rawRecordCount: number;
  quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2;
  providerPage: number | null;
  providerPageSize: number | null;
  nextContinuationUri: string | null;
}

interface ParseFailureV2 {
  ok: false;
  reason: ImpactAdsParseFailureReasonV2;
}

export interface BoundedImpactFetchResultV2<T> {
  records: T[];
  diagnostics: ImpactAdsFetchDiagnosticsV2;
}

interface BoundedImpactClientOptionsV2<T> {
  stream: "ads" | "campaigns";
  transport: ImpactAdsTransportV2;
  continuationPolicy: ImpactContinuationPolicy;
  limits: ImpactAdsFetchLimitsV2;
  requestTimeoutMs: number;
  parse(bodyText: string, input: { fetchSequence: number }):
    | ParsedPageV2<T>
    | ParseFailureV2;
  exactInitialRequest(
    initialUrl: string,
    policy: ImpactContinuationPolicy,
    limits: ImpactAdsFetchLimitsV2,
  ): boolean;
}

type PageRequestOutcomeV2 =
  | { ok: true; bodyText: string }
  | { ok: false; stopReason: ImpactAdsFetchStopReasonV2 };

interface ScopedSignalV2 {
  signal: AbortSignal;
  timedOut(): boolean;
  callerCancelled(): boolean;
  cleanup(): void;
}

const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

function emptyQuarantineCounts(): ImpactAdsQuarantineReasonCountsV2 {
  return {
    malformed_record: 0,
    missing_ad_id: 0,
    missing_campaign_id: 0,
  };
}

function emptyDiagnostics(
  stream: "ads" | "campaigns",
): ImpactAdsFetchDiagnosticsV2 {
  return {
    stream,
    complete: false,
    stopReason: "transport_error",
    parseFailureReason: null,
    pagesFetched: 0,
    physicalRequests: 0,
    retryCount: 0,
    rawRecords: 0,
    acceptedRecords: 0,
    quarantinedRecords: 0,
    recordsDiscardedByLimit: 0,
    quarantineReasonCounts: emptyQuarantineCounts(),
    pages: [],
    rate: { limit: null, remaining: null, reset: null },
  };
}

function nonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function assertImpactAdsFetchLimitsV2(
  limits: ImpactAdsFetchLimitsV2,
): void {
  for (
    const [name, value] of [
      ["pageSize", limits.pageSize],
      ["maxPages", limits.maxPages],
      ["maxRecords", limits.maxRecords],
      ["maxPhysicalRequests", limits.maxPhysicalRequests],
      ["maxResponseBytes", limits.maxResponseBytes],
      ["maxAttemptsPerPage", limits.maxAttemptsPerPage],
    ] as const
  ) positiveSafeInteger(value, name);
  for (
    const [name, value] of [
      ["baseBackoffMs", limits.baseBackoffMs],
      ["maxBackoffMs", limits.maxBackoffMs],
      ["maxRetryAfterMs", limits.maxRetryAfterMs],
      ["rateRemainingFloor", limits.rateRemainingFloor],
    ] as const
  ) nonNegativeSafeInteger(value, name);
  if (limits.baseBackoffMs > limits.maxBackoffMs) {
    throw new Error("baseBackoffMs must not exceed maxBackoffMs");
  }
}

function scopedSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): ScopedSignalV2 {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("requestTimeoutMs must be a positive safe integer");
  }
  const controller = new AbortController();
  let didTimeOut = false;
  let didCallerCancel = callerSignal?.aborted === true;
  const onAbort = () => {
    didCallerCancel = true;
    controller.abort();
  };
  if (callerSignal) {
    callerSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);
  if (didCallerCancel) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    callerCancelled: () => didCallerCancel,
    cleanup: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
    },
  };
}

function responseByteLength(bodyText: string): number {
  return new TextEncoder().encode(bodyText).byteLength;
}

function rateFloorReached(
  transport: ImpactAdsTransportV2,
  floor: number,
): boolean {
  const remaining = transport.readRateSnapshot().remaining;
  return remaining !== null && remaining <= floor;
}

function finish<T>(
  records: T[],
  diagnostics: ImpactAdsFetchDiagnosticsV2,
  transport: ImpactAdsTransportV2,
  stopReason: ImpactAdsFetchStopReasonV2,
): BoundedImpactFetchResultV2<T> {
  diagnostics.stopReason = stopReason;
  diagnostics.complete = stopReason === "completed";
  diagnostics.rate = transport.readRateSnapshot();
  return { records, diagnostics };
}

function addQuarantineCounts(
  target: ImpactAdsQuarantineReasonCountsV2,
  source: ImpactAdsQuarantineReasonCountsV2,
): number {
  target.malformed_record += source.malformed_record;
  target.missing_ad_id += source.missing_ad_id;
  target.missing_campaign_id += source.missing_campaign_id;
  return source.malformed_record + source.missing_ad_id +
    source.missing_campaign_id;
}

function pageDiagnostic<T>(
  fetchSequence: number,
  parsed: ParsedPageV2<T>,
  responseBytes: number,
  accepted: boolean,
): ImpactAdsPageDiagnosticV2 {
  const quarantined = Object.values(parsed.quarantineReasonCounts).reduce(
    (total, count) => total + count,
    0,
  );
  return {
    fetchSequence,
    providerPage: parsed.providerPage,
    providerPageSize: parsed.providerPageSize,
    responseBytes,
    rawRecords: parsed.rawRecordCount,
    acceptedRecords: accepted ? parsed.records.length : 0,
    quarantinedRecords: quarantined,
    accepted,
  };
}

function backoffDelay(
  response: Extract<ImpactAdsTransportResultV2, { kind: "response" }>,
  attempt: number,
  limits: ImpactAdsFetchLimitsV2,
): number {
  if (response.retryAfterMs !== null) {
    return Math.min(
      limits.maxRetryAfterMs,
      Math.max(0, Math.floor(response.retryAfterMs)),
    );
  }
  return Math.min(
    limits.maxBackoffMs,
    limits.baseBackoffMs * (2 ** (attempt - 1)),
  );
}

async function requestPage<T>(
  options: BoundedImpactClientOptionsV2<T>,
  diagnostics: ImpactAdsFetchDiagnosticsV2,
  url: string,
  credentialDisposition: ImpactAdsCredentialDispositionV2,
  callerSignal: AbortSignal | undefined,
): Promise<PageRequestOutcomeV2> {
  let attempts = 0;
  while (attempts < options.limits.maxAttemptsPerPage) {
    if (callerSignal?.aborted) {
      return { ok: false, stopReason: "cancelled" };
    }
    if (
      rateFloorReached(
        options.transport,
        options.limits.rateRemainingFloor,
      )
    ) return { ok: false, stopReason: "rate_limit_threshold" };
    if (
      diagnostics.physicalRequests >= options.limits.maxPhysicalRequests
    ) return { ok: false, stopReason: "physical_request_limit" };

    attempts += 1;
    diagnostics.physicalRequests += 1;
    const scoped = scopedSignal(callerSignal, options.requestTimeoutMs);
    let result: ImpactAdsTransportResultV2;
    try {
      result = await options.transport.execute({
        method: "GET",
        url,
        credentialDisposition,
        redirect: "error",
        signal: scoped.signal,
      });
    } catch {
      const sizeExceeded = options.transport
        .consumeResponseSizeLimitExceeded();
      const cancelled = scoped.callerCancelled();
      const timedOut = scoped.timedOut();
      scoped.cleanup();
      return {
        ok: false,
        stopReason: sizeExceeded
          ? "response_size_limit"
          : cancelled
          ? "cancelled"
          : timedOut
          ? "timeout"
          : "transport_error",
      };
    }
    const cancelled = scoped.callerCancelled();
    const timedOut = scoped.timedOut();
    scoped.cleanup();
    if (options.transport.consumeResponseSizeLimitExceeded()) {
      return { ok: false, stopReason: "response_size_limit" };
    }
    if (cancelled) return { ok: false, stopReason: "cancelled" };
    if (timedOut) return { ok: false, stopReason: "timeout" };
    if (result.kind !== "response") {
      if (result.kind === "timeout") {
        return { ok: false, stopReason: "timeout" };
      }
      if (result.kind === "aborted") {
        return { ok: false, stopReason: "cancelled" };
      }
      return { ok: false, stopReason: "transport_error" };
    }
    if (result.status >= 200 && result.status < 300) {
      return { ok: true, bodyText: result.bodyText };
    }
    if (result.status === 429) {
      return { ok: false, stopReason: "rate_limited" };
    }
    if (
      !RETRYABLE_STATUSES.has(result.status) ||
      attempts >= options.limits.maxAttemptsPerPage
    ) return { ok: false, stopReason: "provider_error" };
    if (
      rateFloorReached(
        options.transport,
        options.limits.rateRemainingFloor,
      )
    ) return { ok: false, stopReason: "rate_limit_threshold" };
    if (
      diagnostics.physicalRequests >= options.limits.maxPhysicalRequests
    ) return { ok: false, stopReason: "physical_request_limit" };
    diagnostics.retryCount += 1;
    try {
      await options.transport.wait(
        backoffDelay(result, attempts, options.limits),
        callerSignal,
      );
    } catch {
      return {
        ok: false,
        stopReason: callerSignal?.aborted ? "cancelled" : "transport_error",
      };
    }
  }
  return { ok: false, stopReason: "provider_error" };
}

export async function fetchBoundedImpactCollectionV2<T>(
  initialUrl: string,
  options: BoundedImpactClientOptionsV2<T>,
  signal?: AbortSignal,
): Promise<BoundedImpactFetchResultV2<T>> {
  assertImpactAdsFetchLimitsV2(options.limits);
  const records: T[] = [];
  const diagnostics = emptyDiagnostics(options.stream);
  const initial = validateImpactContinuation(
    initialUrl,
    options.continuationPolicy,
  );
  if (
    !initial.ok ||
    !options.exactInitialRequest(
      initialUrl,
      options.continuationPolicy,
      options.limits,
    )
  ) {
    return finish(
      records,
      diagnostics,
      options.transport,
      "invalid_continuation",
    );
  }

  let current = {
    url: initial.url,
    credentialDisposition: initial.credentialDisposition,
  };
  const seen = new Set([initial.url]);
  let fetchSequence = 1;

  while (true) {
    if (signal?.aborted) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "cancelled",
      );
    }
    if (diagnostics.pagesFetched >= options.limits.maxPages) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "page_limit",
      );
    }
    const requested = await requestPage(
      options,
      diagnostics,
      current.url,
      current.credentialDisposition,
      signal,
    );
    if (!requested.ok) {
      return finish(
        records,
        diagnostics,
        options.transport,
        requested.stopReason,
      );
    }

    diagnostics.pagesFetched += 1;
    const responseBytes = responseByteLength(requested.bodyText);
    if (responseBytes > options.limits.maxResponseBytes) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "response_size_limit",
      );
    }
    const parsed = options.parse(requested.bodyText, { fetchSequence });
    if (!parsed.ok) {
      diagnostics.parseFailureReason = parsed.reason;
      return finish(
        records,
        diagnostics,
        options.transport,
        "malformed_page",
      );
    }

    diagnostics.rawRecords += parsed.rawRecordCount;
    const quarantined = addQuarantineCounts(
      diagnostics.quarantineReasonCounts,
      parsed.quarantineReasonCounts,
    );
    diagnostics.quarantinedRecords += quarantined;
    const exceedsRecordLimit =
      records.length + parsed.records.length > options.limits.maxRecords;
    diagnostics.pages.push(
      pageDiagnostic(fetchSequence, parsed, responseBytes, !exceedsRecordLimit),
    );
    if (exceedsRecordLimit) {
      diagnostics.recordsDiscardedByLimit += parsed.records.length;
      return finish(
        records,
        diagnostics,
        options.transport,
        "record_limit",
      );
    }
    records.push(...parsed.records);
    diagnostics.acceptedRecords += parsed.records.length;

    if (parsed.nextContinuationUri === null) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "completed",
      );
    }
    const continuation = validateImpactContinuation(
      parsed.nextContinuationUri,
      options.continuationPolicy,
    );
    if (!continuation.ok) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "invalid_continuation",
      );
    }
    if (seen.has(continuation.url)) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "continuation_loop",
      );
    }
    seen.add(continuation.url);
    // Once the exact record budget is full, no later page can contribute a
    // record. Preserve page-limit precedence when both limits meet together.
    if (diagnostics.pagesFetched >= options.limits.maxPages) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "page_limit",
      );
    }
    if (records.length >= options.limits.maxRecords) {
      return finish(
        records,
        diagnostics,
        options.transport,
        "record_limit",
      );
    }
    current = {
      url: continuation.url,
      credentialDisposition: continuation.credentialDisposition,
    };
    fetchSequence += 1;
  }
}

function initialUrlParts(
  value: string,
  policy: ImpactContinuationPolicy,
): { url: URL; segments: string[] } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash || url.username || url.password) return null;
  const accountSids = policy.accountSidPathSegments ?? [];
  if (accountSids.length !== 1) return null;
  const segments: string[] = [];
  for (const segment of url.pathname.split("/").filter(Boolean)) {
    try {
      segments.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  if (
    segments.length !== 3 || segments[0] !== "Mediapartners" ||
    segments[1] !== accountSids[0]
  ) return null;
  return { url, segments };
}

export function isExactInitialAdsRequestV2(
  value: string,
  policy: ImpactContinuationPolicy,
  limits: ImpactAdsFetchLimitsV2,
): boolean {
  const parts = initialUrlParts(value, policy);
  if (!parts || parts.segments[2] !== "Ads") return false;
  const entries = [...parts.url.searchParams.entries()];
  return entries.length === 3 &&
    parts.url.searchParams.getAll("Type").length === 1 &&
    parts.url.searchParams.get("Type") === "COUPON" &&
    parts.url.searchParams.getAll("Page").length === 1 &&
    parts.url.searchParams.get("Page") === "1" &&
    parts.url.searchParams.getAll("PageSize").length === 1 &&
    parts.url.searchParams.get("PageSize") === String(limits.pageSize);
}

export function isExactInitialCampaignsRequestV2(
  value: string,
  policy: ImpactContinuationPolicy,
  limits: ImpactAdsFetchLimitsV2,
): boolean {
  const parts = initialUrlParts(value, policy);
  if (!parts || parts.segments[2] !== "Campaigns") return false;
  return parts.url.searchParams.getAll("Page").length === 1 &&
    parts.url.searchParams.get("Page") === "1" &&
    parts.url.searchParams.getAll("PageSize").length === 1 &&
    parts.url.searchParams.get("PageSize") === String(limits.pageSize);
}
