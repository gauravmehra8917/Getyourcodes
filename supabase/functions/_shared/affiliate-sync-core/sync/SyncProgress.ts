// Monitoring-only progress snapshot. Never used for control flow.

import type { SyncEntityType } from "./SyncOptions.ts";

export type SyncStatus = "pending" | "running" | "completed" | "partial" | "failed";

export interface SyncProgress {
  provider: string;
  integrationId: string;
  currentEntity: SyncEntityType | null;
  currentPage: number;
  totalPages: number | null;
  recordsFetched: number;
  recordsNormalized: number;
  elapsedMs: number;
  status: SyncStatus;
}

export class SyncProgressTracker {
  private startedAt = Date.now();
  private state: SyncProgress;

  constructor(provider: string, integrationId: string) {
    this.state = {
      provider,
      integrationId,
      currentEntity: null,
      currentPage: 0,
      totalPages: null,
      recordsFetched: 0,
      recordsNormalized: 0,
      elapsedMs: 0,
      status: "pending",
    };
  }

  update(patch: Partial<SyncProgress>): SyncProgress {
    this.state = { ...this.state, ...patch, elapsedMs: Date.now() - this.startedAt };
    return this.state;
  }

  addRecords(fetched: number, normalized: number): SyncProgress {
    return this.update({
      recordsFetched: this.state.recordsFetched + fetched,
      recordsNormalized: this.state.recordsNormalized + normalized,
    });
  }

  snapshot(): SyncProgress {
    return { ...this.state, elapsedMs: Date.now() - this.startedAt };
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
