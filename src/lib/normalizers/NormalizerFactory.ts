// Normalizer factory. Mirrors ProviderFactory's alias resolution so callers
// can go from an integration/provider name straight to a Normalizer.

import { resolveProviderKey, type ProviderKey } from "@/lib/providers/ProviderFactory";
import type { Normalizer } from "./Normalizer";
import { ImpactNormalizer } from "./impact/ImpactNormalizer";

type NormalizerCtor = new () => Normalizer;

/** Providers with a real normalizer. Others resolve to `null` until built. */
const REGISTRY: Partial<Record<ProviderKey, NormalizerCtor>> = {
  impact: ImpactNormalizer,
};

export class NormalizerFactory {
  /** Resolve by provider metadata (provider_name / provider_type). */
  static for(input: { provider_name?: string | null; provider_type?: string | null }): Normalizer | null {
    return NormalizerFactory.forKey(resolveProviderKey(input));
  }

  /** Resolve by canonical provider key. */
  static forKey(key: ProviderKey): Normalizer | null {
    const Ctor = REGISTRY[key];
    return Ctor ? new Ctor() : null;
  }

  static supportedProviders(): ProviderKey[] {
    return Object.keys(REGISTRY) as ProviderKey[];
  }
}
