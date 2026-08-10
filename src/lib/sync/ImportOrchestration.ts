// Provider-neutral pagination and identity-discovery policy. This module has
// no adapter, normalizer, database, or provider-specific knowledge.

export type ImportStrategy = "incremental" | "discover_new_offers" | "refresh_existing_only" | "full_sync";
export type ImportStopReason = "provider_end" | "max_pages" | "max_api_calls" | "consecutive_no_new" | "fetch_error";

export interface OrchestrationSettings {
  strategy?: ImportStrategy;
  pageSize?: number;
  /** Null means use the selected strategy's bounded default. */
  maxPages?: number | null;
  /** Null means use the selected strategy's total-call safety default. */
  maxApiCalls?: number | null;
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

/** The single source of truth for strategy-aware import limits. */
export const IMPORT_STRATEGY_DEFAULTS: Record<ImportStrategy, Pick<ResolvedOrchestrationSettings, "maxPages" | "maxApiCalls">> = {
  incremental: { maxPages: 2, maxApiCalls: 8 },
  discover_new_offers: { maxPages: 10, maxApiCalls: 20 },
  refresh_existing_only: { maxPages: 10, maxApiCalls: 20 },
  full_sync: { maxPages: 50, maxApiCalls: 200 },
};

export function resolveOrchestrationSettings(settings: OrchestrationSettings = {}): ResolvedOrchestrationSettings {
  const strategy = settings.strategy ?? "incremental";
  const defaults = IMPORT_STRATEGY_DEFAULTS[strategy];
  return {
    strategy,
    pageSize: settings.pageSize ?? 100,
    maxPages: settings.maxPages ?? defaults.maxPages,
    maxApiCalls: settings.maxApiCalls ?? defaults.maxApiCalls,
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
