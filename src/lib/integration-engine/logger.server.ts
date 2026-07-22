// Request logger. Console-logs a compact, redacted line for every call.
// Optionally persists a row to affiliate_integration_tests (existing table,
// no schema changes) when persistLog is requested.
//
// NEVER logs credentials, tokens, request bodies, or response bodies.

import type { HttpMethod, StandardResponse } from "./types";

const SECRET_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "api-key",
  "apikey",
]);

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    out[k] = SECRET_HEADER_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : v;
  }
  return out;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const secretParams = ["apikey", "api_key", "token", "access_token", "auth", "signature"];
    for (const p of secretParams) {
      if (u.searchParams.has(p)) u.searchParams.set(p, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return url;
  }
}

export interface RequestLogEntry {
  integrationId: string;
  method: HttpMethod;
  url: string;
  status: number;
  latencyMs: number;
  retryCount: number;
  outcome: "success" | "failure";
  errorClass?: string;
  message?: string;
  environment?: string;
}

export function logConsole(entry: RequestLogEntry) {
  const safe = { ...entry, url: redactUrl(entry.url) };
  // eslint-disable-next-line no-console
  console.log(`[integration-engine] ${JSON.stringify(safe)}`);
}

/**
 * Persist a compact record into affiliate_integration_tests. Reuses the
 * existing table so no schema change is required in this phase.
 */
export async function persistRequestLog(entry: RequestLogEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("affiliate_integration_tests").insert({
      integration_id: entry.integrationId,
      status: entry.outcome === "success" ? "connected" : "failed",
      http_status: entry.status || null,
      latency_ms: entry.latencyMs,
      auth_status: "unknown",
      message: `${entry.method} ${redactUrl(entry.url)}${
        entry.errorClass ? ` — ${entry.errorClass}` : ""
      }${entry.message ? `: ${entry.message}` : ""}`,
      environment: entry.environment ?? "production",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[integration-engine] persistRequestLog failed", err instanceof Error ? err.message : String(err));
  }
}

export function logRequest(entry: RequestLogEntry, persist: boolean) {
  logConsole(entry);
  if (persist) void persistRequestLog(entry);
}
