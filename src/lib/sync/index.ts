// Public entry point for the Provider Sync Engine (Phase 2D.1).
// Orchestration only: fetch → normalize → SyncResult. No persistence.

export { SyncEngine } from "./SyncEngine";
export { SyncContext, type SyncContextInit } from "./SyncContext";
export {
  ALL_SYNC_ENTITIES,
  resolveSyncOptions,
  type SyncEntityType,
  type SyncOptions,
  type ResolvedSyncOptions,
} from "./SyncOptions";
export { SyncProgressTracker, type SyncProgress, type SyncStatus } from "./SyncProgress";
export {
  emptyStatistics,
  applyEntityStats,
  type EntityStatistics,
  type SyncStatistics,
} from "./SyncStatistics";
export type { SyncResult, SyncIssue } from "./SyncResult";
export { logSyncPage, logSyncSummary, type SyncPageLog } from "./SyncLogger";
