// Runtime-neutral provider resolution for the Impact preview path.  The
// application-side factory composes the remaining provider skeletons.

import { IntegrationEngine } from "../integration-engine/engine.ts";
import type { ProviderAdapter } from "./ProviderAdapter.ts";
import { ImpactAdapter } from "./adapters/ImpactAdapter.ts";

export type ProviderKey =
  | "impact"
  | "cj"
  | "awin"
  | "rakuten"
  | "shareasale"
  | "custom_rest";

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
    .map((value) => (value ?? "").toString().trim().toLowerCase())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (candidate in ALIASES) return ALIASES[candidate];
  }
  return "custom_rest";
}

/** The Edge preview intentionally exposes only the implemented Impact adapter. */
export class ProviderFactory {
  static fromEngine(engine: IntegrationEngine): ProviderAdapter {
    const config = engine.getConfig();
    const key = resolveProviderKey({
      provider_name: config.providerName,
      provider_type: config.providerType,
    });
    if (key !== "impact") {
      throw new Error(`Provider "${key}" is not available in the Edge preview core`);
    }
    return new ImpactAdapter(engine);
  }

  static supportedProviders(): ProviderKey[] {
    return ["impact"];
  }
}
