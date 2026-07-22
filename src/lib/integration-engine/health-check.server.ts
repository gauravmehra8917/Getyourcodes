// Generic health checker. Runs a lightweight GET against the configured
// "health" endpoint (if any) or the base URL. Returns Healthy / Warning
// / Failed and is safe to reuse from the existing Test Connection flow.

import { executeRequest } from "./http-client.server";
import type { IntegrationConfig, StandardResponse } from "./types";

export type HealthState = "healthy" | "warning" | "failed";

export interface HealthResult {
  state: HealthState;
  status: number;
  latencyMs: number;
  message: string;
  response: StandardResponse<unknown>;
}

export async function runHealthCheck(config: IntegrationConfig): Promise<HealthResult> {
  const healthPath = (config.endpoints.health ?? "").trim();
  const res = await executeRequest(config, {
    method: "GET",
    path: healthPath || "",
    // Health checks should not retry aggressively — one lightweight attempt.
    retryAttempts: 0,
    timeoutMs: Math.min(config.timeoutMs, 15_000),
  });

  let state: HealthState;
  let message: string;
  if (res.success) {
    state = "healthy";
    message = "Connection successful";
  } else if (
    res.error?.class === "server_error" ||
    res.error?.class === "rate_limited" ||
    res.error?.class === "timeout"
  ) {
    state = "warning";
    message = res.error?.message ?? "Transient failure";
  } else {
    state = "failed";
    message = res.error?.message ?? "Health check failed";
  }

  return {
    state,
    status: res.status,
    latencyMs: res.latencyMs,
    message,
    response: res,
  };
}
