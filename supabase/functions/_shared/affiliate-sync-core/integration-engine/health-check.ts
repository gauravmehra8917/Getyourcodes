// Runtime-neutral health check.

import { executeRequest } from "./http-client.ts";
import type { HealthResult } from "./engine.ts";
import type { IntegrationConfig } from "./types.ts";

export async function runHealthCheck(config: IntegrationConfig): Promise<HealthResult> {
  const healthPath = (config.endpoints.health ?? "").trim();
  const response = await executeRequest(config, { method: "GET", path: healthPath || "", retryAttempts: 0, timeoutMs: Math.min(config.timeoutMs, 15_000) });
  const state = response.success ? "healthy" : response.error?.class === "server_error" || response.error?.class === "rate_limited" || response.error?.class === "timeout" ? "warning" : "failed";
  const message = response.success ? "Connection successful" : state === "warning" ? response.error?.message ?? "Transient failure" : response.error?.message ?? "Health check failed";
  return { state, status: response.status, latencyMs: response.latencyMs, message, response };
}
