// Phase 2D.3 — Sync execution bridge: Adapter → SyncEngine → ImportPipeline.
// Admin-only. All server-only modules are imported inside handlers.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ImportResult } from "@/lib/import/ImportResult";
import type { SyncProgress } from "@/lib/sync/SyncProgress";

export interface SyncRunReport {
  provider: string;
  integrationId: string;
  preview: boolean;
  committed: boolean;
  durationMs: number;
  syncErrors: string[];
  syncWarnings: string[];
  progress: SyncProgress | null;
  result: ImportResult | null;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden: admin only");
}

export const runProviderSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        integrationId: z.string().uuid(),
        preview: z.boolean().default(true),
        entityTypes: z.array(z.enum(["store", "coupon", "deal", "category"])).optional(),
        pageSize: z.number().int().positive().max(500).optional(),
        maxPages: z.number().int().positive().max(50).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }): Promise<SyncRunReport> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);

    const startedAt = Date.now();
    const { SyncEngine } = await import("@/lib/sync");
    const { runImport } = await import("@/lib/import");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const report: SyncRunReport = {
      provider: "unknown",
      integrationId: data.integrationId,
      preview: data.preview,
      committed: false,
      durationMs: 0,
      syncErrors: [],
      syncWarnings: [],
      progress: null,
      result: null,
      error: null,
    };

    try {
      const engine = await SyncEngine.forIntegration(data.integrationId, {
        entityTypes: data.entityTypes,
        pageSize: data.pageSize ?? 100,
        maxPages: data.maxPages ?? 2,
      });
      const synced = await engine.run();
      const sync = synced.body;
      if (!sync) throw new Error(synced.error?.message ?? "Sync produced no result");

      report.provider = sync.provider;
      report.progress = sync.progress;
      report.syncErrors = sync.errors.map((e) => `[${e.entity ?? "run"}] ${e.message}`);
      report.syncWarnings = sync.warnings.map((w) => `[${w.entity ?? "run"}] ${w.message}`);

      const imported = await runImport(sync, { preview: data.preview });
      report.result = imported.body ?? null;
      report.committed = imported.body?.committed ?? false;
      if (!imported.success) report.error = imported.error?.message ?? "Import failed";
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
    }

    report.durationMs = Date.now() - startedAt;

    const stats = report.result?.statistics;
    try {
      await supabaseAdmin.from("affiliate_import_runs").insert({
        integration_id: data.integrationId,
        provider: report.provider,
        preview: data.preview,
        finished_at: new Date().toISOString(),
        duration_ms: report.durationMs,
        success: !report.error,
        records_processed: stats?.validated ?? 0,
        records_created: stats?.created ?? 0,
        records_updated: stats?.updated ?? 0,
        records_skipped: stats?.skipped ?? 0,
        validation_errors: stats?.validationFailures ?? 0,
        warnings: report.result?.warnings.length ?? 0,
        error_message: report.error,
        statistics: (stats ?? {}) as unknown as Record<string, unknown>,
        triggered_by: ctx.userId,
      });
    } catch {
      // history logging must never break the run
    }

    return report;
  });

export const getImportHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ integrationId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { data: rows, error } = await ctx.supabase
      .from("affiliate_import_runs")
      .select(
        "id, provider, preview, started_at, finished_at, duration_ms, success, records_processed, records_created, records_updated, records_skipped, validation_errors, warnings, error_message",
      )
      .eq("integration_id", data.integrationId)
      .order("started_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
