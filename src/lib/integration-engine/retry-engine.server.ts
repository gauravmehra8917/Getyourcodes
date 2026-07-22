// Retry policy: exponential backoff for transient failures only.
// Retries 429 + 5xx (500/502/503/504) and network/timeout errors.
// Never retries 4xx client errors like 400/401/403/404.

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function shouldRetry(params: {
  attempt: number;             // 0-indexed attempt just completed
  maxAttempts: number;         // total attempts allowed (>= 1)
  status?: number;             // HTTP status if a response came back
  networkError?: boolean;      // fetch threw (DNS/reset/abort/etc)
  retryAfterMs?: number;       // provider-signalled backoff (e.g. Retry-After)
  baseDelayMs?: number;        // default 1000
}): RetryDecision {
  const {
    attempt,
    maxAttempts,
    status,
    networkError,
    retryAfterMs,
    baseDelayMs = 1000,
  } = params;

  if (attempt + 1 >= maxAttempts) return { retry: false, delayMs: 0 };

  const transient =
    networkError === true ||
    (typeof status === "number" && RETRYABLE_STATUS.has(status));
  if (!transient) return { retry: false, delayMs: 0 };

  // Exponential backoff: 1s → 2s → 4s → 8s (capped at 30s), plus jitter.
  const backoff = Math.min(baseDelayMs * Math.pow(2, attempt), 30_000);
  const jitter = Math.floor(Math.random() * 250);
  const delay = Math.max(retryAfterMs ?? 0, backoff) + jitter;
  return { retry: true, delayMs: delay };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
