// Import Pipeline — consumes only a SyncResult and produces an ImportResult.
// It never talks to provider adapters or the integration engine.

import type { StandardResponse } from "@/lib/integration-engine/types";
import type { SyncResult } from "@/lib/sync";
import type { ExistingRow } from "./EntityMatcher";
import { ImportExecutor } from "./ImportExecutor";
import { logImportSummary } from "./ImportLogger";
import { planTotals, type ImportPlan } from "./ImportPlan";
import { ImportPlanner, type ExistingData } from "./ImportPlanner";
import type { ImportResult } from "./ImportResult";
import { emptyImportStatistics } from "./ImportStatistics";

export interface ImportOptions {
  /** Dry run: validate, detect duplicates, build the plan, write nothing. */
  preview?: boolean;
  /** Pre-loaded existing rows (mainly for tests); loaded from the DB otherwise. */
  existing?: ExistingData;
}

async function loadExisting(provider: string): Promise<ExistingData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const [stores, categories, coupons] = await Promise.all([
    db.from("stores").select("id,slug,provider,provider_entity_id"),
    db.from("categories").select("id,slug,provider,provider_entity_id"),
    db.from("coupons").select("id,provider,provider_entity_id").eq("provider", provider),
  ]);

  const map = (rows: Row[] | null | undefined): ExistingRow[] =>
    (rows ?? []).map((r) => ({
      id: String(r.id),
      slug: (r.slug as string | null) ?? null,
      providerEntityId: r.provider === provider ? ((r.provider_entity_id as string | null) ?? null) : null,
    }));

  type Row = Record<string, unknown>;
  return {
    stores: map(stores.data),
    categories: map(categories.data),
    coupons: map(coupons.data),
  };
}

export async function runImport(
  sync: SyncResult,
  options: ImportOptions = {},
): Promise<StandardResponse<ImportResult>> {
  const preview = options.preview ?? false;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const statistics = emptyImportStatistics(sync.provider, sync.integrationId);

  const errors: string[] = [];
  const warnings: string[] = [];
  let plan: ImportPlan;
  let committed = false;

  // ── Stage A: identical for preview and run ────────────────────────────────
  // existing rows + planning + validation happen exactly once, the same way in
  // both modes. Nothing here may differ based on `preview`.
  let existing: ExistingData = { stores: [], categories: [], coupons: [] };
  try {
    existing = options.existing ?? (await loadExisting(sync.provider));
  } catch (err) {
    warnings.push(
      `could not load existing rows (${err instanceof Error ? err.message : String(err)}); planning as first import`,
    );
  }

  const planned = ImportPlanner.planImport(sync, existing);
  plan = planned.plan;
  statistics.validated = planned.counters.validated;
  statistics.validationFailures = planned.counters.validationFailures;
  statistics.duplicates = planned.counters.duplicates;
  statistics.skipped = plan.skipped.length + planned.counters.duplicates;

  if (plan.validationErrors.length) {
    warnings.push(`${plan.validationErrors.length} record(s) failed validation and were excluded`);
  }
  if (plan.skipped.length) {
    warnings.push(`${plan.skipped.length} record(s) skipped`);
  }

  const totals = planTotals(plan);

  // ── Stage B: the ONLY difference between preview and run ──────────────────
  if (preview) {
    statistics.created = 0;
    statistics.updated = 0;
  } else if (totals.creates + totals.updates === 0) {
    committed = true;
  } else {
    const txStarted = Date.now();
    try {
      const outcome = await ImportExecutor.executePlan(plan);
      statistics.transactionMs = Date.now() - txStarted;
      if (outcome.error) {
        errors.push(outcome.error);
      } else {
        committed = true;
        statistics.created = outcome.created;
        statistics.updated = outcome.updated;
        statistics.skipped += outcome.skipped;
      }
    } catch (err) {
      statistics.transactionMs = Date.now() - txStarted;
      // persistence failure must never alter the plan or validation results
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  statistics.durationMs = Date.now() - started;

  const result: ImportResult = {
    provider: sync.provider,
    integrationId: sync.integrationId,
    preview,
    committed,
    startedAt,
    finishedAt: new Date().toISOString(),
    plan,
    statistics,
    warnings,
    errors,
  };

  logImportSummary({
    provider: sync.provider,
    integrationId: sync.integrationId,
    preview,
    committed,
    validated: statistics.validated,
    invalid: statistics.validationFailures,
    duplicates: statistics.duplicates,
    planCreate: totals.creates,
    planUpdate: totals.updates,
    created: statistics.created,
    updated: statistics.updated,
    skipped: statistics.skipped,
    transactionMs: statistics.transactionMs,
    durationMs: statistics.durationMs,
  });

  const success = errors.length === 0;
  return {
    success,
    status: success ? 200 : 0,
    latencyMs: statistics.durationMs,
    headers: {},
    body: result,
    error: success ? null : { class: "unknown_error", message: errors[0] },
    retryCount: 0,
    meta: {
      integrationId: sync.integrationId,
      method: "POST",
      url: `import://${sync.provider}`,
      at: new Date().toISOString(),
    },
  };
}

export class ImportPipeline {
  static run = runImport;
}
