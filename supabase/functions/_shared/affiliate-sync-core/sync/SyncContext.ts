// Everything a sync run needs, resolved once: adapter, normalizer, options,
// progress tracker and issue collectors. No provider knowledge.

import type { Normalizer } from "../normalizers/Normalizer.ts";
import type { ProviderAdapter } from "../providers/ProviderAdapter.ts";
import { resolveSyncOptions, type ResolvedSyncOptions, type SyncOptions } from "./SyncOptions.ts";
import { SyncProgressTracker } from "./SyncProgress.ts";
import type { SyncIssue } from "./SyncResult.ts";
import { emptyStatistics, type SyncStatistics } from "./SyncStatistics.ts";

export interface SyncContextInit {
  adapter: ProviderAdapter;
  normalizer: Normalizer;
  options?: SyncOptions;
}

export class SyncContext {
  readonly adapter: ProviderAdapter;
  readonly normalizer: Normalizer;
  readonly options: ResolvedSyncOptions;
  readonly progress: SyncProgressTracker;
  readonly statistics: SyncStatistics;
  readonly warnings: SyncIssue[] = [];
  readonly errors: SyncIssue[] = [];
  readonly startedAt = new Date().toISOString();

  constructor({ adapter, normalizer, options }: SyncContextInit) {
    this.adapter = adapter;
    this.normalizer = normalizer;
    this.options = resolveSyncOptions(options);

    const config = adapter.getConfig();
    this.progress = new SyncProgressTracker(adapter.providerKey, config.id);
    this.statistics = emptyStatistics(adapter.providerKey, config.id);
  }

  get integrationId(): string {
    return this.adapter.getConfig().id;
  }

  get provider(): string {
    return this.adapter.providerKey;
  }

  warn(issue: SyncIssue) {
    this.warnings.push(issue);
  }

  fail(issue: SyncIssue) {
    this.errors.push(issue);
  }

}
