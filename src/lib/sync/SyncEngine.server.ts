// TanStack/server-only SyncEngine composition.

import { NormalizerFactory } from "@/lib/normalizers";
import { ProviderFactory } from "@/lib/providers/index.server";
import type { SyncOptions } from "./SyncOptions";
import { SyncContext } from "./SyncContext";
import { SyncEngine } from "./SyncEngine";

export async function createServerSyncEngine(integrationId: string, options?: SyncOptions): Promise<SyncEngine> {
  const adapter = await ProviderFactory.forIntegration(integrationId);
  const config = adapter.getConfig();
  const normalizer = NormalizerFactory.for({ provider_name: config.providerName, provider_type: config.providerType });
  if (!normalizer) throw new Error(`No normalizer registered for provider "${config.providerName}"`);
  return new SyncEngine(new SyncContext({ adapter, normalizer, options }));
}
