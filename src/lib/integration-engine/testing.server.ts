// Internal developer testing utilities for the Integration Engine.
// Backend only — not wired to any admin UI. Useful for smoke tests
// and future provider-adapter authors.

import { IntegrationEngine } from "./engine.server";
import { validateConfig } from "./validators.server";
import type { HttpRequestOptions, StandardResponse, ValidationResult } from "./types";

export async function validateIntegration(integrationId: string): Promise<ValidationResult> {
  const engine = await IntegrationEngine.forIntegration(integrationId);
  return validateConfig(engine.getConfig());
}

export async function simulateRequest<T = unknown>(
  integrationId: string,
  opts: HttpRequestOptions,
): Promise<StandardResponse<T>> {
  const engine = await IntegrationEngine.forIntegration(integrationId);
  return engine.request<T>(opts);
}

/** Uses the public httpbin.org/delay endpoint to force a timeout. */
export async function simulateTimeout(integrationId: string): Promise<StandardResponse> {
  const engine = await IntegrationEngine.forIntegration(integrationId);
  return engine.request({
    method: "GET",
    path: "https://httpbin.org/delay/10",
    timeoutMs: 1_000,
    retryAttempts: 0,
  });
}

/** Hits an endpoint that returns 429 to exercise the rate-limit path. */
export async function simulateRateLimit(integrationId: string): Promise<StandardResponse> {
  const engine = await IntegrationEngine.forIntegration(integrationId);
  return engine.request({
    method: "GET",
    path: "https://httpbin.org/status/429",
    retryAttempts: 0,
  });
}

/** Hits an endpoint that returns 401 to exercise auth failure classification. */
export async function simulateAuthFailure(integrationId: string): Promise<StandardResponse> {
  const engine = await IntegrationEngine.forIntegration(integrationId);
  return engine.request({
    method: "GET",
    path: "https://httpbin.org/status/401",
    retryAttempts: 0,
  });
}
