// TanStack/server adapter: only this wrapper can opt into persistent request logging.
import { executeRequest as executeRuntimeRequest } from "./http-client";
import { logRequest, type RequestLogEntry } from "./logger.server";
import type { HttpRequestOptions, IntegrationConfig, StandardResponse } from "./types";

interface ServerHttpRequestOptions extends HttpRequestOptions {
  /** Server-only persistence policy; never crosses into the shared core. */
  persistLog?: boolean;
}

export async function executeRequest<T = unknown>(config: IntegrationConfig, options: ServerHttpRequestOptions): Promise<StandardResponse<T>> {
  const started = Date.now();
  const response = await executeRuntimeRequest<T>(config, options);
  const entry: RequestLogEntry = {
    integrationId: config.id,
    method: response.meta.method,
    url: response.meta.url,
    status: response.status,
    latencyMs: Date.now() - started,
    retryCount: response.retryCount,
    outcome: response.success ? "success" : "failure",
    errorClass: response.error?.class,
    message: response.error?.message,
    environment: config.environment,
  };
  logRequest(entry, options.persistLog === true);
  return response;
}
