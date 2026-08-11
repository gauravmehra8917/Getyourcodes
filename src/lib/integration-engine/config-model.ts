// Runtime-neutral mapping of an already-read integration row and decrypted
// credentials. Loading/decryption stays in runtime-specific boundaries.

import type { AuthenticationType, CustomHeader, IntegrationConfig, IntegrationCredentials } from "./types";

export type IntegrationConfigRow = Record<string, unknown>;

export function mapIntegrationConfig(row: IntegrationConfigRow, credentials: IntegrationCredentials = {}): IntegrationConfig {
  return {
    id: String(row.id),
    name: String(row.integration_name),
    providerName: String(row.provider_name),
    providerType: String(row.provider_type),
    authenticationType: row.authentication_type as AuthenticationType,
    baseUrl: String(row.base_url),
    apiVersion: typeof row.api_version === "string" ? row.api_version : "",
    timeoutMs: Math.min(600_000, Math.max(1_000, (typeof row.timeout_seconds === "number" ? row.timeout_seconds : 30) * 1000)),
    retryAttempts: Math.max(0, Math.min(20, typeof row.retry_attempts === "number" ? row.retry_attempts : 0)),
    customHeaders: Array.isArray(row.custom_headers) ? row.custom_headers as CustomHeader[] : [],
    endpoints: row.endpoint_configuration && typeof row.endpoint_configuration === "object" ? row.endpoint_configuration as Record<string, string> : {},
    environment: typeof row.environment === "string" ? row.environment : "production",
    isEnabled: row.is_enabled === true,
    credentials,
  };
}
