// Configuration for a sync run. Provider-independent: no network-specific
// limits or endpoint knowledge lives here.

import type { EntityKind } from "@/lib/normalizers";
import type { ImportStrategy } from "./ImportOrchestration";

export type SyncEntityType = EntityKind;

export const ALL_SYNC_ENTITIES: SyncEntityType[] = ["store", "coupon", "deal", "category"];

export interface SyncOptions {
  /** Entities to sync. Defaults to all four. */
  entityTypes?: SyncEntityType[];
  /** Records requested per page. Passed straight to the adapter. */
  pageSize?: number;
  /** Hard cap on pages per entity. Undefined = until the provider runs dry. */
  maxPages?: number;
  /** Shared call budget across the whole sync run. */
  maxApiCalls?: number;
  /** Stop offer discovery after this many pages without a new immutable id. */
  consecutiveNoNewPages?: number;
  strategy?: ImportStrategy;
  /** Existing offer identities, normally loaded once by the server bridge. */
  existingProviderOfferIds?: Iterable<string>;
  /** First page number to request (default 1). */
  startPage?: number;
  /** Keep going after a failed page/entity instead of aborting (default true). */
  continueOnError?: boolean;
  /** Include the statistics block in the result (default true). */
  includeStatistics?: boolean;
  /** Extra provider-agnostic filters forwarded to the adapter's FetchOptions. */
  fetchParams?: Record<string, unknown>;
  /** Optional progress callback invoked after every page. */
  onProgress?: (progress: import("./SyncProgress").SyncProgress) => void;
}

export interface ResolvedSyncOptions {
  entityTypes: SyncEntityType[];
  pageSize?: number;
  maxPages?: number;
  maxApiCalls?: number;
  consecutiveNoNewPages: number;
  strategy: ImportStrategy;
  existingProviderOfferIds: Set<string>;
  startPage: number;
  continueOnError: boolean;
  includeStatistics: boolean;
  fetchParams: Record<string, unknown>;
  onProgress?: (progress: import("./SyncProgress").SyncProgress) => void;
}

export function resolveSyncOptions(opts?: SyncOptions): ResolvedSyncOptions {
  const entityTypes = opts?.entityTypes?.length ? [...opts.entityTypes] : [...ALL_SYNC_ENTITIES];
  return {
    entityTypes,
    pageSize: opts?.pageSize,
    maxPages: opts?.maxPages,
    maxApiCalls: opts?.maxApiCalls,
    consecutiveNoNewPages: opts?.consecutiveNoNewPages ?? 2,
    strategy: opts?.strategy ?? "incremental",
    existingProviderOfferIds: new Set(opts?.existingProviderOfferIds ?? []),
    startPage: opts?.startPage ?? 1,
    continueOnError: opts?.continueOnError ?? true,
    includeStatistics: opts?.includeStatistics ?? true,
    fetchParams: opts?.fetchParams ?? {},
    onProgress: opts?.onProgress,
  };
}
