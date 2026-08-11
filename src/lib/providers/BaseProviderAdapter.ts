// Base adapter: wires an integration to the Integration Engine and
// provides safe defaults for every ProviderAdapter method. Concrete
// adapters extend this and override only the methods they implement.

import { IntegrationEngine } from "@/lib/integration-engine/engine";
import { createServerIntegrationEngine } from "@/lib/integration-engine/engine.server";
import type {
  IntegrationConfig,
  ValidationResult,
} from "@/lib/integration-engine/types";
import type { HealthResult } from "@/lib/integration-engine/health-check.server";
import {
  notImplementedResponse,
  type FetchOptions,
  type ProviderAdapter,
  type ProviderCategory,
  type ProviderCoupon,
  type ProviderDeal,
  type ProviderResult,
  type ProviderStore,
} from "./ProviderAdapter";

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly providerKey: string;

  protected engine: IntegrationEngine;
  protected initialized = false;

  constructor(engine: IntegrationEngine) {
    this.engine = engine;
  }

  static async build<T extends BaseProviderAdapter>(
    this: new (engine: IntegrationEngine) => T,
    integrationId: string,
  ): Promise<T> {
    const engine = await createServerIntegrationEngine(integrationId);
    const adapter = new this(engine);
    return adapter;
  }

  getConfig(): IntegrationConfig { return this.engine.getConfig(); }

  async initialize(): Promise<void> { this.initialized = true; }

  validateConfiguration(): ValidationResult { return this.engine.validate(); }

  healthCheck(): Promise<HealthResult> { return this.engine.healthCheck(); }

  async authenticate(): Promise<ProviderResult<{ authenticated: boolean }>> {
    // Default: rely on the engine's per-request auth headers (API key /
    // bearer / basic). OAuth2 adapters override this to exchange tokens.
    const v = this.validateConfiguration();
    const config = this.getConfig();
    return {
      success: v.ok,
      status: v.ok ? 200 : 0,
      latencyMs: 0,
      headers: {},
      body: { authenticated: v.ok },
      error: v.ok ? null : { class: "validation_error", message: v.errors.join("; ") },
      retryCount: 0,
      meta: {
        integrationId: config.id,
        method: "GET",
        url: config.baseUrl,
        at: new Date().toISOString(),
      },
    };
  }

  fetchStores(_opts?: FetchOptions): Promise<ProviderResult<ProviderStore[]>> {
    return Promise.resolve(notImplementedResponse(this.getConfig(), this.providerKey, "fetchStores"));
  }
  fetchCoupons(_opts?: FetchOptions): Promise<ProviderResult<ProviderCoupon[]>> {
    return Promise.resolve(notImplementedResponse(this.getConfig(), this.providerKey, "fetchCoupons"));
  }
  fetchDeals(_opts?: FetchOptions): Promise<ProviderResult<ProviderDeal[]>> {
    return Promise.resolve(notImplementedResponse(this.getConfig(), this.providerKey, "fetchDeals"));
  }
  fetchCategories(_opts?: FetchOptions): Promise<ProviderResult<ProviderCategory[]>> {
    return Promise.resolve(notImplementedResponse(this.getConfig(), this.providerKey, "fetchCategories"));
  }

  normalize<TIn = unknown, TOut = unknown>(_kind: "store" | "coupon" | "deal" | "category", raw: TIn): TOut {
    // Default identity mapping — provider-specific normalization is a
    // later phase (adapters override).
    return raw as unknown as TOut;
  }

  async disconnect(): Promise<void> { this.initialized = false; }
}
