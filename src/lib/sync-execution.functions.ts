// Phase 2D.3 — Sync execution bridge: Adapter → SyncEngine → ImportPipeline.
// Admin-only. All server-only modules are imported inside handlers.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  couponSeoDescription,
  couponSeoTitle,
  storeSeoDescription,
  storeSeoTitle,
} from "@/lib/presentation/seo-templates";

/** Quality preview of what a record will look like once published. */
export interface PresentationRow {
  entity: "store" | "coupon" | "deal";
  providerEntityId: string;
  name: string;
  seoTitle: string;
  seoDescription: string;
  logoStatus: "hosted" | "provider" | "missing";
  descriptionStatus: "present" | "missing";
  trackingSource: "ad" | "campaign" | "promotion" | "none";
  landingPageStatus: "present" | "missing";
}

export interface LogoSyncSummaryRow {
  processed: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}


export interface ReportIssue {
  entity: string;
  providerEntityId: string | null;
  field: string | null;
  reason: string;
  /** Affiliate network owning the identity. */
  provider?: string | null;
  /** How many records in the batch shared this provider identity. */
  occurrences?: number | null;
  /** Raw provider identifier (e.g. Impact PromotionIds). */
  rawProviderId?: string | null;
}

export interface IdentitySummaryRow {
  entity: string;
  fetched: number;
  uniqueIdentities: number;
  duplicateIdentities: number;
  duplicateRecords: number;
  toCreate: number;
  toUpdate: number;
}

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
}

export interface SyncRunReport {
  provider: string;
  integrationId: string;
  preview: boolean;
  committed: boolean;
  durationMs: number;
  syncErrors: string[];
  syncWarnings: string[];
  progress: {
    currentEntity: string | null;
    currentPage: number;
    recordsFetched: number;
    recordsNormalized: number;
    status: string;
  } | null;
  planCounts: {
    storesToCreate: number;
    storesToUpdate: number;
    couponsToCreate: number;
    couponsToUpdate: number;
    dealsToCreate: number;
    dealsToUpdate: number;
    categoriesToCreate: number;
    categoriesToUpdate: number;
    skipped: number;
  } | null;
  statistics: {
    validated: number;
    created: number;
    updated: number;
    skipped: number;
    validationFailures: number;
    duplicates: number;
    durationMs: number;
  } | null;
  /** Per-record validation failures — entity, provider id, field, reason. */
  validationErrors: ReportIssue[];
  /** Records skipped (e.g. unknown store reference). */
  skipped: ReportIssue[];
  /** Duplicate provider ids within the same batch. */
  conflicts: ReportIssue[];
  /** Provider-identity accounting per entity kind. */
  identity: IdentitySummaryRow[];
  /** Phase 3A: generated SEO + enrichment quality preview. */
  presentation: PresentationRow[];
  /** Merchant logo download summary (run mode only). */
  logos: LogoSyncSummaryRow | null;
  /** Post-import content coverage for this provider (run mode only). */
  coverage: {
    stores: number;
    storesWithHostedLogo: number;
    offers: number;
    offersWithDescription: number;
    offersWithTerms: number;
  } | null;
  /** Publishing Policy Engine outcome (held vs published). */
  publishing: import("@/lib/publishing-policy").PublishingSummary | null;
  messages: string[];
  error: string | null;

}

type PlanRecordLike = {
  providerEntityId: string;
  slug: string | null;
  source: {
    name?: string;
    title?: string;
    description?: string | null;
    logo?: string | null;
    trackingUrl?: string | null;
    providerAdvertiserId?: string | null;
    providerCampaignId?: string | null;
    providerStoreId?: string | null;
    metadata?: Record<string, unknown>;
  };
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function trackingSource(meta: Record<string, unknown>, trackingUrl: string | null): PresentationRow["trackingSource"] {
  if (!trackingUrl) return "none";
  const warning = str(meta.trackingUrlWarning)?.toLowerCase() ?? "";
  if (warning.includes("campaign")) return "campaign";
  if (str(meta.enrichmentAdId)) return "ad";
  return "promotion";
}

/** Builds the admin quality preview from the planned records. */
function buildPresentation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan: any,
  limit = 50,
): PresentationRow[] {
  const rows: PresentationRow[] = [];
  const storeNames = new Map<string, string>();

  const stores: PlanRecordLike[] = [...(plan.storesToCreate ?? []), ...(plan.storesToUpdate ?? [])];
  for (const r of stores) {
    const name = r.source.name ?? "";
    for (const key of [r.providerEntityId, r.source.providerAdvertiserId, r.source.providerCampaignId]) {
      if (key) storeNames.set(key, name);
    }
    const meta = r.source.metadata ?? {};
    const logo = str(r.source.logo);
    rows.push({
      entity: "store",
      providerEntityId: r.providerEntityId,
      name,
      seoTitle: storeSeoTitle(name),
      seoDescription: storeSeoDescription(name),
      logoStatus: logo ? (logo.includes("/storage/v1/object/public/") ? "hosted" : "provider") : "missing",
      descriptionStatus: str(r.source.description) ? "present" : "missing",
      trackingSource: str(meta.trackingLink) ? "campaign" : "none",
      landingPageStatus: str(meta.landingPageUrl) ? "present" : "missing",
    });
  }

  const promos: [PresentationRow["entity"], PlanRecordLike[]][] = [
    ["coupon", [...(plan.couponsToCreate ?? []), ...(plan.couponsToUpdate ?? [])]],
    ["deal", [...(plan.dealsToCreate ?? []), ...(plan.dealsToUpdate ?? [])]],
  ];
  for (const [entity, list] of promos) {
    for (const r of list) {
      const meta = r.source.metadata ?? {};
      const storeName =
        [r.source.providerAdvertiserId, r.source.providerStoreId, r.source.providerCampaignId]
          .map((k) => (k ? storeNames.get(k) : undefined))
          .find(Boolean) ??
        str(meta.advertiserName) ??
        "this store";
      const title = r.source.title ?? "";
      rows.push({
        entity,
        providerEntityId: r.providerEntityId,
        name: title,
        seoTitle: couponSeoTitle(title, storeName),
        seoDescription: couponSeoDescription(title, storeName),
        logoStatus: "missing",
        descriptionStatus: str(r.source.description) ? "present" : "missing",
        trackingSource: trackingSource(meta, str(r.source.trackingUrl)),
        landingPageStatus: str(meta.landingPageUrl) ? "present" : "missing",
      });
    }
  }

  return rows.slice(0, limit);
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

type RawIssue = {
  entity: string;
  providerEntityId: string | null;
  field?: string;
  reason: string;
  provider?: string;
  occurrences?: number;
  rawProviderId?: string | null;
};
const toIssues = (rows: RawIssue[] | undefined): ReportIssue[] =>
  (rows ?? []).map((i) => ({
    entity: i.entity,
    providerEntityId: i.providerEntityId ?? null,
    field: i.field ?? null,
    reason: i.reason,
    provider: i.provider ?? null,
    occurrences: i.occurrences ?? null,
    rawProviderId: i.rawProviderId ?? null,
  }));

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
  .handler(async ({ data, context }) => {
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
      planCounts: null,
      statistics: null,
      validationErrors: [],
      skipped: [],
      conflicts: [],
      identity: [],
      presentation: [],
      logos: null,
      coverage: null,
      publishing: null,

      messages: [],
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
      report.progress = {
        currentEntity: sync.progress.currentEntity,
        currentPage: sync.progress.currentPage,
        recordsFetched: sync.progress.recordsFetched,
        recordsNormalized: sync.progress.recordsNormalized,
        status: sync.progress.status,
      };
      report.syncErrors = sync.errors.map((e) => `[${e.entity ?? "run"}] ${e.message}`);
      report.syncWarnings = sync.warnings.map((w) => `[${w.entity ?? "run"}] ${w.message}`);

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
        const p = body.plan;
        report.committed = body.committed;
        report.planCounts = {
          storesToCreate: p.storesToCreate.length,
          storesToUpdate: p.storesToUpdate.length,
          couponsToCreate: p.couponsToCreate.length,
          couponsToUpdate: p.couponsToUpdate.length,
          dealsToCreate: p.dealsToCreate.length,
          dealsToUpdate: p.dealsToUpdate.length,
          categoriesToCreate: p.categoriesToCreate.length,
          categoriesToUpdate: p.categoriesToUpdate.length,
          skipped: p.skipped.length,
        };
        report.statistics = {
          validated: body.statistics.validated,
          created: body.statistics.created,
          updated: body.statistics.updated,
          skipped: body.statistics.skipped,
          validationFailures: body.statistics.validationFailures,
          duplicates: body.statistics.duplicates,
          durationMs: body.statistics.durationMs,
        };
        report.validationErrors = toIssues(p.validationErrors);
        report.skipped = toIssues(p.skipped);
        report.conflicts = toIssues(p.conflicts);
        report.identity = p.identity.map((row) => ({ ...row }));
        report.presentation = buildPresentation(p);
        report.publishing = body.publishing;
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

    const stats = report.statistics;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any).from("affiliate_import_runs").insert({
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
        warnings: report.messages.length,
        error_message: report.error,
        statistics: stats ?? {},
        policy_id: report.publishing?.policyId ?? null,
        policy_name: report.publishing?.policyName ?? null,
        records_held: (report.publishing?.couponsHeld ?? 0) + (report.publishing?.dealsHeld ?? 0),
        publishing_summary: report.publishing ?? null,
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
    return (rows ?? []) as ImportRunRow[];
  });
