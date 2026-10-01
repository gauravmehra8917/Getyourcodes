// Navigation cancellation can surface as a nested Node ECONNRESET/aborted
// error in the dev server, even when the Web Request signal is not aborted.
export function isRequestAbort(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (value.code === "ECONNRESET" && value.message === "aborted") return true;
    current = value.cause;
  }

  return false;
}