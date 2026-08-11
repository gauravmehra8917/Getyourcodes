import type { IntegrationConfig, ValidationResult } from "./types";

export function validateConfig(config: IntegrationConfig): ValidationResult {
  const errors: string[] = [];
  if (!config.isEnabled) errors.push("Integration is disabled");
  if (!config.baseUrl) errors.push("Base URL is required");
  else { try { new URL(config.baseUrl); } catch { errors.push("Base URL is invalid"); } }
  if (!config.timeoutMs || config.timeoutMs < 1000 || config.timeoutMs > 600_000) errors.push("Timeout must be between 1000 and 600000 ms");
  if (config.retryAttempts < 0 || config.retryAttempts > 20) errors.push("Retry attempts must be between 0 and 20");
  const credentials = config.credentials;
  if (config.authenticationType === "api_key" && !credentials.apiKey) errors.push("API key credential is missing");
  if (config.authenticationType === "bearer" && !credentials.accessToken) errors.push("Bearer access token is missing");
  if (config.authenticationType === "basic" && !credentials.username && !credentials.password) errors.push("Basic auth username/password is missing");
  if (config.authenticationType === "oauth2" && !credentials.accessToken && !(credentials.clientId && credentials.clientSecret)) errors.push("OAuth2 requires either an access token or client credentials");
  if (!(["api_key", "bearer", "basic", "oauth2", "custom_headers"] as string[]).includes(config.authenticationType)) errors.push("Unknown authentication type");
  return { ok: errors.length === 0, errors };
}
