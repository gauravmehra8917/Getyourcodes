// TanStack/server-only provider composition.

import { createServerIntegrationEngine } from "@/lib/integration-engine/engine.server";
import { ProviderFactory as RuntimeProviderFactory } from "./ProviderFactory";
import type { ProviderAdapter } from "./ProviderAdapter";

export { resolveProviderKey, type ProviderKey } from "./ProviderFactory";

export class ProviderFactory extends RuntimeProviderFactory {
  static async forIntegration(integrationId: string): Promise<ProviderAdapter> {
    const adapter = RuntimeProviderFactory.fromEngine(await createServerIntegrationEngine(integrationId));
    await adapter.initialize();
    return adapter;
  }
}
