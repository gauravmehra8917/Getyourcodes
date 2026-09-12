// Runtime-neutral integration-engine construction.
//
// Database configuration loading and the concrete HTTP implementation stay in
// runtime adapters. This class can therefore be constructed by a trusted Edge
// runtime without importing the TanStack server loader.

import type {
  HttpRequestOptions,
  IntegrationConfig,
  StandardResponse,
  ValidationResult,
} from "./types.ts";

export interface HealthResult {
  state: "healthy" | "warning" | "failed";
  status: number;
  latencyMs: number;
  message: string;
  response: StandardResponse<unknown>;
}

export interface IntegrationEngineRuntime {
  validate(config: IntegrationConfig): ValidationResult;
  request<T>(config: IntegrationConfig, options: HttpRequestOptions): Promise<StandardResponse<T>>;
  healthCheck(config: IntegrationConfig): Promise<HealthResult>;
}

export class IntegrationEngine {
  private constructor(
    private readonly config: IntegrationConfig,
    private readonly runtime: IntegrationEngineRuntime,
  ) {}

  static fromConfig(config: IntegrationConfig, runtime: IntegrationEngineRuntime): IntegrationEngine {
    return new IntegrationEngine(config, runtime);
  }

  /** Config snapshot (credentials included — never send to the browser). */
  getConfig(): IntegrationConfig {
    return this.config;
  }

  validate(): ValidationResult {
    return this.runtime.validate(this.config);
  }

  async request<T = unknown>(opts: HttpRequestOptions): Promise<StandardResponse<T>> {
    const validation = this.validate();
    if (!validation.ok) {
      return {
        success: false,
        status: 0,
        latencyMs: 0,
        headers: {},
        body: null,
        error: { class: "validation_error", message: validation.errors.join("; ") },
        retryCount: 0,
        meta: {
          integrationId: this.config.id,
          method: opts.method ?? "GET",
          url: this.config.baseUrl,
          at: new Date().toISOString(),
        },
      };
    }
    return this.runtime.request<T>(this.config, opts);
  }

  healthCheck(): Promise<HealthResult> {
    return this.runtime.healthCheck(this.config);
  }
}
