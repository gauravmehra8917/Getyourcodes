// Provider-neutral pagination and identity-discovery policy. This module has
// no adapter, normalizer, database, or provider-specific knowledge.

export type ImportStrategy = "incremental" | "discover_new_offers" | "refresh_existing_only" | "full_sync";
export type ImportStopReason = "provider_end" | "max_pages" | "max_api_calls" | "consecutive_no_new" | "fetch_error";

export interface OrchestrationSettings {
  strategy?: ImportStrategy;
  pageSize?: number;
  maxPages?: number;
  maxApiCalls?: number;
  consecutiveNoNewPages?: number;
}

export interface ResolvedOrchestrationSettings {
  strategy: ImportStrategy;
  pageSize: number;
  maxPages: number;
  maxApiCalls: number;
  consecutiveNoNewPages: number;
}

export interface DiscoveryCounters {
  newProviderIdentities: number;
  existingProviderIdentities: number;
}

export function resolveOrchestrationSettings(settings: OrchestrationSettings = {}): ResolvedOrchestrationSettings {
  const strategy = settings.strategy ?? "incremental";
  return {
    strategy,
    pageSize: settings.pageSize ?? 100,
    // Preserve the prior admin-run behaviour unless a Full Sync is requested.
    maxPages: settings.maxPages ?? (strategy === "full_sync" ? 50 : 2),
    maxApiCalls: settings.maxApiCalls ?? (strategy === "full_sync" ? 200 : 8),
    consecutiveNoNewPages: settings.consecutiveNoNewPages ?? 2,
  };
}

export function classifyOfferIdentities(
  identities: Iterable<string>,
  existing: ReadonlySet<string>,
  seen: Set<string>,
): DiscoveryCounters {
  let newProviderIdentities = 0;
  let existingProviderIdentities = 0;
  for (const identity of identities) {
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    if (existing.has(identity)) existingProviderIdentities += 1;
    else newProviderIdentities += 1;
  }
  return { newProviderIdentities, existingProviderIdentities };
}

export function shouldPersistOffer(strategy: ImportStrategy, isExisting: boolean): boolean {
  if (strategy === "discover_new_offers") return !isExisting;
  if (strategy === "refresh_existing_only") return isExisting;
  return true;
}
