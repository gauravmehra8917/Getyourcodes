// Provider-independent Sync Engine (Phase 2D.1 — orchestration only).
//
// Provider → ProviderAdapter → Normalizer → SyncEngine → SyncResult
//
// Fetches pages through the adapter, normalizes them through the normalizer,
// aggregates canonical entities, tracks progress and statistics.
// It NEVER validates, deduplicates or persists anything.

import type { StandardResponse } from "../integration-engine/types.ts";
import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
  NormalizationBatch,
  PromotionSplit,
} from "../normalizers/types.ts";
import type { FetchOptions, ProviderResult } from "../providers/ProviderAdapter.ts";
import type { RawPromotionDiagnostics } from "../diagnostics/RawPromotionDiagnostics.ts";
import { supportsOfferEnrichment, type OfferEnricher } from "../enrichment/OfferEnricher.ts";
import { SyncContext } from "./SyncContext.ts";
import { logSyncPage, logSyncSummary } from "./SyncLogger.ts";
import type { SyncEntityType } from "./SyncOptions.ts";
import type { SyncProgress } from "./SyncProgress.ts";
import type { SyncIssue, SyncResult } from "./SyncResult.ts";
import { applyEntityStats, type EntityStatistics } from "./SyncStatistics.ts";
import { classifyOfferIdentities, shouldPersistOffer, type ImportStopReason } from "./ImportOrchestration.ts";

/** Optional capability: normalizers that split a single promotions feed. */
interface PromotionAwareNormalizer {
  normalizePromotions(raw: unknown, ctx?: { integrationId?: string }): StandardResponse<PromotionSplit>;
}

function supportsPromotionSplit(n: unknown): n is PromotionAwareNormalizer {
  return typeof (n as PromotionAwareNormalizer)?.normalizePromotions === "function";
}

type RawPromotionDiagnosticsAdapter = {
  enableRawPromotionDiagnostics: () => void;
  getRawPromotionDiagnostics: () => RawPromotionDiagnostics | null;
};

function supportsRawPromotionDiagnostics(adapter: unknown): adapter is RawPromotionDiagnosticsAdapter {
  return typeof (adapter as RawPromotionDiagnosticsAdapter)?.enableRawPromotionDiagnostics === "function" &&
    typeof (adapter as RawPromotionDiagnosticsAdapter)?.getRawPromotionDiagnostics === "function";
}

type PageRecords = unknown[];
type PageOutcome = { normalized: number; skipped: number; error?: string; offerIds?: string[] };

export class SyncEngine {
  private ctx: SyncContext;
  private apiCallsUsed = 0;
  private readonly seenOfferIds = new Set<string>();
  private newProviderIdentities = 0;
  private existingProviderIdentities = 0;
  private halted = false;
  private remainingOfferEntities = 0;
  private offerApiCallReserve = 0;

  constructor(ctx: SyncContext) {
    this.ctx = ctx;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async run(): Promise<StandardResponse<SyncResult>> {
    const { ctx } = this;
    const { entityTypes, continueOnError } = ctx.options;
    const collectRawPromotionDiagnostics = ctx.options.rawPromotionDiagnostics && supportsRawPromotionDiagnostics(ctx.adapter);
    if (collectRawPromotionDiagnostics) ctx.adapter.enableRawPromotionDiagnostics();
    ctx.statistics.strategy = ctx.options.strategy;
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

    // Offer Enrichment (optional adapter capability). Applied to raw offer
    // pages before normalization — identity and dedup stay untouched.
    let enricher: OfferEnricher | null = null;
    if (supportsOfferEnrichment(ctx.adapter)) {
      try {
        enricher = ctx.adapter.createOfferEnricher();
      } catch {
        enricher = null;
      }
    }
    const enrichOffers = enricher
      ? (records: unknown[]) => enricher!.enrichOffers(records)
      : undefined;

    const requestedPlan = entityTypes.filter((e) => !(splitPromotions && e === "deal"));
    // Offers are the primary import output. Fetch them before supporting store/category
    // entities so those entities cannot consume the run budget first.
    const plan: SyncEntityType[] = [
      ...requestedPlan.filter(isOfferEntity),
      ...requestedPlan.filter((entity) => !isOfferEntity(entity)),
    ];
    this.remainingOfferEntities = plan.filter(isOfferEntity).length;
    this.offerApiCallReserve = ctx.options.maxApiCalls == null || this.remainingOfferEntities === 0
      ? 0
      : Math.max(1, Math.ceil(ctx.options.maxApiCalls / 2));

    // Tracking urls already known from synced stores, keyed by every provider
    // identifier the store exposes. Used as a fallback for promotions.
    const promotionCtx = () => {
      const storeTrackingUrls: Record<string, string> = {};
      for (const s of stores) {
        const url =
          (typeof s.metadata?.trackingLink === "string" ? s.metadata.trackingLink : null) ?? s.website;
        if (!url) continue;
        for (const key of [s.providerStoreId, s.providerAdvertiserId, s.providerCampaignId]) {
          if (key) storeTrackingUrls[key] = url;
        }
      }
      return { integrationId: ctx.integrationId, storeTrackingUrls };
    };

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
          const res = (ctx.normalizer as unknown as PromotionAwareNormalizer).normalizePromotions(
            records,
            promotionCtx(),
          );
          if (!res.success || !res.body) {
            return { normalized: 0, skipped: Array.isArray(records) ? records.length : 0, error: res.error?.message };
          }
          const offerIds: string[] = [];
          let normalized = 0;
          for (const coupon of res.body.coupons) {
            offerIds.push(coupon.providerCouponId);
            if (shouldPersistOffer(ctx.options.strategy, ctx.options.existingProviderOfferIds.has(coupon.providerCouponId))) {
              coupons.push(coupon); normalized += 1;
            }
          }
          for (const deal of res.body.deals) {
            offerIds.push(deal.providerDealId);
            if (shouldPersistOffer(ctx.options.strategy, ctx.options.existingProviderOfferIds.has(deal.providerDealId))) {
              deals.push(deal); normalized += 1;
            }
          }
          const total = Array.isArray(records) ? records.length : normalized;
          return { normalized, skipped: Math.max(0, total - normalized), offerIds };
        }, enrichOffers);
      } else if (entity === "coupon") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchCoupons(o), (records) =>
          this.batchOffers(ctx.normalizer.normalizeCoupons(records, promotionCtx()), coupons),
          enrichOffers,
        );
      } else if (entity === "deal") {
        ok = await this.syncEntity(entity, (o) => ctx.adapter.fetchDeals(o), (records) =>
          this.batchOffers(ctx.normalizer.normalizeDeals(records, promotionCtx()), deals),
          enrichOffers,
        );
      }


      if (isOfferEntity(entity)) this.remainingOfferEntities -= 1;
      if (this.halted || (!ok && !continueOnError)) break;
    }

    ctx.statistics.durationMs = ctx.progress.elapsedMs;

    const status: SyncProgress["status"] = ctx.errors.length
      ? ctx.statistics.totalNormalized > 0
        ? "partial"
        : "failed"
      : "completed";
    const progress = ctx.progress.update({ status, currentEntity: null });

    const rawPromotionDiagnostics = collectRawPromotionDiagnostics
      ? ctx.adapter.getRawPromotionDiagnostics()
      : null;
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
      orchestration: {
        strategy: ctx.options.strategy,
        pagesCrawled: ctx.statistics.totalPages,
        apiCallsUsed: this.apiCallsUsed,
        recordsFetched: ctx.statistics.totalRecords,
        newProviderIdentitiesDiscovered: this.newProviderIdentities,
        existingProviderIdentitiesEncountered: this.existingProviderIdentities,
        stopReason: ctx.statistics.stopReason,
      },
      ...(collectRawPromotionDiagnostics ? { rawPromotionDiagnostics } : {}),
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
    normalizePage: (records: PageRecords) => PageOutcome,
    enrich?: (records: PageRecords) => Promise<PageRecords>,
  ): Promise<boolean> {
    const { ctx } = this;
    const { pageSize, maxPages, maxApiCalls, startPage, continueOnError, fetchParams } = ctx.options;
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
    let consecutiveNoNew = 0;
    let stopReason: ImportStopReason | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pagesDone >= maxPages) { stopReason = "max_pages"; break; }
      if (maxApiCalls != null && this.apiCallsUsed >= maxApiCalls) { stopReason = "max_api_calls"; this.halted = true; break; }
      // Keep a provider-neutral portion of the total cap available while offer
      // discovery remains. The offer-first plan makes this a safeguard rather
      // than the normal path, and protects future plans that require stores first.
      if (!isOfferEntity(entity) && this.remainingOfferEntities > 0 && maxApiCalls != null &&
          this.apiCallsUsed >= maxApiCalls - this.offerApiCallReserve) {
        stopReason = "max_api_calls";
        break;
      }

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
      this.apiCallsUsed += 1;

      if (!res.success) {
        stats.failed = true;
        stopReason = "fetch_error";
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
      let pageRecords: PageRecords = records;
      if (records.length && enrich) {
        try {
          pageRecords = await enrich(records);
        } catch (err) {
          pageRecords = records;
          ctx.warn({
            entity,
            page,
            stage: "normalize",
            message: `offer enrichment skipped: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      if (records.length) {
        try {
          const out = normalizePage(pageRecords);
          normalized = out.normalized;
          skipped = out.skipped;
          if (out.error) {
            ctx.warn({ entity, page, stage: "normalize", message: out.error });
          }
          if (entity === "coupon" || entity === "deal") {
            const discovery = classifyOfferIdentities(out.offerIds ?? [], ctx.options.existingProviderOfferIds, this.seenOfferIds);
            this.newProviderIdentities += discovery.newProviderIdentities;
            this.existingProviderIdentities += discovery.existingProviderIdentities;
            consecutiveNoNew = discovery.newProviderIdentities === 0 ? consecutiveNoNew + 1 : 0;
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
      const pagination = res.pagination;
      if (pagination?.hasNextPage === false) { stopReason = "provider_end"; break; }
      if (records.length === 0) { stopReason = "provider_end"; break; }
      if (records.length < pageSize) { stopReason = "provider_end"; break; }
      if ((ctx.options.strategy === "incremental" || ctx.options.strategy === "discover_new_offers") && (entity === "coupon" || entity === "deal")) {
        if (consecutiveNoNew >= ctx.options.consecutiveNoNewPages) { stopReason = "consecutive_no_new"; break; }
      }

      page = pagination?.nextPage ?? page + 1;
    }

    stats.stopReason = stopReason;
    if (stopReason) {
      const previous = ctx.statistics.stopReason;
      ctx.statistics.stopReason = previous && previous !== stopReason ? "multiple" : stopReason;
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
  ): PageOutcome {
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

  /** Apply strategy filtering only to offers; stores/categories retain their
   * current synchronization semantics and never use mutable fields as identity. */
  private batchOffers<T extends { providerCouponId?: string; providerDealId?: string }>(
    res: StandardResponse<NormalizationBatch<T>>,
    sink: T[],
  ): PageOutcome {
    if (!res.success || !res.body) return { normalized: 0, skipped: 0, error: res.error?.message ?? "normalization failed" };
    const offerIds: string[] = [];
    let accepted = 0;
    for (const item of res.body.items) {
      const id = item.providerCouponId ?? item.providerDealId;
      if (!id) continue;
      offerIds.push(id);
      if (shouldPersistOffer(this.ctx.options.strategy, this.ctx.options.existingProviderOfferIds.has(id))) {
        sink.push(item);
        accepted += 1;
      }
    }
    return { normalized: accepted, skipped: res.body.skipped + (res.body.items.length - accepted), offerIds,
      error: res.body.issues.length ? `${res.body.issues.length} record(s) skipped` : undefined };
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

function isOfferEntity(entity: SyncEntityType): boolean {
  return entity === "coupon" || entity === "deal";
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
