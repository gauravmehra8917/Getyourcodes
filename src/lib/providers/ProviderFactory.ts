// Provider Factory. The only entry point the rest of the app should
// use to obtain a ProviderAdapter. Registering a new provider means:
//   1. Add its skeleton in ./adapters/
//   2. Register it below
// Nothing else in the app needs to change.

import { IntegrationEngine } from "@/lib/integration-engine/engine";
import type { BaseProviderAdapter } from "./BaseProviderAdapter";
import type { ProviderAdapter } from "./ProviderAdapter";

import { ImpactAdapter } from "./adapters/ImpactAdapter";
import { CJAdapter } from "./adapters/CJAdapter";
import { AwinAdapter } from "./adapters/AwinAdapter";
import { RakutenAdapter } from "./adapters/RakutenAdapter";
import { ShareASaleAdapter } from "./adapters/ShareASaleAdapter";
import { CustomRestAdapter } from "./adapters/CustomRestAdapter";

import {
  resolveProviderKey,
  type ProviderKey,
} from "../../../supabase/functions/_shared/affiliate-sync-core/providers/ProviderFactory";

export { resolveProviderKey, type ProviderKey };

type AdapterCtor = new (engine: IntegrationEngine) => BaseProviderAdapter;

const REGISTRY: Record<ProviderKey, AdapterCtor> = {
  impact: ImpactAdapter,
  cj: CJAdapter,
  awin: AwinAdapter,
  rakuten: RakutenAdapter,
  shareasale: ShareASaleAdapter,
  custom_rest: CustomRestAdapter,
};

export class ProviderFactory {
  /** Build an adapter directly for a preloaded IntegrationEngine. */
  static fromEngine(engine: IntegrationEngine): ProviderAdapter {
    const config = engine.getConfig();
    const key = resolveProviderKey({
      provider_name: config.providerName,
      provider_type: config.providerType,
    });
    const Ctor = REGISTRY[key];
    return new Ctor(engine);
  }

  /** List every provider key the factory can build. */
  static supportedProviders(): ProviderKey[] {
    return Object.keys(REGISTRY) as ProviderKey[];
  }
}
