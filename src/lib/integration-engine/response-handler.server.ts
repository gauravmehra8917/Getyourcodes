// Response handler: normalizes fetch results and errors into
// StandardResponse. Also extracts rate-limit hints from headers.

import type {
  ErrorClass,
  HttpMethod,
  RateLimitInfo,
  StandardResponse,
} from "./types";

export function classifyStatus(status: number): ErrorClass {
  if (status === 401) return "authentication_error";
  if (status === 403) return "authorization_error";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "validation_error";
  return "unknown_error";
}

export function extractRateLimit(headers: Record<string, string>): RateLimitInfo | undefined {
  const h = (name: string) =>
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  const remaining = h("X-RateLimit-Remaining") ?? h("x-ratelimit-remaining");
  const limit = h("X-RateLimit-Limit") ?? h("x-ratelimit-limit");
  const reset = h("X-RateLimit-Reset") ?? h("x-ratelimit-reset");
  const retryAfter = h("Retry-After") ?? h("retry-after");

  if (!remaining && !limit && !reset && !retryAfter) return undefined;

  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const n = Number(retryAfter);
    if (!Number.isNaN(n)) retryAfterMs = n * 1000;
    else {
      const t = Date.parse(retryAfter);
      if (!Number.isNaN(t)) retryAfterMs = Math.max(0, t - Date.now());
    }
  }
  let resetAt: string | undefined;
  if (reset) {
    const n = Number(reset);
    if (!Number.isNaN(n)) {
      // Reset can be seconds-until or unix-seconds; heuristic: >10 years = epoch.
      const asEpoch = n > 1e10 ? n : n > 1e6 ? n * 1000 : Date.now() + n * 1000;
      resetAt = new Date(asEpoch).toISOString();
    }
  }
  return {
    limit: limit ? Number(limit) : undefined,
    remaining: remaining ? Number(remaining) : undefined,
    resetAt,
    retryAfterMs,
  };
}

export function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

export function buildStandardResponse<T>(params: {
  integrationId: string;
  method: HttpMethod;
  url: string;
  status: number;
  latencyMs: number;
  retryCount: number;
  headers: Record<string, string>;
  body: T | null;
  error: StandardResponse["error"];
}): StandardResponse<T> {
  const rateLimit = extractRateLimit(params.headers);
  return {
    success: params.error == null && params.status >= 200 && params.status < 300,
    status: params.status,
    latencyMs: params.latencyMs,
    headers: params.headers,
    body: params.body,
    error: params.error,
    retryCount: params.retryCount,
    rateLimit,
    meta: {
      integrationId: params.integrationId,
      method: params.method,
      url: params.url,
      at: new Date().toISOString(),
    },
  };
}
