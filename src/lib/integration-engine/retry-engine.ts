// Runtime-neutral retry policy for transient provider failures.

export interface RetryDecision { retry: boolean; delayMs: number; }
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function shouldRetry(params: {
  attempt: number; maxAttempts: number; status?: number; networkError?: boolean;
  retryAfterMs?: number; baseDelayMs?: number;
}): RetryDecision {
  const { attempt, maxAttempts, status, networkError, retryAfterMs, baseDelayMs = 1000 } = params;
  if (attempt + 1 >= maxAttempts) return { retry: false, delayMs: 0 };
  if (!(networkError === true || (typeof status === "number" && RETRYABLE_STATUS.has(status)))) {
    return { retry: false, delayMs: 0 };
  }
  const backoff = Math.min(baseDelayMs * Math.pow(2, attempt), 30_000);
  return { retry: true, delayMs: Math.max(retryAfterMs ?? 0, backoff) + Math.floor(Math.random() * 250) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
