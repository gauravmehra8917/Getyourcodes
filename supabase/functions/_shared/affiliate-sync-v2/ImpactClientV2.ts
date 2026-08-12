import type {
  ImpactTransport,
  ImpactTransportResult,
} from "./contracts.ts";
import type {
  ImpactPageErrorV2,
  ImpactPageFetchDiagnosticV2,
  ImpactPageProvenanceV2,
  ImpactRetryDiagnosticV2,
  ImpactStream,
  ImpactStreamFetchDiagnosticsV2,
  QuarantinedImpactRecordV2,
  StreamStopReason,
} from "./diagnostics.ts";
import {
  sanitizeImpactDiagnosticUrl,
  validateImpactContinuation,
  type ImpactContinuationPolicy,
} from "./impact-url-safety.ts";
import { ImpactPageParser, type ImpactPageParseResultV2 } from "./ImpactPageParser.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "./models.ts";

export interface ImpactClientLimitsV2 {
  maxPages: number;
  maxRecords: number;
  maxResponseBytes: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxRetryAfterMs: number;
}

export type ImpactBackoffJitterV2 = (delayMs: number, attempt: number) => number;

export interface ImpactClientV2Options {
  transport: ImpactTransport;
  continuationPolicy: ImpactContinuationPolicy;
  limits: ImpactClientLimitsV2;
  requestTimeoutMs: number;
  jitter?: ImpactBackoffJitterV2;
}

export interface ImpactStreamFetchResultV2<T> {
  stream: ImpactStream;
  records: T[];
  quarantinedRecords: QuarantinedImpactRecordV2[];
  diagnostics: ImpactStreamFetchDiagnosticsV2;
}

type StreamRecord = RawImpactPromotionV2 | RawImpactCampaignV2;

type RequestOutcome =
  | { ok: true; bodyText: string; retry: ImpactRetryDiagnosticV2 }
  | { ok: false; stopReason: StreamStopReason; retry: ImpactRetryDiagnosticV2 };

interface ScopedRequestSignal {
  signal: AbortSignal;
  isTimedOut: () => boolean;
  isCallerCancelled: () => boolean;
  cleanup: () => void;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function emptyDiagnostics(stream: ImpactStream): ImpactStreamFetchDiagnosticsV2 {
  return {
    stream,
    pagesFetched: 0,
    rawRecordCount: 0,
    acceptedRecordCount: 0,
    quarantinedRecordCount: 0,
    stopReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  };
}

function pageError(
  stream: ImpactStream,
  code: ImpactPageErrorV2["code"],
  provenance: ImpactPageProvenanceV2,
  detail: string,
): ImpactPageErrorV2 {
  return {
    stream,
    code,
    provenance: {
      stream: provenance.stream,
      fetchSequence: provenance.fetchSequence,
      sanitizedRequestUrl: provenance.sanitizedRequestUrl,
      sanitizedSourceContinuationUrl: provenance.sanitizedSourceContinuationUrl,
    },
    detail,
  };
}

function responseByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function pageDiagnostic(
  provenance: ImpactPageProvenanceV2,
  rawRecordCount: number,
  acceptedRecordCount: number,
  quarantinedRecordCount: number,
  responseBytes: number | null,
  accepted: boolean,
): ImpactPageFetchDiagnosticV2 {
  return {
    provenance,
    rawRecordCount,
    acceptedRecordCount,
    quarantinedRecordCount,
    responseBytes,
    accepted,
  };
}

function scopedSignal(signal: AbortSignal | undefined, timeoutMs: number): ScopedRequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = signal?.aborted === true;
  const onAbort = () => {
    callerCancelled = true;
    controller.abort();
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, timeoutMs));
  if (callerCancelled) controller.abort();
  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    isCallerCancelled: () => callerCancelled,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

/** Strict, Impact-only page client. It neither interprets offers nor persists. */
export class ImpactClientV2 {
  private readonly options: ImpactClientV2Options;

  constructor(options: ImpactClientV2Options) {
    this.options = options;
  }

  fetchPromotions(initialUrl: string, signal?: AbortSignal): Promise<ImpactStreamFetchResultV2<RawImpactPromotionV2>> {
    return this.fetchStream("promotions", initialUrl, signal) as Promise<ImpactStreamFetchResultV2<RawImpactPromotionV2>>;
  }

  fetchCampaigns(initialUrl: string, signal?: AbortSignal): Promise<ImpactStreamFetchResultV2<RawImpactCampaignV2>> {
    return this.fetchStream("campaigns", initialUrl, signal) as Promise<ImpactStreamFetchResultV2<RawImpactCampaignV2>>;
  }

  private backoffDelay(result: Extract<ImpactTransportResult, { kind: "response" }>, attempt: number): number {
    if (result.retryAfterMs != null) {
      return Math.max(0, Math.floor(Math.min(this.options.limits.maxRetryAfterMs, result.retryAfterMs)));
    }
    const exponential = Math.min(
      this.options.limits.maxBackoffMs,
      this.options.limits.baseBackoffMs * (2 ** (attempt - 1)),
    );
    const jittered = this.options.jitter ? this.options.jitter(exponential, attempt) : exponential;
    return Math.min(this.options.limits.maxBackoffMs, Math.max(0, Math.floor(jittered)));
  }

  private async request(
    stream: ImpactStream,
    fetchSequence: number,
    url: string,
    sanitizedUrl: string,
    credentialDisposition: "attach_if_same_origin" | "omit",
    callerSignal: AbortSignal | undefined,
  ): Promise<RequestOutcome> {
    const retryDelaysMs: number[] = [];
    let attempts = 0;
    let finalStatus: number | null = null;
    const retry = (): ImpactRetryDiagnosticV2 => ({
      stream,
      fetchSequence,
      sanitizedRequestUrl: sanitizedUrl,
      attempts,
      retryDelaysMs: [...retryDelaysMs],
      finalStatus,
    });

    while (attempts < this.options.limits.maxAttempts) {
      if (callerSignal?.aborted) return { ok: false, stopReason: "cancelled", retry: retry() };
      attempts += 1;
      const scoped = scopedSignal(callerSignal, this.options.requestTimeoutMs);
      let result: ImpactTransportResult;
      try {
        result = await this.options.transport.execute({
          method: "GET",
          url,
          credentialDisposition,
          redirect: "error",
          signal: scoped.signal,
        });
      } catch {
        scoped.cleanup();
        return { ok: false, stopReason: callerSignal?.aborted ? "cancelled" : "transport_error", retry: retry() };
      }
      const timedOut = scoped.isTimedOut();
      const callerCancelled = scoped.isCallerCancelled();
      scoped.cleanup();
      if (callerCancelled) return { ok: false, stopReason: "cancelled", retry: retry() };
      if (timedOut) return { ok: false, stopReason: "timeout", retry: retry() };
      if (result.kind !== "response") {
        if (result.kind === "timeout") return { ok: false, stopReason: "timeout", retry: retry() };
        if (result.kind === "aborted") return { ok: false, stopReason: "cancelled", retry: retry() };
        return { ok: false, stopReason: "transport_error", retry: retry() };
      }

      finalStatus = result.status;
      if (isSuccessfulStatus(result.status)) return { ok: true, bodyText: result.bodyText, retry: retry() };
      if (!RETRYABLE_STATUSES.has(result.status) || attempts >= this.options.limits.maxAttempts) {
        return { ok: false, stopReason: "provider_error", retry: retry() };
      }

      const delayMs = this.backoffDelay(result, attempts);
      retryDelaysMs.push(delayMs);
      try {
        await this.options.transport.wait(delayMs, callerSignal);
      } catch {
        return { ok: false, stopReason: callerSignal?.aborted ? "cancelled" : "transport_error", retry: retry() };
      }
    }
    return { ok: false, stopReason: "provider_error", retry: retry() };
  }

  private parserFor(
    stream: ImpactStream,
  ): (bodyText: string, input: { provenance: ImpactPageProvenanceV2 }) => ImpactPageParseResultV2<StreamRecord> {
    return stream === "promotions" ? ImpactPageParser.promotions : ImpactPageParser.campaigns;
  }

  private async fetchStream(
    stream: ImpactStream,
    initialUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<ImpactStreamFetchResultV2<StreamRecord>> {
    const diagnostics = emptyDiagnostics(stream);
    const records: StreamRecord[] = [];
    const quarantinedRecords: QuarantinedImpactRecordV2[] = [];
    const initial = validateImpactContinuation(initialUrl, this.options.continuationPolicy);
    if (!initial.ok) {
      diagnostics.stopReason = "invalid_continuation";
      diagnostics.pageErrors.push(pageError(stream, "invalid_continuation", {
        stream,
        fetchSequence: 1,
        sanitizedRequestUrl: initial.sanitizedUrl ?? "",
        sanitizedSourceContinuationUrl: null,
        providerPage: null,
        providerPageSize: null,
      }, initial.detail));
      return { stream, records, quarantinedRecords, diagnostics };
    }

    let current = {
      url: initial.url,
      sanitizedUrl: initial.sanitizedUrl,
      credentialDisposition: initial.credentialDisposition,
      sanitizedSourceContinuationUrl: null as string | null,
    };
    const seenContinuationUrls = new Set<string>();
    let fetchSequence = 1;

    while (true) {
      if (signal?.aborted) {
        diagnostics.stopReason = "cancelled";
        break;
      }
      if (diagnostics.pagesFetched >= this.options.limits.maxPages) {
        diagnostics.stopReason = "page_limit";
        break;
      }

      const request = await this.request(
        stream,
        fetchSequence,
        current.url,
        current.sanitizedUrl,
        current.credentialDisposition,
        signal,
      );
      diagnostics.retries.push(request.retry);
      if (!request.ok) {
        diagnostics.stopReason = request.stopReason;
        break;
      }

      const baseProvenance: ImpactPageProvenanceV2 = {
        stream,
        fetchSequence,
        sanitizedRequestUrl: current.sanitizedUrl,
        sanitizedSourceContinuationUrl: current.sanitizedSourceContinuationUrl,
        providerPage: null,
        providerPageSize: null,
      };
      const bytes = responseByteLength(request.bodyText);
      diagnostics.pagesFetched += 1;
      if (bytes > this.options.limits.maxResponseBytes) {
        diagnostics.pages.push(pageDiagnostic(baseProvenance, 0, 0, 0, bytes, false));
        diagnostics.pageErrors.push(pageError(
          stream,
          "response_size_limit_exceeded",
          baseProvenance,
          "Impact response exceeded the configured response-size limit",
        ));
        diagnostics.stopReason = "provider_error";
        break;
      }

      const parser = this.parserFor(stream);
      const parsed = parser(request.bodyText, { provenance: baseProvenance });
      if (!parsed.ok) {
        diagnostics.pages.push(pageDiagnostic(baseProvenance, 0, 0, 0, bytes, false));
        diagnostics.pageErrors.push(pageError(stream, "malformed_page", baseProvenance, parsed.detail));
        diagnostics.stopReason = "malformed_page";
        break;
      }

      const provenance: ImpactPageProvenanceV2 = {
        ...baseProvenance,
        providerPage: parsed.pagination.page,
        providerPageSize: parsed.pagination.pageSize,
      };
      diagnostics.rawRecordCount += parsed.rawRecordCount;
      quarantinedRecords.push(...parsed.quarantinedRecords);
      diagnostics.quarantinedRecordCount += parsed.quarantinedRecords.length;
      const exceedsRecordLimit = records.length + parsed.records.length > this.options.limits.maxRecords;
      diagnostics.pages.push(pageDiagnostic(
        provenance,
        parsed.rawRecordCount,
        exceedsRecordLimit ? 0 : parsed.records.length,
        parsed.quarantinedRecords.length,
        bytes,
        !exceedsRecordLimit,
      ));
      if (exceedsRecordLimit) {
        diagnostics.stopReason = "record_limit";
        break;
      }

      records.push(...parsed.records);
      diagnostics.acceptedRecordCount += parsed.records.length;
      if (!parsed.nextContinuationUri) {
        diagnostics.stopReason = "completed";
        break;
      }

      const continuation = validateImpactContinuation(parsed.nextContinuationUri, this.options.continuationPolicy);
      if (!continuation.ok) {
        diagnostics.pageErrors.push(pageError(stream, "invalid_continuation", provenance, continuation.detail));
        diagnostics.stopReason = "invalid_continuation";
        break;
      }
      if (seenContinuationUrls.has(continuation.url)) {
        diagnostics.pageErrors.push(pageError(
          stream,
          "continuation_loop",
          provenance,
          "Impact returned a continuation URL that was already followed",
        ));
        diagnostics.stopReason = "continuation_loop";
        break;
      }
      seenContinuationUrls.add(continuation.url);
      current = {
        url: continuation.url,
        sanitizedUrl: continuation.sanitizedUrl,
        credentialDisposition: continuation.credentialDisposition,
        sanitizedSourceContinuationUrl: continuation.sanitizedUrl,
      };
      fetchSequence += 1;
    }

    return { stream, records, quarantinedRecords, diagnostics };
  }
}
