// Pre-flight validators. Ensures an integration is safe to invoke
// before the HTTP client makes any request.

import type { IntegrationConfig, ValidationResult } from "./types";

export function validateConfig(config: IntegrationConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.isEnabled) errors.push("Integration is disabled");

  if (!config.baseUrl) errors.push("Base URL is required");
  else {
    try { new URL(config.baseUrl); } catch { errors.push("Base URL is invalid"); }
  }

  if (!config.timeoutMs || config.timeoutMs < 1000 || config.timeoutMs > 600_000) {
    errors.push("Timeout must be between 1000 and 600000 ms");
  }

  if (config.retryAttempts < 0 || config.retryAttempts > 20) {
    errors.push("Retry attempts must be between 0 and 20");
  }

  const c = config.credentials;
  switch (config.authenticationType) {
    case "api_key":
      if (!c.apiKey) errors.push("API key credential is missing");
      break;
    case "bearer":
      if (!c.accessToken) errors.push("Bearer access token is missing");
      break;
    case "basic":
      if (!c.username && !c.password) errors.push("Basic auth username/password is missing");
      break;
    case "oauth2":
      if (!c.accessToken && !(c.clientId && c.clientSecret)) {
        errors.push("OAuth2 requires either an access token or client credentials");
      }
      break;
    case "custom_headers":
      // headers-only: nothing extra to require here
      break;
    default:
      errors.push("Unknown authentication type");
  }

  return { ok: errors.length === 0, errors };
}
