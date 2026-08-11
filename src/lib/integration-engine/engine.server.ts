// The Integration Engine. Public entry point for provider-agnostic
// HTTP calls against a managed integration. Provider adapters (future
// phases) should compose this — never bypass it.

import { loadIntegrationConfig } from "./config-loader.server";
import { runHealthCheck } from "./health-check.server";
import { executeRequest } from "./http-client.server";
import { validateConfig } from "./validators.server";
import { IntegrationEngine, type IntegrationEngineRuntime } from "./engine";

export { IntegrationEngine } from "./engine";

const serverRuntime: IntegrationEngineRuntime = {
  validate: validateConfig,
  request: executeRequest,
  healthCheck: runHealthCheck,
};

/** TanStack/server composition only; Edge callers use IntegrationEngine.fromConfig. */
export async function createServerIntegrationEngine(integrationId: string): Promise<IntegrationEngine> {
  return IntegrationEngine.fromConfig(await loadIntegrationConfig(integrationId), serverRuntime);
}
