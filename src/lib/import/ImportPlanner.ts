// Stage 3–5 – turns a SyncResult into an ImportPlan. No database writes.

import type { SyncResult } from "@/lib/sync";
import { DuplicateResolver } from "./DuplicateResolver";
import { buildSnapshot, EntityMatcher, type ExistingRow } from "./EntityMatcher";
import {
  emptyPlan,
  type IdentitySummary,
  type ImportEntityKind,
  type ImportIssue,
  type ImportPlan,
  type PlannedRecord,
} from "./ImportPlan";
import { logImportEntity } from "./ImportLogger";
import { ImportValidator } from "./ImportValidator";
import { SlugGenerator, slugify } from "./SlugGenerator";

export interface ExistingData {
  stores: ExistingRow[];
  categories: ExistingRow[];
  coupons: ExistingRow[];
}

export interface PlannerCounters {
  validated: number;
  validationFailures: number;
  duplicates: number;
}

/** Raw provider identifier for diagnostics (e.g. Impact `PromotionIds`). */
function rawProviderId(metadata: Record<string, unknown> | undefined, fallback: string): string {
  const raw = metadata?.PromotionIds ?? metadata?.PromotionId ?? metadata?.Id;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : fallback;
}

function identitySummary(
  entity: ImportEntityKind,
  fetched: number,
  unique: number,
  duplicates: ImportIssue[],
  dropped: number,
  toCreate: number,
  toUpdate: number,
): IdentitySummary {
  return {
    entity,
    fetched,
    uniqueIdentities: unique,
    duplicateIdentities: duplicates.length,
    duplicateRecords: dropped,
    toCreate,
    toUpdate,
  };
}

export function planImport(
  sync: SyncResult,
  existing: ExistingData,
): { plan: ImportPlan; counters: PlannerCounters } {
  const plan = emptyPlan(sync.provider, sync.integrationId);
  const counters: PlannerCounters = { validated: 0, validationFailures: 0, duplicates: 0 };

  const storeSnap = buildSnapshot(existing.stores);
  const categorySnap = buildSnapshot(existing.categories);
  const couponSnap = buildSnapshot(existing.coupons);

  const storeSlugs = new SlugGenerator(storeSnap.slugs);
  const categorySlugs = new SlugGenerator(categorySnap.slugs);

  const push = (issues: ImportIssue[], target: ImportIssue[]) => target.push(...issues);
  const summaries: IdentitySummary[] = [];

  // ── Categories ──────────────────────────────────────────────────────────
  {
    const { valid, errors } = ImportValidator.categories(sync.categories);
    const { unique, duplicates, dropped } = DuplicateResolver.dedupe(
      "category",
      sync.provider,
      valid,
      (c) => ({ id: c.providerCategoryId, raw: c.providerCategoryId }),
    );
    push(errors, plan.validationErrors);
    push(duplicates, plan.conflicts);
    counters.validated += sync.categories.length;
    counters.validationFailures += errors.length;
    counters.duplicates += dropped;

    for (const c of unique) {
      const candidate = slugify(c.name);
      const { existingId } = EntityMatcher.match(categorySnap, c.providerCategoryId, candidate);
      const existingSlug = existingId
        ? existing.categories.find((r) => r.id === existingId)?.slug ?? null
        : null;
      const slug = existingId ? existingSlug ?? candidate : categorySlugs.reserve(c.name);
      const record: PlannedRecord<typeof c> = {
        entity: "category",
        action: existingId ? "update" : "create",
        providerEntityId: c.providerCategoryId,
        existingId,
        slug,
        source: c,
      };
      if (existingId) plan.categoriesToUpdate.push(record);
      else plan.categoriesToCreate.push(record);
    }

    logImportEntity({
      provider: sync.provider,
      integrationId: sync.integrationId,
      entity: "category",
      validated: sync.categories.length,
      invalid: errors.length,
      create: plan.categoriesToCreate.length,
      update: plan.categoriesToUpdate.length,
      skip: dropped,
    });

    summaries.push(
      identitySummary("category", sync.categories.length, unique.length, duplicates, dropped, plan.categoriesToCreate.length, plan.categoriesToUpdate.length),
    );
  }

  // ── Stores ──────────────────────────────────────────────────────────────
  {
    const { valid, errors, warnings } = ImportValidator.stores(sync.stores);
    const { unique, duplicates, dropped } = DuplicateResolver.dedupe(
      "store",
      sync.provider,
      valid,
      (s) => ({ id: s.providerStoreId, raw: s.providerStoreId }),
    );
    push(errors, plan.validationErrors);
    if (warnings?.length) push(warnings, plan.warnings);
    push(duplicates, plan.conflicts);
    counters.validated += sync.stores.length;
    counters.validationFailures += errors.length;
    counters.duplicates += dropped;

    for (const s of unique) {
      const candidate = slugify(s.name);
      const { existingId } = EntityMatcher.match(storeSnap, s.providerStoreId, candidate);
      const existingSlug = existingId
        ? existing.stores.find((r) => r.id === existingId)?.slug ?? null
        : null;
      const slug = existingId ? existingSlug ?? candidate : storeSlugs.reserve(s.name);
      const existing = existingId ? existing.stores.find((r) => r.id === existingId) : undefined;
      const record: PlannedRecord<typeof s> = {
        entity: "store",
        action: existingId ? "update" : "create",
        providerEntityId: s.providerStoreId,
        existingId,
        slug,
        source: s,
      };
      if (existingId) plan.storesToUpdate.push(record);
      else plan.storesToCreate.push(record);
      plan.storeCandidates.push({ ...record, existingLifecycleManaged: !!(existing as ExistingRow & { lifecycleManaged?: boolean })?.lifecycleManaged, existingLifecycleHidden: !!(existing as ExistingRow & { lifecycleHidden?: boolean })?.lifecycleHidden });
    }

    logImportEntity({
      provider: sync.provider,
      integrationId: sync.integrationId,
      entity: "store",
      validated: sync.stores.length,
      invalid: errors.length,
      create: plan.storesToCreate.length,
      update: plan.storesToUpdate.length,
      skip: dropped,
    });

    summaries.push(
      identitySummary("store", sync.stores.length, unique.length, duplicates, dropped, plan.storesToCreate.length, plan.storesToUpdate.length),
    );
  }

  // Stores reachable after this run (existing + planned) — promotions that
  // reference an unknown store cannot be imported.
  const knownStoreProviderIds = new Set<string>([
    ...storeSnap.byProviderId.keys(),
    ...plan.storesToCreate.map((r) => r.providerEntityId),
    ...plan.storesToUpdate.map((r) => r.providerEntityId),
  ]);

  // Advertiser id -> store provider entity id (campaign id). Campaign ids stay
  // the store identity; advertiser ids are only an additional lookup key.
  const storeIdByAdvertiser = new Map<string, string>();
  for (const r of [...plan.storesToCreate, ...plan.storesToUpdate]) {
    const advertiserId = r.source.providerAdvertiserId;
    if (advertiserId) storeIdByAdvertiser.set(advertiserId, r.providerEntityId);
  }

  /** Promotion -> store: prefer the advertiser id, fall back to campaign id. */
  const resolveStoreId = (
    advertiserId: string | null | undefined,
    campaignId: string | null | undefined,
    providerStoreId: string | null,
  ): string | null => {
    if (advertiserId) {
      const byAdvertiser = storeIdByAdvertiser.get(advertiserId);
      if (byAdvertiser) return byAdvertiser;
    }
    for (const candidate of [campaignId, providerStoreId]) {
      if (candidate && knownStoreProviderIds.has(candidate)) return candidate;
    }
    if (providerStoreId) {
      const byAdvertiser = storeIdByAdvertiser.get(providerStoreId);
      if (byAdvertiser) return byAdvertiser;
    }
    return null;
  };

  // ── Coupons ─────────────────────────────────────────────────────────────
  {
    const { valid, errors, warnings } = ImportValidator.coupons(sync.coupons);
    const { unique, duplicates, dropped } = DuplicateResolver.dedupe(
      "coupon",
      sync.provider,
      valid,
      (c) => ({ id: c.providerCouponId, raw: rawProviderId(c.metadata, c.providerCouponId) }),
    );
    push(errors, plan.validationErrors);
    if (warnings?.length) push(warnings, plan.warnings);
    push(duplicates, plan.conflicts);
    counters.validated += sync.coupons.length;
    counters.validationFailures += errors.length;
    counters.duplicates += dropped;

    for (const c of unique) {
      const storeId = resolveStoreId(c.providerAdvertiserId, c.providerCampaignId, c.providerStoreId);
      if (!storeId) {
        plan.skipped.push({
          entity: "coupon",
          providerEntityId: c.providerCouponId,
          reason: "referenced store not present in this import or database",
        });
        continue;
      }
      const { existingId } = EntityMatcher.match(couponSnap, c.providerCouponId);
      const record: PlannedRecord<typeof c> = {
        entity: "coupon",
        action: existingId ? "update" : "create",
        providerEntityId: c.providerCouponId,
        existingId,
        slug: null,
        source: { ...c, providerStoreId: storeId },
      };
      if (existingId) plan.couponsToUpdate.push(record);
      else plan.couponsToCreate.push(record);
    }

    logImportEntity({
      provider: sync.provider,
      integrationId: sync.integrationId,
      entity: "coupon",
      validated: sync.coupons.length,
      invalid: errors.length,
      create: plan.couponsToCreate.length,
      update: plan.couponsToUpdate.length,
      skip: dropped,
    });

    summaries.push(
      identitySummary("coupon", sync.coupons.length, unique.length, duplicates, dropped, plan.couponsToCreate.length, plan.couponsToUpdate.length),
    );
  }

  // ── Deals ───────────────────────────────────────────────────────────────
  {
    const { valid, errors, warnings } = ImportValidator.deals(sync.deals);
    const { unique, duplicates, dropped } = DuplicateResolver.dedupe(
      "deal",
      sync.provider,
      valid,
      (d) => ({ id: d.providerDealId, raw: rawProviderId(d.metadata, d.providerDealId) }),
    );
    push(errors, plan.validationErrors);
    if (warnings?.length) push(warnings, plan.warnings);
    push(duplicates, plan.conflicts);
    counters.validated += sync.deals.length;
    counters.validationFailures += errors.length;
    counters.duplicates += dropped;

    for (const d of unique) {
      const storeId = resolveStoreId(d.providerAdvertiserId, d.providerCampaignId, d.providerStoreId);
      if (!storeId) {
        plan.skipped.push({
          entity: "deal",
          providerEntityId: d.providerDealId,
          reason: "referenced store not present in this import or database",
        });
        continue;
      }
      const { existingId } = EntityMatcher.match(couponSnap, d.providerDealId);
      const record: PlannedRecord<typeof d> = {
        entity: "deal",
        action: existingId ? "update" : "create",
        providerEntityId: d.providerDealId,
        existingId,
        slug: null,
        source: { ...d, providerStoreId: storeId },
      };
      if (existingId) plan.dealsToUpdate.push(record);
      else plan.dealsToCreate.push(record);
    }

    logImportEntity({
      provider: sync.provider,
      integrationId: sync.integrationId,
      entity: "deal",
      validated: sync.deals.length,
      invalid: errors.length,
      create: plan.dealsToCreate.length,
      update: plan.dealsToUpdate.length,
      skip: dropped,
    });

    summaries.push(
      identitySummary("deal", sync.deals.length, unique.length, duplicates, dropped, plan.dealsToCreate.length, plan.dealsToUpdate.length),
    );
  }

  plan.identity = summaries;

  for (const err of plan.validationErrors) {
    plan.warnings.push({ ...err, reason: `validation: ${err.reason}` });
  }

  return { plan, counters };
}

export const ImportPlanner = { planImport };
