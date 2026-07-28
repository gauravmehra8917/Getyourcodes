// Public entry point for the Import Pipeline (Phase 2D.2).
// Consumes a SyncResult, produces an ImportPlan and an ImportResult.

export { ImportPipeline, runImport, type ImportOptions } from "./ImportPipeline";
export { ImportPlanner, planImport, type ExistingData, type PlannerCounters } from "./ImportPlanner";
export { ImportExecutor, buildPayload, executePlan, type ExecutionOutcome } from "./ImportExecutor";
export { ImportValidator, type ValidationOutcome } from "./ImportValidator";
export { DuplicateResolver, dedupe, type DedupeOutcome } from "./DuplicateResolver";
export { EntityMatcher, buildSnapshot, type ExistingRow, type ExistingSnapshot } from "./EntityMatcher";
export { SlugGenerator, slugify } from "./SlugGenerator";
export {
  emptyPlan,
  planTotals,
  type ImportPlan,
  type ImportIssue,
  type ImportAction,
  type ImportEntityKind,
  type PlannedRecord,
} from "./ImportPlan";
export type { ImportResult } from "./ImportResult";
export {
  emptyImportStatistics,
  type ImportStatistics,
} from "./ImportStatistics";
export { logImportEntity, logImportSummary, type ImportEntityLog } from "./ImportLogger";
