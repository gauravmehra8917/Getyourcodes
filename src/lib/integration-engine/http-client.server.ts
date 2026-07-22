// Core HTTP client: performs one fully-configured request against an
// IntegrationConfig, with timeout, retries, rate-limit awareness, and
// standardized responses. Provider-agnostic.

import { buildRequest } from "./request-builder.server";
import { logRequest } from "./logger.server";
import { shouldRetry, sleep } from "./retry-engine.server";
import {
  buildStandardResponse,
  classifyStatus,
  extractRateLimit,
  headersToObject,
} from "./response-handler.server";
import type {
  ErrorClass,
  HttpRequestOptions,
  IntegrationConfig,
  StandardResponse,
} from "./types";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

async function readBounded(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: await res.text(), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (total + value.byteLength > max) {
        chunks.push(value.subarray(0, Math.max(0, max - total)));
        total = max;
        truncated = true;
        try { await reader.cancel(); } catch { /* noop */ }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  return { text: new TextDecoder().decode(buf), truncated };
}

function parseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (/application\/(?:[\w.+-]*\+)?json/i.test(contentType) || (text.startsWith("{") || text.startsWith("["))) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }
  return text;
}

export async function executeRequest<T = unknown>(
  config: IntegrationConfig,
  opts: HttpRequestOptions,
): Promise<StandardResponse<T>> {
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const maxAttempts = Math.max(1, (opts.retryAttempts ?? config.retryAttempts) + 1);
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_BYTES;

  const built = buildRequest(config, opts);
  const started = Date.now();
  let attempt = 0;
  let lastResp: StandardResponse<T> | null = null;

  while (attempt < maxAttempts) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const attemptStart = Date.now();
    let status = 0;
    let respHeaders: Record<string, string> = {};
    let bodyParsed: T | null = null;
    let errorClass: ErrorClass | null = null;
    let errorMessage = "";
    let networkError = false;

    try {
      const res = await fetch(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
        signal: controller.signal,
      });
      status = res.status;
      respHeaders = headersToObject(res.headers);
      const { text, truncated } = await readBounded(res, maxBytes);
      bodyParsed = parseBody(text, respHeaders["content-type"] ?? "") as T | null;
      if (truncated) {
        // surface truncation without failing the call
        respHeaders["x-engine-truncated"] = "true";
      }
      if (status < 200 || status >= 300) {
        errorClass = classifyStatus(status);
        errorMessage = `HTTP ${status}`;
      }
    } catch (err) {
      networkError = true;
      if (err instanceof Error && err.name === "AbortError") {
        errorClass = "timeout";
        errorMessage = "Request timed out";
      } else {
        errorClass = "network_error";
        errorMessage = err instanceof Error ? err.message : "Network error";
      }
    } finally {
      clearTimeout(t);
    }

    const latencyMs = Date.now() - attemptStart;
    lastResp = buildStandardResponse<T>({
      integrationId: config.id,
      method: built.method,
      url: built.url,
      status,
      latencyMs,
      retryCount: attempt,
      headers: respHeaders,
      body: bodyParsed,
      error: errorClass ? { class: errorClass, message: errorMessage } : null,
    });

    const rate = extractRateLimit(respHeaders);
    const decision = shouldRetry({
      attempt,
      maxAttempts,
      status: status || undefined,
      networkError,
      retryAfterMs: rate?.retryAfterMs,
    });

    if (!decision.retry) break;
    await sleep(decision.delayMs);
    attempt += 1;
  }

  const finalResp = lastResp as StandardResponse<T>;
  logRequest(
    {
      integrationId: config.id,
      method: finalResp.meta.method,
      url: finalResp.meta.url,
      status: finalResp.status,
      latencyMs: Date.now() - started,
      retryCount: finalResp.retryCount,
      outcome: finalResp.success ? "success" : "failure",
      errorClass: finalResp.error?.class,
      message: finalResp.error?.message,
      environment: config.environment,
    },
    !!opts.persistLog,
  );
  return finalResp;
}
