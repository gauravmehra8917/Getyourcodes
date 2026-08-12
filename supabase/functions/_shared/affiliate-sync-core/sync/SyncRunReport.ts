// Runtime-neutral projection of a sync/import result for the admin preview.
// It contains no authentication, database, executor, or history concerns.

import type { ImportPlan } from "../import/ImportPlan.ts";
import type { ImportResult } from "../import/ImportResult.ts";
import type { SyncResult } from "./SyncResult.ts";
import type { PublishingSummary } from "../publishing-policy/types.ts";
import type { RawPromotionDiagnostics } from "../diagnostics/RawPromotionDiagnostics.ts";
import {
  couponSeoDescription,
  couponSeoTitle,
  storeSeoDescription,
  storeSeoTitle,
} from "../presentation/seo-preview.ts";

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
  provider?: string | null;
  occurrences?: number | null;
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

export interface LifecycleSummary {
  storesFetched: number;
  storesEvaluated: number;
  storesQualified: number;
  storesHeld: number;
  storesToCreate: number;
  storesToUpdate: number;
  storesToLifecycleHide: number;
  storesToLifecycleRepublish: number;
}

export interface LifecycleDiagnostic {
  store: string;
  providerEntityId: string;
  eligibleCoupons: number;
  eligibleDeals: number;
  selectedCoupons: number;
  selectedDeals: number;
  qualified: boolean;
  action: string;
  reason: string;
}

export interface IdentityDiagnostics {
  totalNormalizedCoupons: number;
  totalNormalizedDeals: number;
  uniqueProviderAdvertiserIds: number;
  uniqueProviderStoreIds: number;
  uniqueProviderCampaignIds: number;
  uniqueEffectiveStoreKeys: number;
  offersResolvingToUnassigned: number;
  topStoreKeys: Array<{ effectiveStoreKey: string; coupons: number; deals: number; merchantNames: string[] }>;
  sampleOffers: Array<{
    offerTitle: string;
    merchantName: string | null;
    providerEntityId: string;
    providerAdvertiserId: string | null;
    providerStoreId: string | null;
    providerCampaignId: string | null;
    effectiveStoreKey: string;
  }>;
}

export interface SyncRunReport {
  provider: string;
  integrationId: string;
  preview: boolean;
  committed: boolean;
  durationMs: number;
  orchestration: {
    strategy: string;
    pagesCrawled: number;
    apiCallsUsed: number;
    recordsFetched: number;
    newProviderIdentitiesDiscovered: number;
    existingProviderIdentitiesEncountered: number;
    stopReason: string | null;
  } | null;
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
  lifecycle: LifecycleSummary | null;
  lifecycleDiagnostics: LifecycleDiagnostic[];
  identityDiagnostics: IdentityDiagnostics | null;
  /** TEMPORARY — raw Promotions observation, returned by read-only preview only. */
  rawPromotionDiagnostics: RawPromotionDiagnostics | null;
  statistics: {
    validated: number;
    created: number;
    updated: number;
    skipped: number;
    validationFailures: number;
    duplicates: number;
    durationMs: number;
  } | null;
  validationErrors: ReportIssue[];
  skipped: ReportIssue[];
  conflicts: ReportIssue[];
  identity: IdentitySummaryRow[];
  presentation: PresentationRow[];
  logos: LogoSyncSummaryRow | null;
  coverage: {
    stores: number;
    storesWithHostedLogo: number;
    offers: number;
    offersWithDescription: number;
    offersWithTerms: number;
  } | null;
  publishing: PublishingSummary | null;
  messages: string[];
  error: string | null;
}

type PlanRecordLike = {
  providerEntityId: string;
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

type RawIssue = {
  entity: string;
  providerEntityId: string | null;
  field?: string;
  reason: string;
  provider?: string;
  occurrences?: number;
  rawProviderId?: string | null;
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function trackingSource(meta: Record<string, unknown>, trackingUrl: string | null): PresentationRow["trackingSource"] {
  if (!trackingUrl) return "none";
  const warning = str(meta.trackingUrlWarning)?.toLowerCase() ?? "";
  if (warning.includes("campaign")) return "campaign";
  if (str(meta.enrichmentAdId)) return "ad";
  return "promotion";
}

export function buildPresentation(plan: ImportPlan, limit = 50): PresentationRow[] {
  const rows: PresentationRow[] = [];
  const storeNames = new Map<string, string>();
  const stores: PlanRecordLike[] = [...plan.storesToCreate, ...plan.storesToUpdate];
  for (const record of stores) {
    const name = record.source.name ?? "";
    for (const key of [record.providerEntityId, record.source.providerAdvertiserId, record.source.providerCampaignId]) {
      if (key) storeNames.set(key, name);
    }
    const meta = record.source.metadata ?? {};
    const logo = str(record.source.logo);
    rows.push({
      entity: "store",
      providerEntityId: record.providerEntityId,
      name,
      seoTitle: storeSeoTitle(name),
      seoDescription: storeSeoDescription(name),
      logoStatus: logo ? (logo.includes("/storage/v1/object/public/") ? "hosted" : "provider") : "missing",
      descriptionStatus: str(record.source.description) ? "present" : "missing",
      trackingSource: str(meta.trackingLink) ? "campaign" : "none",
      landingPageStatus: str(meta.landingPageUrl) ? "present" : "missing",
    });
  }

  const promotions: [PresentationRow["entity"], PlanRecordLike[]][] = [
    ["coupon", [...plan.couponsToCreate, ...plan.couponsToUpdate]],
    ["deal", [...plan.dealsToCreate, ...plan.dealsToUpdate]],
  ];
  for (const [entity, records] of promotions) {
    for (const record of records) {
      const meta = record.source.metadata ?? {};
      const storeName =
        [record.source.providerAdvertiserId, record.source.providerStoreId, record.source.providerCampaignId]
          .map((key) => (key ? storeNames.get(key) : undefined))
          .find(Boolean) ??
        str(meta.advertiserName) ??
        "this store";
      const title = record.source.title ?? "";
      rows.push({
        entity,
        providerEntityId: record.providerEntityId,
        name: title,
        seoTitle: couponSeoTitle(title, storeName),
        seoDescription: couponSeoDescription(title, storeName),
        logoStatus: "missing",
        descriptionStatus: str(record.source.description) ? "present" : "missing",
        trackingSource: trackingSource(meta, str(record.source.trackingUrl)),
        landingPageStatus: str(meta.landingPageUrl) ? "present" : "missing",
      });
    }
  }
  return rows.slice(0, limit);
}

export function buildLifecycleDiagnostics(plan: ImportPlan): LifecycleDiagnostic[] {
  return plan.storeLifecycle.map((decision) => ({
    store: decision.candidate.source.name,
    providerEntityId: decision.providerEntityId,
    eligibleCoupons: decision.qualification.eligibleCoupons,
    eligibleDeals: decision.qualification.eligibleDeals,
    selectedCoupons: decision.qualification.selectedCoupons,
    selectedDeals: decision.qualification.selectedDeals,
    qualified: decision.qualification.qualified,
    action: decision.action,
    reason: decision.qualification.reason,
  }));
}

export function toReportIssues(rows: RawIssue[] | undefined): ReportIssue[] {
  return (rows ?? []).map((issue) => ({
    entity: issue.entity,
    providerEntityId: issue.providerEntityId ?? null,
    field: issue.field ?? null,
    reason: issue.reason,
    provider: issue.provider ?? null,
    occurrences: issue.occurrences ?? null,
    rawProviderId: issue.rawProviderId ?? null,
  }));
}

export function emptySyncRunReport(integrationId: string, preview: boolean): SyncRunReport {
  return {
    provider: "unknown", integrationId, preview, committed: false, durationMs: 0,
    orchestration: null, syncErrors: [], syncWarnings: [], progress: null, planCounts: null,
    lifecycle: null, lifecycleDiagnostics: [], identityDiagnostics: null, statistics: null,
    rawPromotionDiagnostics: null,
    validationErrors: [], skipped: [], conflicts: [], identity: [], presentation: [], logos: null,
    coverage: null, publishing: null, messages: [], error: null,
  };
}

export function projectSync(report: SyncRunReport, sync: SyncResult): SyncRunReport {
  report.provider = sync.provider;
  report.orchestration = sync.orchestration;
  report.progress = {
    currentEntity: sync.progress.currentEntity,
    currentPage: sync.progress.currentPage,
    recordsFetched: sync.progress.recordsFetched,
    recordsNormalized: sync.progress.recordsNormalized,
    status: sync.progress.status,
  };
  report.syncErrors = sync.errors.map((issue) => `[${issue.entity ?? "run"}] ${issue.message}`);
  report.syncWarnings = sync.warnings.map((issue) => `[${issue.entity ?? "run"}] ${issue.message}`);
  return report;
}

export function projectImport(report: SyncRunReport, sync: SyncResult, imported: ImportResult): SyncRunReport {
  const plan = imported.plan;
  report.committed = imported.committed;
  report.planCounts = {
    storesToCreate: plan.storesToCreate.length,
    storesToUpdate: plan.storesToUpdate.length,
    couponsToCreate: plan.couponsToCreate.length,
    couponsToUpdate: plan.couponsToUpdate.length,
    dealsToCreate: plan.dealsToCreate.length,
    dealsToUpdate: plan.dealsToUpdate.length,
    categoriesToCreate: plan.categoriesToCreate.length,
    categoriesToUpdate: plan.categoriesToUpdate.length,
    skipped: plan.skipped.length,
  };
  report.lifecycle = {
    storesFetched: sync.statistics?.storesFetched ?? sync.stores.length,
    ...plan.storeLifecycleStatistics,
  };
  report.lifecycleDiagnostics = buildLifecycleDiagnostics(plan);
  report.identityDiagnostics = imported.preview ? imported.identityDiagnostics : null;
  report.statistics = {
    validated: imported.statistics.validated,
    created: imported.statistics.created,
    updated: imported.statistics.updated,
    skipped: imported.statistics.skipped,
    validationFailures: imported.statistics.validationFailures,
    duplicates: imported.statistics.duplicates,
    durationMs: imported.statistics.durationMs,
  };
  report.validationErrors = toReportIssues(plan.validationErrors);
  report.skipped = toReportIssues(plan.skipped);
  report.conflicts = toReportIssues(plan.conflicts);
  report.identity = plan.identity.map((row) => ({ ...row }));
  report.presentation = buildPresentation(plan);
  report.publishing = imported.publishing;
  report.messages = imported.warnings;
  return report;
}

export function projectPreviewSyncRunReport(
  sync: SyncResult,
  imported: ImportResult,
  durationMs: number,
): SyncRunReport {
  const report = projectImport(projectSync(emptySyncRunReport(sync.integrationId, true), sync), sync, imported);
  report.preview = true;
  report.committed = false;
  report.durationMs = durationMs;
  report.rawPromotionDiagnostics = sync.rawPromotionDiagnostics ?? null;
  return report;
}
