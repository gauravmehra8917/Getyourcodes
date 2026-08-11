// Import Pipeline — consumes only a SyncResult and produces an ImportResult.
// It never talks to provider adapters or the integration engine.

import type { SyncResult } from "@/lib/sync";
import type { ExistingRow } from "./EntityMatcher";
import { hasPlanWork } from "./ImportPlan";
import type { ExistingData } from "./ImportPlanner";
import type { ImportResult } from "./ImportResult";
import type { PolicyContext, PublishingPolicy } from "@/lib/publishing-policy";
import { prepareImport, prepareImportPreview, type PrepareImportPreviewOptions } from "./ImportPreviewPipeline";

export { prepareImportPreview, type PrepareImportPreviewOptions } from "./ImportPreviewPipeline";

export interface ImportOptions {
  /** Dry run: validate, detect duplicates, build the plan, write nothing. */
  preview?: boolean;
  /** Pre-loaded existing rows (mainly for tests); loaded from the DB otherwise. */
  existing?: ExistingData;
  /** Publishing policy applied after deduplication, before persistence. */
  policy?: PublishingPolicy;
  /** Rotation cursors, merchant priority and manual-disable hints. */
  policyContext?: PolicyContext;
}

async function loadExisting(provider: string): Promise<ExistingData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const [stores, categories, coupons] = await Promise.all([
    db.from("stores").select("id,slug,provider,provider_entity_id,lifecycle_managed,lifecycle_hidden"),
    db.from("categories").select("id,slug,provider,provider_entity_id"),
    db.from("coupons").select("id,provider,provider_entity_id").eq("provider", provider),
  ]);

  const map = (rows: Row[] | null | undefined): ExistingRow[] =>
    (rows ?? []).map((r) => ({
      id: String(r.id),
      slug: (r.slug as string | null) ?? null,
      providerEntityId: r.provider === provider ? ((r.provider_entity_id as string | null) ?? null) : null,
      lifecycleManaged: r.lifecycle_managed === true,
      lifecycleHidden: r.lifecycle_hidden === true,
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
): Promise<import("@/lib/integration-engine/types").StandardResponse<ImportResult>> {
  const preview = options.preview ?? false;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let existing: ExistingData = { stores: [], categories: [], coupons: [] };
  const inputWarnings: string[] = [];
  try {
    existing = options.existing ?? (await loadExisting(sync.provider));
  } catch (err) {
    inputWarnings.push(
      `could not load existing rows (${err instanceof Error ? err.message : String(err)}); planning as first import`,
    );
  }

  if (preview) {
    return prepareImportPreview(sync, {
      existing,
      policy: options.policy,
      policyContext: options.policyContext,
      inputWarnings,
      startedAt,
      startedAtMs: started,
    });
  }

  const prepared = prepareImport(sync, {
    existing,
    policy: options.policy,
    policyContext: options.policyContext,
    preview,
    inputWarnings,
    startedAt,
    startedAtMs: started,
  });
  const result = prepared.result;

  // ── Stage B: the ONLY difference between preview and run ──────────────────
  if (!hasPlanWork(result.plan)) {
    result.committed = true;
  } else {
    const txStarted = Date.now();
    try {
      // The executor is loaded only by committing imports. Preview preparation
      // has no import_apply dependency in either source or execution graph.
      const { ImportExecutor } = await import("./ImportExecutor");
      const outcome = await ImportExecutor.executePlan(result.plan);
      result.statistics.transactionMs = Date.now() - txStarted;
      if (outcome.error) {
        result.errors.push(outcome.error);
      } else {
        result.committed = true;
        result.statistics.created = outcome.created;
        result.statistics.updated = outcome.updated;
        result.statistics.skipped += outcome.skipped;
      }
    } catch (err) {
      result.statistics.transactionMs = Date.now() - txStarted;
      // persistence failure must never alter the plan or validation results
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  result.statistics.durationMs = Date.now() - started;
  result.finishedAt = new Date().toISOString();

  const { logImportSummary } = await import("./ImportLogger");
  logImportSummary({
    provider: sync.provider,
    integrationId: sync.integrationId,
    preview: false,
    committed: result.committed,
    validated: result.statistics.validated,
    invalid: result.statistics.validationFailures,
    duplicates: result.statistics.duplicates,
    planCreate: prepared.totals.creates,
    planUpdate: prepared.totals.updates,
    created: result.statistics.created,
    updated: result.statistics.updated,
    skipped: result.statistics.skipped,
    transactionMs: result.statistics.transactionMs,
    durationMs: result.statistics.durationMs,
  });

  const success = result.errors.length === 0;
  return {
    success,
    status: success ? 200 : 0,
    latencyMs: result.statistics.durationMs,
    headers: {},
    body: result,
    error: success ? null : { class: "unknown_error", message: result.errors[0] },
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
