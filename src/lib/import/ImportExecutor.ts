// Stage 7 – transactional persistence. All writes happen inside one
// database routine (`public.import_apply`), so a failure rolls everything back.

import type { ImportPlan, PlannedRecord } from "./ImportPlan";
import type { CanonicalCoupon, CanonicalDeal } from "@/lib/normalizers";

type Row = Record<string, unknown>;

function isoToDate(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function couponStatus(status: string): "active" | "expired" | "draft" {
  if (status === "active") return "active";
  if (status === "expired") return "expired";
  return "draft";
}

function promotionRow(
  record: PlannedRecord<CanonicalCoupon> | PlannedRecord<CanonicalDeal>,
): Row {
  const source = record.source as CanonicalCoupon & Partial<CanonicalDeal>;
  const isCoupon = record.entity === "coupon";
  return {
    provider_entity_id: record.providerEntityId,
    store_provider_id: source.providerStoreId,
    title: source.title,
    description: source.description,
    coupon_code: isCoupon ? source.code ?? null : null,
    coupon_type: isCoupon ? "code" : "deal",
    affiliate_url: source.trackingUrl,
    expiry_date: isoToDate(source.endDate ?? null),
    status: couponStatus(source.status),
    terms: isCoupon ? source.terms ?? null : null,
  };
}

export function buildPayload(plan: ImportPlan): Row {
  const categories = [...plan.categoriesToCreate, ...plan.categoriesToUpdate].map((r) => ({
    provider_entity_id: r.providerEntityId,
    name: r.source.name,
    slug: r.slug,
  }));

  const stores = [...plan.storesToCreate, ...plan.storesToUpdate].map((r) => ({
    provider_entity_id: r.providerEntityId,
    name: r.source.name,
    slug: r.slug,
    description: r.source.description,
    logo_url: r.source.logo,
    affiliate_url: r.source.website,
    category_provider_id: null,
  }));

  const coupons = [
    ...plan.couponsToCreate,
    ...plan.couponsToUpdate,
    ...plan.dealsToCreate,
    ...plan.dealsToUpdate,
  ].map(promotionRow);

  return { provider: plan.provider, categories, stores, coupons };
}

export interface ExecutionOutcome {
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
}

/** Executes the plan. Returns an outcome instead of throwing. */
export async function executePlan(plan: ImportPlan): Promise<ExecutionOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const payload = buildPayload(plan);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc("import_apply", { _payload: payload });

  if (error) {
    return { created: 0, updated: 0, skipped: 0, error: error.message ?? "import transaction failed" };
  }

  const result = (data ?? {}) as { created?: number; updated?: number; skipped?: number };
  return {
    created: result.created ?? 0,
    updated: result.updated ?? 0,
    skipped: result.skipped ?? 0,
    error: null,
  };
}

export const ImportExecutor = { buildPayload, executePlan };
