// Runtime-neutral, console-only integration logging.
// Persistence is intentionally kept outside the core so preview pipelines
// cannot reach a mutation-capable repository through their logging graph.

const SECRET_HEADER_KEYS = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key",
  "x-auth-token", "api-key", "apikey",
]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    redacted[key] = SECRET_HEADER_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ["apikey", "api_key", "token", "access_token", "auth", "signature"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redactBody(body: unknown, max = 500): string {
  let text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  if (!text) return "";
  text = text.replace(/("(?:password|api_?key|token|secret|authorization)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

let runtimeDebugEnabled = false;

/** Hosts explicitly configure debug logging without exposing environment APIs. */
export function configureDebugLogging(enabled: boolean): void {
  runtimeDebugEnabled = enabled;
}

function debugEnabled(): boolean { return runtimeDebugEnabled; }

/** Verbose, redacted console logging only. */
export function logDebug(label: string, payload: Record<string, unknown>) {
  if (!debugEnabled()) return;
  const safe: Record<string, unknown> = { ...payload };
  if (typeof safe.url === "string") safe.url = redactUrl(safe.url);
  if (safe.headers && typeof safe.headers === "object") safe.headers = redactHeaders(safe.headers as Record<string, string>);
  if ("body" in safe) safe.body = redactBody(safe.body);
  // eslint-disable-next-line no-console
  console.log(`[integration-engine:debug] ${label} ${JSON.stringify(safe)}`);
}
