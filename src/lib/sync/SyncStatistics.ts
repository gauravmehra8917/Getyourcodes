// Aggregate counters for a sync run.

import type { SyncEntityType } from "./SyncOptions";

export interface EntityStatistics {
  entity: SyncEntityType;
  requests: number;
  pages: number;
  fetched: number;
  normalized: number;
  skipped: number;
  durationMs: number;
  failed: boolean;
}

export interface SyncStatistics {
  provider: string;
  integrationId: string;
  storesFetched: number;
  couponsFetched: number;
  dealsFetched: number;
  categoriesFetched: number;
  totalRequests: number;
  totalPages: number;
  totalRecords: number;
  totalNormalized: number;
  totalSkipped: number;
  durationMs: number;
  perEntity: EntityStatistics[];
}

export function emptyStatistics(provider: string, integrationId: string): SyncStatistics {
  return {
    provider,
    integrationId,
    storesFetched: 0,
    couponsFetched: 0,
    dealsFetched: 0,
    categoriesFetched: 0,
    totalRequests: 0,
    totalPages: 0,
    totalRecords: 0,
    totalNormalized: 0,
    totalSkipped: 0,
    durationMs: 0,
    perEntity: [],
  };
}

const FIELD: Record<SyncEntityType, keyof SyncStatistics> = {
  store: "storesFetched",
  coupon: "couponsFetched",
  deal: "dealsFetched",
  category: "categoriesFetched",
};

export function applyEntityStats(stats: SyncStatistics, entry: EntityStatistics): SyncStatistics {
  const key = FIELD[entry.entity];
  (stats[key] as number) += entry.fetched;
  stats.totalRequests += entry.requests;
  stats.totalPages += entry.pages;
  stats.totalRecords += entry.fetched;
  stats.totalNormalized += entry.normalized;
  stats.totalSkipped += entry.skipped;
  stats.perEntity.push(entry);
  return stats;
}
