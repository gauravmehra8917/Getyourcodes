// Phase 2D.3 — Sync execution bridge: Adapter → SyncEngine → ImportPipeline.
// Admin-only. All server-only modules are imported inside handlers.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  emptySyncRunReport,
  projectImport,
  projectSync,
  type LifecycleSummary,
  type SyncRunReport,
} from "@/lib/sync/SyncRunReport";
export type {
  IdentityDiagnostics,
  IdentitySummaryRow,
  LifecycleDiagnostic,
  LifecycleSummary,
  LogoSyncSummaryRow,
  PresentationRow,
  ReportIssue,
  SyncRunReport,
} from "@/lib/sync/SyncRunReport";

export interface ImportRunRow {
  id: string;
  provider: string;
  preview: boolean;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  success: boolean;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  validation_errors: number;
  warnings: number;
  error_message: string | null;
  policy_name: string | null;
  records_held: number;
  import_strategy: string;
  pages_crawled: number;
  api_calls_used: number;
  records_fetched: number;
  new_provider_identities: number;
  existing_provider_identities: number;
  stop_reason: string | null;
  statistics: { lifecycle?: LifecycleSummary | null } | null;
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
        maxApiCalls: z.number().int().positive().max(2000).optional(),
        consecutiveNoNewPages: z.number().int().positive().max(100).optional(),
        strategy: z.enum(["incremental", "discover_new_offers", "refresh_existing_only", "full_sync"]).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);

    const startedAt = Date.now();
    const { SyncEngine } = await import("@/lib/sync");
    const { runImport } = await import("@/lib/import");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const report: SyncRunReport = emptySyncRunReport(data.integrationId, data.preview);

    try {
      const { data: integration, error: integrationError } = await (supabaseAdmin as any)
        .from("affiliate_integrations")
        .select("provider_name, provider_type, orchestration_strategy, orchestration_page_size, orchestration_max_pages, orchestration_max_api_calls, orchestration_no_new_pages")
        .eq("id", data.integrationId).single();
      if (integrationError || !integration) throw new Error(integrationError?.message ?? "Integration not found");
      const { loadExistingProviderOfferIds } = await import("@/lib/sync/ProviderIdentityIndex.server");
      const { resolveProviderKey } = await import("@/lib/providers/ProviderFactory");
      const existingProviderOfferIds = await loadExistingProviderOfferIds(resolveProviderKey(integration));
      const engine = await SyncEngine.forIntegration(data.integrationId, {
        entityTypes: data.entityTypes,
        pageSize: data.pageSize ?? integration.orchestration_page_size,
        maxPages: data.maxPages ?? integration.orchestration_max_pages,
        maxApiCalls: data.maxApiCalls ?? integration.orchestration_max_api_calls,
        consecutiveNoNewPages: data.consecutiveNoNewPages ?? integration.orchestration_no_new_pages,
        strategy: data.strategy ?? integration.orchestration_strategy,
        existingProviderOfferIds,
      });
      const synced = await engine.run();
      const sync = synced.body;
      if (!sync) throw new Error(synced.error?.message ?? "Sync produced no result");

      projectSync(report, sync);

      // Publishing Policy Engine: resolve the policy for this integration and
      // hand it to the import pipeline (applied after dedupe, before writes).
      const { loadPolicyForIntegration, loadPolicyContext, saveRotationState } = await import(
        "@/lib/publishing-policy/PolicyLoader.server"
      );
      let policy = null as Awaited<ReturnType<typeof loadPolicyForIntegration>> | null;
      let policyContext = {};
      try {
        policy = await loadPolicyForIntegration(data.integrationId);
        policyContext = await loadPolicyContext(policy, sync.provider);
      } catch (err) {
        report.syncWarnings.push(
          `[policy] could not load publishing policy: ${err instanceof Error ? err.message : String(err)}`,
        );
        policy = null;
      }

      const imported = await runImport(sync, {
        preview: data.preview,
        ...(policy ? { policy, policyContext } : {}),
      });
      const body = imported.body;
      if (body) {
        projectImport(report, sync, body);
        if (policy && !data.preview && body.committed) {
          await saveRotationState(policy, sync.provider, body.rotationCursors);
        }
        report.messages = body.warnings;
      }
      if (!imported.success) report.error = imported.error?.message ?? "Import failed";

      // Phase 3A: after a committed import, cache merchant logos in storage.
      // Failures here never fail the import.
      if (!data.preview && report.committed) {
        try {
          const { syncStoreLogosForProvider } = await import("@/lib/presentation/logo-sync.server");
          report.logos = await syncStoreLogosForProvider(report.provider, data.integrationId);
        } catch (err) {
          report.logos = {
            processed: 0,
            downloaded: 0,
            skipped: 0,
            failed: 0,
            errors: [err instanceof Error ? err.message : String(err)],
          };
        }

        // Verification report: how much imported content is actually populated.
        try {
          const countOf = async (
            table: "stores" | "coupons",
            build: (q: any) => any,
          ): Promise<number> => {
            const base = (supabaseAdmin as any)
              .from(table)
              .select("id", { count: "exact", head: true })
              .eq("provider", report.provider);
            const { count } = await build(base);
            return count ?? 0;
          };

          report.coverage = {
            stores: await countOf("stores", (q) => q),
            storesWithHostedLogo: await countOf("stores", (q) =>
              q.like("logo_url", "%/storage/v1/object/public/store-logos/%"),
            ),
            offers: await countOf("coupons", (q) => q),
            offersWithDescription: await countOf("coupons", (q) => q.not("description", "is", null)),
            offersWithTerms: await countOf("coupons", (q) => q.not("terms", "is", null)),
          };
        } catch {
          report.coverage = null;
        }
      }

    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
    }

    report.durationMs = Date.now() - startedAt;

    // A preview is a strictly read-only operation. Committed runs retain the
    // existing history record, but preview reports are returned directly.
    if (!data.preview) {
      const stats = report.statistics;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseAdmin as any).from("affiliate_import_runs").insert({
          integration_id: data.integrationId,
          provider: report.provider,
          preview: false,
          finished_at: new Date().toISOString(),
          duration_ms: report.durationMs,
          success: !report.error,
          records_processed: stats?.validated ?? 0,
          records_created: stats?.created ?? 0,
          records_updated: stats?.updated ?? 0,
          records_skipped: stats?.skipped ?? 0,
          validation_errors: stats?.validationFailures ?? 0,
          warnings: report.messages.length,
          error_message: report.error,
          statistics: { ...(stats ?? {}), lifecycle: report.lifecycle },
          policy_id: report.publishing?.policyId ?? null,
          policy_name: report.publishing?.policyName ?? null,
          records_held: (report.publishing?.couponsHeld ?? 0) + (report.publishing?.dealsHeld ?? 0),
          publishing_summary: report.publishing ?? null,
          import_strategy: report.orchestration?.strategy ?? "incremental",
          pages_crawled: report.orchestration?.pagesCrawled ?? 0,
          api_calls_used: report.orchestration?.apiCallsUsed ?? 0,
          records_fetched: report.orchestration?.recordsFetched ?? 0,
          new_provider_identities: report.orchestration?.newProviderIdentitiesDiscovered ?? 0,
          existing_provider_identities: report.orchestration?.existingProviderIdentitiesEncountered ?? 0,
          stop_reason: report.orchestration?.stopReason,
          triggered_by: ctx.userId,
        });
      } catch {
        // history logging must never break the run
      }
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
        "id, provider, preview, started_at, finished_at, duration_ms, success, records_processed, records_created, records_updated, records_skipped, validation_errors, warnings, error_message, policy_name, records_held, import_strategy, pages_crawled, api_calls_used, records_fetched, new_provider_identities, existing_provider_identities, stop_reason, statistics",
      )
      .eq("integration_id", data.integrationId)
      .order("started_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ImportRunRow[];
  });
