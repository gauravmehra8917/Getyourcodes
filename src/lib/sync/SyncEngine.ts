// Provider-independent Sync Engine (Phase 2D.1 — orchestration only).
//
// Provider → ProviderAdapter → Normalizer → SyncEngine → SyncResult
//
// Fetches pages through the adapter, normalizes them through the normalizer,
// aggregates canonical entities, tracks progress and statistics.
// It NEVER validates, deduplicates or persists anything.

import type { StandardResponse } from "@/lib/integration-engine/types";
import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
  NormalizationBatch,
  PromotionSplit,
} from "@/lib/normalizers";
import type { FetchOptions, ProviderResult } from "@/lib/providers/index.server";
import { SyncContext } from "./SyncContext";
import { logSyncPage, logSyncSummary } from "./SyncLogger";
import type { SyncEntityType, SyncOptions } from "./SyncOptions";
import type { SyncProgress } from "./SyncProgress";
import type { SyncIssue, SyncResult } from "./SyncResult";
import { applyEntityStats, type EntityStatistics } from "./SyncStatistics";

/** Optional capability: normalizers that split a single promotions feed. */
interface PromotionAwareNormalizer {
  normalizePromotions(raw: unknown, ctx?: { integrationId?: string }): StandardResponse<PromotionSplit>;
}

function supportsPromotionSplit(n: unknown): n is PromotionAwareNormalizer {
  return typeof (n as PromotionAwareNormalizer)?.normalizePromotions === "function";
}

type PageRecords = unknown[];

export class SyncEngine {
  private ctx: SyncContext;

  constructor(ctx: SyncContext) {
    this.ctx = ctx;
  }

  static async forIntegration(integrationId: string, options?: SyncOptions): Promise<SyncEngine> {
    return new SyncEngine(await SyncContext.forIntegration(integrationId, options));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async run(): Promise<StandardResponse<SyncResult>> {
    const { ctx } = this;
    const { entityTypes, continueOnError } = ctx.options;
    ctx.progress.update({ status: "running" });

    const stores: CanonicalStore[] = [];
    const coupons: CanonicalCoupon[] = [];
    const deals: CanonicalDeal[] = [];
    const categories: CanonicalCategory[] = [];

    // Single-pass promotions when the normalizer can split coupons/deals and
    // both entity types were requested (generic capability, not provider logic).
    const splitPromotions =
      entityTypes.includes("coupon") &&
      entityTypes.includes("deal") &&
      supportsPromotionSplit(ctx.normalizer);

    const plan: SyncEntityType[] = entityTypes.filter((e) => !(splitPromotions && e === "deal"));

    for (const entity of plan) {
      let ok = true;
      if (entity === "store") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchStores(o), (records) =>
          this.batch(ctx.normalizer.normalizeStores(records, { integrationId: ctx.integrationId }), stores),
        );
      } else if (entity === "category") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchCategories(o), (records) =>
          this.batch(ctx.normalizer.normalizeCategories(records, { integrationId: ctx.integrationId }), categories),
        );
      } else if (entity === "coupon" && splitPromotions) {
        ok = await this.syncEntity("coupon", (o) => ctx.adapter.fetchCoupons(o), (records) => {
          const res = (ctx.normalizer as unknown as PromotionAwareNormalizer).normalizePromotions(records, {
            integrationId: ctx.integrationId,
          });
          if (!res.success || !res.body) {
            return { normalized: 0, skipped: Array.isArray(records) ? records.length : 0, error: res.error?.message };
          }
          coupons.push(...res.body.coupons);
          deals.push(...res.body.deals);
          const normalized = res.body.coupons.length + res.body.deals.length;
          const total = Array.isArray(records) ? records.length : normalized;
          return { normalized, skipped: Math.max(0, total - normalized) };
        });
      } else if (entity === "coupon") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchCoupons(o), (records) =>
          this.batch(ctx.normalizer.normalizeCoupons(records, { integrationId: ctx.integrationId }), coupons),
        );
      } else if (entity === "deal") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchDeals(o), (records) =>
          this.batch(ctx.normalizer.normalizeDeals(records, { integrationId: ctx.integrationId }), deals),
        );
      }

      if (!ok && !continueOnError) break;
    }

    ctx.statistics.durationMs = ctx.progress.elapsedMs;

    const status: SyncProgress["status"] = ctx.errors.length
      ? ctx.statistics.totalNormalized > 0
        ? "partial"
        : "failed"
      : "completed";
    const progress = ctx.progress.update({ status, currentEntity: null });

    const result: SyncResult = {
      provider: ctx.provider,
      integrationId: ctx.integrationId,
      startedAt: ctx.startedAt,
      finishedAt: new Date().toISOString(),
      entityTypes: ctx.options.entityTypes,
      stores,
      coupons,
      deals,
      categories,
      statistics: ctx.options.includeStatistics ? ctx.statistics : null,
      progress,
      warnings: ctx.warnings,
      errors: ctx.errors,
    };

    logSyncSummary({
      provider: ctx.provider,
      integrationId: ctx.integrationId,
      entities: ctx.options.entityTypes.join(","),
      stores: stores.length,
      coupons: coupons.length,
      deals: deals.length,
      categories: categories.length,
      requests: ctx.statistics.totalRequests,
      pages: ctx.statistics.totalPages,
      records: ctx.statistics.totalRecords,
      durationMs: ctx.statistics.durationMs,
      status,
    });

    return this.response(result, status !== "failed");
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Paginate one entity, normalizing every page. Returns false on failure. */
  private async syncEntity(
    entity: SyncEntityType,
    fetchPage: (opts: FetchOptions) => Promise<ProviderResult<unknown>>,
    normalizePage: (records: PageRecords) => { normalized: number; skipped: number; error?: string },
  ): Promise<boolean> {
    const { ctx } = this;
    const { pageSize, maxPages, startPage, continueOnError, fetchParams } = ctx.options;
    const entityStarted = Date.now();

    const stats: EntityStatistics = {
      entity,
      requests: 0,
      pages: 0,
      fetched: 0,
      normalized: 0,
      skipped: 0,
      durationMs: 0,
      failed: false,
    };

    let page = startPage;
    let pagesDone = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (maxPages != null && pagesDone >= maxPages) break;

      const pageStarted = Date.now();
      ctx.progress.update({ currentEntity: entity, currentPage: page });

      let res: ProviderResult<unknown>;
      try {
        res = await fetchPage({ ...fetchParams, page, pageSize } as FetchOptions);
      } catch (err) {
        res = {
          success: false,
          status: 0,
          latencyMs: Date.now() - pageStarted,
          headers: {},
          body: null,
          error: { class: "unknown_error", message: err instanceof Error ? err.message : String(err) },
          retryCount: 0,
          meta: { integrationId: ctx.integrationId, method: "GET", url: "", at: new Date().toISOString() },
        };
      }

      stats.requests += 1;

      if (!res.success) {
        stats.failed = true;
        const issue: SyncIssue = {
          entity,
          page,
          stage: "fetch",
          message: res.error?.message ?? `Fetch failed with status ${res.status}`,
        };
        if (continueOnError && pagesDone > 0) ctx.warn(issue);
        else ctx.fail(issue);

        logSyncPage({
          provider: ctx.provider,
          integrationId: ctx.integrationId,
          entity,
          page,
          requests: stats.requests,
          fetched: 0,
          normalized: 0,
          skipped: 0,
          durationMs: Date.now() - pageStarted,
          outcome: "failure",
          message: issue.message,
        });
        break;
      }

      const records = toArray(res.body);
      stats.pages += 1;
      pagesDone += 1;
      stats.fetched += records.length;

      let normalized = 0;
      let skipped = 0;
      if (records.length) {
        try {
          const out = normalizePage(records);
          normalized = out.normalized;
          skipped = out.skipped;
          if (out.error) {
            ctx.warn({ entity, page, stage: "normalize", message: out.error });
          }
        } catch (err) {
          skipped = records.length;
          const message = err instanceof Error ? err.message : String(err);
          const issue: SyncIssue = { entity, page, stage: "normalize", message };
          if (continueOnError) ctx.warn(issue);
          else ctx.fail(issue);
          if (!continueOnError) {
            stats.failed = true;
            stats.normalized += normalized;
            stats.skipped += skipped;
            break;
          }
        }
      }

      stats.normalized += normalized;
      stats.skipped += skipped;
      ctx.progress.addRecords(records.length, normalized);

      logSyncPage({
        provider: ctx.provider,
        integrationId: ctx.integrationId,
        entity,
        page,
        requests: stats.requests,
        fetched: records.length,
        normalized,
        skipped,
        durationMs: Date.now() - pageStarted,
        outcome: "success",
      });

      ctx.options.onProgress?.(ctx.progress.snapshot());

      // Stop conditions: empty page, or a short page when pageSize is known.
      if (records.length === 0) break;
      if (pageSize != null && records.length < pageSize) break;
      if (pageSize == null) break; // no pagination hint → single request

      page += 1;
    }

    stats.durationMs = Date.now() - entityStarted;
    applyEntityStats(ctx.statistics, stats);
    ctx.progress.update({ totalPages: ctx.statistics.totalPages });
    ctx.options.onProgress?.(ctx.progress.snapshot());

    return !(stats.failed && stats.normalized === 0);
  }

  /** Push a normalization batch into its collector and report counts. */
  private batch<T>(
    res: StandardResponse<NormalizationBatch<T>>,
    sink: T[],
  ): { normalized: number; skipped: number; error?: string } {
    if (!res.success || !res.body) {
      return { normalized: 0, skipped: 0, error: res.error?.message ?? "normalization failed" };
    }
    sink.push(...res.body.items);
    return {
      normalized: res.body.normalized,
      skipped: res.body.skipped,
      error: res.body.issues.length ? `${res.body.issues.length} record(s) skipped` : undefined,
    };
  }

  private response(body: SyncResult, success: boolean): StandardResponse<SyncResult> {
    return {
      success,
      status: success ? 200 : 0,
      latencyMs: body.statistics?.durationMs ?? 0,
      headers: {},
      body,
      error: success
        ? null
        : { class: "unknown_error", message: body.errors[0]?.message ?? "Sync failed" },
      retryCount: 0,
      meta: {
        integrationId: body.integrationId,
        method: "GET",
        url: `sync://${body.provider}`,
        at: new Date().toISOString(),
      },
    };
  }
}

function toArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
