// The Integration Engine. Public entry point for provider-agnostic
// HTTP calls against a managed integration. Provider adapters (future
// phases) should compose this — never bypass it.

import { loadIntegrationConfig } from "./config-loader.server";
import { validateConfig } from "./validators.server";
import { executeRequest } from "./http-client.server";
import { runHealthCheck } from "./health-check.server";
import type {
  HttpRequestOptions,
  IntegrationConfig,
  StandardResponse,
  ValidationResult,
} from "./types";

export class IntegrationEngine {
  private config: IntegrationConfig;
  private constructor(config: IntegrationConfig) {
    this.config = config;
  }

  static async forIntegration(integrationId: string): Promise<IntegrationEngine> {
    const config = await loadIntegrationConfig(integrationId);
    return new IntegrationEngine(config);
  }

  /** Config snapshot (credentials included — never send to the browser). */
  getConfig(): IntegrationConfig {
    return this.config;
  }

  validate(): ValidationResult {
    return validateConfig(this.config);
  }

  /** Perform a single validated HTTP call. */
  async request<T = unknown>(opts: HttpRequestOptions): Promise<StandardResponse<T>> {
    const v = validateConfig(this.config);
    if (!v.ok) {
      return {
        success: false,
        status: 0,
        latencyMs: 0,
        headers: {},
        body: null,
        error: { class: "validation_error", message: v.errors.join("; ") },
        retryCount: 0,
        meta: {
          integrationId: this.config.id,
          method: opts.method ?? "GET",
          url: this.config.baseUrl,
          at: new Date().toISOString(),
        },
      };
    }
    return executeRequest<T>(this.config, opts);
  }

  healthCheck() {
    return runHealthCheck(this.config);
  }
}
