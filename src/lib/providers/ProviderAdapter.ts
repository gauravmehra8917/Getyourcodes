// Provider Adapter interface. Every affiliate network / REST provider
// implements this contract. Skeletons live under ./adapters/.
//
// All methods return standardized results compatible with the
// Integration Engine (StandardResponse<T>) so callers can uniformly
// handle success/error/rate-limit metadata regardless of provider.

import type {
  IntegrationConfig,
  StandardResponse,
  ValidationResult,
} from "@/lib/integration-engine/types";
import type { HealthResult } from "@/lib/integration-engine/health-check.server";

/** Generic domain shapes. Adapters return these post-normalize().
 *  Fields intentionally minimal — real normalization is a later phase. */
export interface ProviderStore { external_id: string; name: string; url?: string; raw?: unknown }
export interface ProviderCoupon { external_id: string; title: string; code?: string; raw?: unknown }
export interface ProviderDeal { external_id: string; title: string; url?: string; raw?: unknown }
export interface ProviderCategory { external_id: string; name: string; raw?: unknown }

export interface FetchOptions {
  page?: number;
  pageSize?: number;
  since?: string; // ISO timestamp
  [k: string]: unknown;
}

export type ProviderResult<T> = StandardResponse<T>;

export interface ProviderAdapter {
  readonly providerKey: string;

  initialize(): Promise<void>;
  validateConfiguration(): ValidationResult;
  healthCheck(): Promise<HealthResult>;

  /** Perform any auth handshake (e.g. OAuth2 token exchange). No-op by default. */
  authenticate(): Promise<ProviderResult<{ authenticated: boolean }>>;

  fetchStores(opts?: FetchOptions): Promise<ProviderResult<ProviderStore[]>>;
  fetchCoupons(opts?: FetchOptions): Promise<ProviderResult<ProviderCoupon[]>>;
  fetchDeals(opts?: FetchOptions): Promise<ProviderResult<ProviderDeal[]>>;
  fetchCategories(opts?: FetchOptions): Promise<ProviderResult<ProviderCategory[]>>;

  /** Provider-specific → generic shape mapping. */
  normalize<TIn = unknown, TOut = unknown>(kind: "store" | "coupon" | "deal" | "category", raw: TIn): TOut;

  /** Release any resources / revoke tokens. No-op by default. */
  disconnect(): Promise<void>;

  /** Snapshot of the loaded integration configuration. */
  getConfig(): IntegrationConfig;
}

/** Structured error thrown by not-yet-implemented adapter methods. */
export class NotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";
  constructor(public readonly providerKey: string, public readonly method: string) {
    super(`Provider "${providerKey}" has not implemented "${method}" yet`);
    this.name = "NotImplementedError";
  }
}

/** Helper: wrap a NotImplementedError as a StandardResponse so call sites
 *  never have to special-case adapter readiness. */
export function notImplementedResponse<T>(
  config: IntegrationConfig,
  providerKey: string,
  method: string,
): ProviderResult<T> {
  return {
    success: false,
    status: 0,
    latencyMs: 0,
    headers: {},
    body: null,
    error: {
      class: "validation_error",
      message: `Provider "${providerKey}" has not implemented "${method}" yet`,
    },
    retryCount: 0,
    meta: {
      integrationId: config.id,
      method: "GET",
      url: config.baseUrl,
      at: new Date().toISOString(),
    },
  };
}
