// TanStack/server adapter: only this wrapper can opt into persistent request logging.
import { executeRequest as executeRuntimeRequest } from "./http-client";
import { logRequest } from "./logger.server";
import type { HttpRequestOptions, IntegrationConfig, StandardResponse } from "./types";

export function executeRequest<T = unknown>(config: IntegrationConfig, options: HttpRequestOptions): Promise<StandardResponse<T>> {
  return executeRuntimeRequest<T>(config, options, (entry, persist) => logRequest(entry, persist));
}
