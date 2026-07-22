// Provider Factory. The only entry point the rest of the app should
// use to obtain a ProviderAdapter. Registering a new provider means:
//   1. Add its skeleton in ./adapters/
//   2. Register it below
// Nothing else in the app needs to change.

import { IntegrationEngine } from "@/lib/integration-engine/engine.server";
import type { BaseProviderAdapter } from "./BaseProviderAdapter";
import type { ProviderAdapter } from "./ProviderAdapter";

import { ImpactAdapter } from "./adapters/ImpactAdapter";
import { CJAdapter } from "./adapters/CJAdapter";
import { AwinAdapter } from "./adapters/AwinAdapter";
import { RakutenAdapter } from "./adapters/RakutenAdapter";
import { ShareASaleAdapter } from "./adapters/ShareASaleAdapter";
import { CustomRestAdapter } from "./adapters/CustomRestAdapter";

export type ProviderKey =
  | "impact"
  | "cj"
  | "awin"
  | "rakuten"
  | "shareasale"
  | "custom_rest";

type AdapterCtor = new (engine: IntegrationEngine) => BaseProviderAdapter;

const REGISTRY: Record<ProviderKey, AdapterCtor> = {
  impact: ImpactAdapter,
  cj: CJAdapter,
  awin: AwinAdapter,
  rakuten: RakutenAdapter,
  shareasale: ShareASaleAdapter,
  custom_rest: CustomRestAdapter,
};

/** Aliases for values that may appear in provider_name / provider_type. */
const ALIASES: Record<string, ProviderKey> = {
  impact: "impact",
  "impact.com": "impact",
  "impact radius": "impact",
  cj: "cj",
  "cj affiliate": "cj",
  "commission junction": "cj",
  awin: "awin",
  "awin.com": "awin",
  rakuten: "rakuten",
  "rakuten advertising": "rakuten",
  "rakuten linkshare": "rakuten",
  shareasale: "shareasale",
  "share a sale": "shareasale",
  "share-a-sale": "shareasale",
};

export function resolveProviderKey(input: {
  provider_name?: string | null;
  provider_type?: string | null;
}): ProviderKey {
  const candidates = [input.provider_name, input.provider_type]
    .map((v) => (v ?? "").toString().trim().toLowerCase())
    .filter(Boolean);
  for (const c of candidates) {
    if (c in REGISTRY) return c as ProviderKey;
    if (c in ALIASES) return ALIASES[c];
  }
  return "custom_rest";
}

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

  /** Build an adapter for a saved integration id. Initializes before return. */
  static async forIntegration(integrationId: string): Promise<ProviderAdapter> {
    const engine = await IntegrationEngine.forIntegration(integrationId);
    const adapter = ProviderFactory.fromEngine(engine);
    await adapter.initialize();
    return adapter;
  }

  /** List every provider key the factory can build. */
  static supportedProviders(): ProviderKey[] {
    return Object.keys(REGISTRY) as ProviderKey[];
  }
}
