// Runtime-neutral HTTP client. Hosts receive a standard response and decide
// independently whether any runtime-specific logging is appropriate.

import { buildRequest } from "./request-builder.ts";
import { logDebug } from "./logger.ts";
import { shouldRetry, sleep } from "./retry-engine.ts";
import { buildStandardResponse, classifyStatus, extractRateLimit, headersToObject } from "./response-handler.ts";
import type { ErrorClass, HttpMethod, HttpRequestOptions, IntegrationConfig, StandardResponse } from "./types.ts";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

async function readBounded(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: await res.text(), truncated: false };
  const chunks: Uint8Array[] = []; let total = 0; let truncated = false;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    if (value) {
      if (total + value.byteLength > max) { chunks.push(value.subarray(0, Math.max(0, max - total))); total = max; truncated = true; try { await reader.cancel(); } catch { /* noop */ } break; }
      chunks.push(value); total += value.byteLength;
    }
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes), truncated };
}

function parseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (/application\/(?:[\w.+-]*\+)?json/i.test(contentType) || text.startsWith("{") || text.startsWith("[")) {
    try { return JSON.parse(text); } catch { /* return text */ }
  }
  return text;
}

export async function executeRequest<T = unknown>(config: IntegrationConfig, opts: HttpRequestOptions): Promise<StandardResponse<T>> {
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const maxAttempts = Math.max(1, (opts.retryAttempts ?? config.retryAttempts) + 1);
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const built = buildRequest(config, opts);
  logDebug("request", { integrationId: config.id, method: built.method, url: built.url, headers: built.headers, authConfigured: built.authConfigured, unresolvedVariables: built.unresolvedVariables });
  let attempt = 0; let lastResp: StandardResponse<T> | null = null;
  while (attempt < maxAttempts) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs); const attemptStart = Date.now();
    let status = 0; let headers: Record<string, string> = {}; let body: T | null = null; let errorClass: ErrorClass | null = null; let errorMessage = ""; let networkError = false;
    try {
      const response = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body, signal: controller.signal });
      status = response.status; headers = headersToObject(response.headers);
      const bounded = await readBounded(response, maxBytes); body = parseBody(bounded.text, headers["content-type"] ?? "") as T | null;
      if (bounded.truncated) headers["x-engine-truncated"] = "true";
      logDebug("response", { integrationId: config.id, method: built.method, url: built.url, status, body: bounded.text });
      if (status < 200 || status >= 300) { errorClass = classifyStatus(status); errorMessage = `HTTP ${status}`; }
    } catch (error) {
      networkError = true;
      if (error instanceof Error && error.name === "AbortError") { errorClass = "timeout"; errorMessage = "Request timed out"; }
      else { errorClass = "network_error"; errorMessage = error instanceof Error ? error.message : "Network error"; }
    } finally { clearTimeout(timeout); }
    lastResp = buildStandardResponse<T>({ integrationId: config.id, method: built.method, url: built.url, status, latencyMs: Date.now() - attemptStart, retryCount: attempt, headers, body, error: errorClass ? { class: errorClass, message: errorMessage } : null });
    const decision = shouldRetry({ attempt, maxAttempts, status: status || undefined, networkError, retryAfterMs: extractRateLimit(headers)?.retryAfterMs });
    if (!decision.retry) break;
    await sleep(decision.delayMs); attempt += 1;
  }
  return lastResp as StandardResponse<T>;
}
