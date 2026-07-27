// Public server-only entry point for the Integration Engine.
// Provider adapters (future phases) should import from this module.
//
// Filename ends in .server.ts so Vite refuses to bundle it into the
// client — credentials never reach the browser.

export type {
  AuthenticationType,
  CustomHeader,
  ErrorClass,
  HttpMethod,
  HttpRequestOptions,
  IntegrationConfig,
  IntegrationCredentials,
  RateLimitInfo,
  StandardResponse,
  ValidationResult,
} from "./types";

export { IntegrationEngine } from "./engine.server";
export { loadIntegrationConfig } from "./config-loader.server";
export { validateConfig } from "./validators.server";
export { runHealthCheck } from "./health-check.server";
export { executeRequest } from "./http-client.server";
export { applyAuthentication } from "./authentication.server";
export { buildRequest } from "./request-builder.server";
export { shouldRetry, sleep } from "./retry-engine.server";
export {
  buildStandardResponse,
  classifyStatus,
  extractRateLimit,
  headersToObject,
} from "./response-handler.server";
export { logRequest, redactHeaders, redactUrl } from "./logger.server";
export {
  validateIntegration,
  simulateRequest,
  simulateTimeout,
  simulateRateLimit,
  simulateAuthFailure,
} from "./testing.server";

export { buildVariableMap, resolvePlaceholders, variableMapForConfig } from "./placeholders.server";
