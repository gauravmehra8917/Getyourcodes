// Shared types for the generic integration engine.
// Provider-agnostic — no affiliate-network specifics.

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type AuthenticationType =
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2"
  | "custom_headers";

export type ApiKeyPlacement = "header" | "query";

export interface CustomHeader {
  key: string;
  value: string;
}

/**
 * Decrypted credentials as loaded by ConfigLoader.
 * Never returned to the browser.
 */
export interface IntegrationCredentials {
  apiKey?: string;
  apiKeyName?: string;         // header/query param name (default: X-API-Key / apikey)
  apiKeyPlacement?: ApiKeyPlacement;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string;
  customHeaders?: CustomHeader[];
}

/**
 * Fully-resolved integration configuration for the engine.
 * Produced by ConfigLoader; consumed by every other module.
 */
export interface IntegrationConfig {
  id: string;
  name: string;
  providerName: string;
  providerType: string;
  authenticationType: AuthenticationType;
  baseUrl: string;
  apiVersion?: string;
  timeoutMs: number;
  retryAttempts: number;
  customHeaders: CustomHeader[];
  endpoints: Record<string, string>;
  environment: string;
  isEnabled: boolean;
  credentials: IntegrationCredentials;
}

export interface HttpRequestOptions {
  method?: HttpMethod;
  /** Endpoint key (looked up in endpoints map) or absolute/relative path. */
  path?: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  jsonBody?: unknown;
  formBody?: Record<string, string>;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Per-request retry override. */
  retryAttempts?: number;
  /** Max response body size in bytes (default: 5 MB). */
  maxResponseBytes?: number;
  /** If true, persist a compact log entry (default: false — console only). */
  persistLog?: boolean;
}

export type ErrorClass =
  | "authentication_error"
  | "authorization_error"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "server_error"
  | "validation_error"
  | "unknown_error";

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: string;
  retryAfterMs?: number;
}

export interface StandardResponse<T = unknown> {
  success: boolean;
  status: number;
  latencyMs: number;
  headers: Record<string, string>;
  body: T | null;
  error: { class: ErrorClass; message: string } | null;
  retryCount: number;
  rateLimit?: RateLimitInfo;
  meta: {
    integrationId: string;
    method: HttpMethod;
    url: string;
    at: string;
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
