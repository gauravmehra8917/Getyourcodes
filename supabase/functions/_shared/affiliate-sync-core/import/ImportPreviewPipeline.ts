// Read-only import preparation shared by every preview runtime.
//
// This module deliberately contains no database client, executor, SQL RPC, or
// logging dependency. Callers must provide the already-read import inputs.

import type { StandardResponse } from "../integration-engine/types.ts";
import type { SyncResult } from "../sync/SyncResult.ts";
import { applyPublishingPolicy } from "../publishing-policy/PolicyEngine.ts";
import type { PolicyContext, PublishingPolicy, PublishingSummary } from "../publishing-policy/types.ts";
import { buildIdentityDiagnostics, type IdentityDiagnostics } from "./IdentityDiagnostics.ts";
import { emptyImportStatistics } from "./ImportStatistics.ts";
import { ImportPlanner, type ExistingData } from "./ImportPlanner.ts";
import { planTotals, type ImportPlan, type PlannedRecord } from "./ImportPlan.ts";
import type { CanonicalCoupon, CanonicalDeal } from "../normalizers/types.ts";
import type { ImportResult } from "./ImportResult.ts";
import { planStoreLifecycle } from "./StoreLifecyclePlanner.ts";
import { qualifyStores } from "./StoreQualification.ts";

export interface PrepareImportOptions {
  /** Existing rows are supplied by the calling runtime through a read-only boundary. */
  existing: ExistingData;
  policy?: PublishingPolicy;
  policyContext?: PolicyContext;
  /** Preview diagnostics are intentionally absent from a committing preparation. */
  preview: boolean;
  /** Warnings produced while a host loaded read-only inputs. */
  inputWarnings?: string[];
  startedAt?: string;
  startedAtMs?: number;
}

export interface PreparedImport {
  result: ImportResult;
  totals: ReturnType<typeof planTotals>;
}

/**
 * Runs the shared validation → policy → qualification → lifecycle planning
 * stages. It has no persistence capability; committing hosts decide whether
 * and how to execute the returned plan.
 */
export function prepareImport(
  sync: SyncResult,
  options: PrepareImportOptions,
): PreparedImport {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const started = options.startedAtMs ?? Date.now();
  const statistics = emptyImportStatistics(sync.provider, sync.integrationId);
  const warnings = [...(options.inputWarnings ?? [])];
  const errors: string[] = [];

  const planned = ImportPlanner.planImport(sync, options.existing);
  let plan: ImportPlan = planned.plan;
  statistics.validated = planned.counters.validated;
  statistics.validationFailures = planned.counters.validationFailures;
  statistics.duplicates = planned.counters.duplicates;
  statistics.skipped = plan.skipped.length + planned.counters.duplicates;

  if (plan.validationErrors.length) {
    warnings.push(`${plan.validationErrors.length} record(s) failed validation and were excluded`);
  }
  if (plan.skipped.length) warnings.push(`${plan.skipped.length} record(s) skipped`);

  let publishing: PublishingSummary | null = null;
  let identityDiagnostics: IdentityDiagnostics | null = null;
  let rotationCursors: Record<string, number> = {};

  // The diagnostic observes normalized offers before policy and never persists.
  if (options.preview) identityDiagnostics = buildIdentityDiagnostics(sync.coupons, sync.deals);

  if (options.policy) {
    const outcome = applyPublishingPolicy(plan, options.policy, options.policyContext ?? {});
    plan = outcome.plan;
    publishing = outcome.summary;
    rotationCursors = outcome.rotationCursors;
    const qualifications = qualifyStores(
      outcome.eligibleCoupons as PlannedRecord<CanonicalCoupon>[],
      outcome.eligibleDeals as PlannedRecord<CanonicalDeal>[],
      outcome.selectedCoupons as PlannedRecord<CanonicalCoupon>[],
      outcome.selectedDeals as PlannedRecord<CanonicalDeal>[],
      options.policy,
    );
    const lifecycle = planStoreLifecycle(plan.storeCandidates, qualifications);
    plan = {
      ...plan,
      storeLifecycle: lifecycle.decisions,
      storeLifecycleStatistics: lifecycle.statistics,
    };
    const heldTotal = publishing.couponsHeld + publishing.dealsHeld;
    if (heldTotal > 0) {
      warnings.push(`${heldTotal} offer(s) held back by publishing policy "${publishing.policyName}"`);
    }
    statistics.skipped += heldTotal;
  }

  // Preparation is never a committed mutation. A committing caller updates
  // these fields only after its transaction succeeds.
  statistics.created = 0;
  statistics.updated = 0;
  statistics.durationMs = Date.now() - started;

  return {
    totals: planTotals(plan),
    result: {
      provider: sync.provider,
      integrationId: sync.integrationId,
      preview: options.preview,
      committed: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      plan,
      statistics,
      publishing,
      identityDiagnostics,
      rotationCursors,
      warnings,
      errors,
    },
  };
}

export interface PrepareImportPreviewOptions {
  existing: ExistingData;
  policy?: PublishingPolicy;
  policyContext?: PolicyContext;
  inputWarnings?: string[];
  /** Hosts may include read-model loading time in the reported preview duration. */
  startedAt?: string;
  startedAtMs?: number;
}

/** Strictly read-only entry point for TanStack and future Edge previews. */
export function prepareImportPreview(
  sync: SyncResult,
  options: PrepareImportPreviewOptions,
): StandardResponse<ImportResult> {
  const prepared = prepareImport(sync, { ...options, preview: true });
  const result = prepared.result;
  return {
    success: true,
    status: 200,
    latencyMs: result.statistics.durationMs,
    headers: {},
    body: result,
    error: null,
    retryCount: 0,
    meta: {
      integrationId: sync.integrationId,
      method: "POST",
      url: `import://${sync.provider}`,
      at: new Date().toISOString(),
    },
  };
}
