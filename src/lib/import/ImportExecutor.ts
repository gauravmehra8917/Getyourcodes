// Stage 7 – transactional persistence. All writes happen inside one
// database routine (`public.import_apply`), so a failure rolls everything back.
//
// Phase 3A additions are presentation-only: enrichment fields are carried into
// the payload and deterministic SEO defaults are attached. The database applies
// SEO values ONLY to empty columns, so administrator edits are never lost.

import type { ImportPlan, PlannedRecord } from "./ImportPlan";
import type { CanonicalCoupon, CanonicalDeal, CanonicalStore } from "@/lib/normalizers";
import {
  couponCanonical,
  couponSeoDescription,
  couponSeoTitle,
  storeCanonical,
  storeSeoDescription,
  storeSeoTitle,
} from "@/lib/presentation/seo-templates";
import { resolveOfferStatus } from "@/lib/presentation/publishing";
import { generateTermsText } from "@/lib/presentation/terms";

type Row = Record<string, unknown>;

function isoToDate(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}


const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

/** Store reference keys a promotion may use, in preference order. */
function storeKeys(source: { providerStoreId: string | null; providerAdvertiserId?: string | null; providerCampaignId?: string | null }) {
  return [source.providerAdvertiserId, source.providerStoreId, source.providerCampaignId].filter(
    (v): v is string => !!v,
  );
}

interface StoreRef {
  slug: string | null;
  name: string;
}

function storeIndex(plan: ImportPlan): Map<string, StoreRef> {
  const index = new Map<string, StoreRef>();
  for (const r of [...plan.storesToCreate, ...plan.storesToUpdate]) {
    const ref: StoreRef = { slug: r.slug, name: r.source.name };
    const s = r.source;
    for (const key of [r.providerEntityId, s.providerStoreId, s.providerAdvertiserId, s.providerCampaignId]) {
      if (key) index.set(key, ref);
    }
  }
  return index;
}

function storeRow(record: PlannedRecord<CanonicalStore>): Row {
  const s = record.source;
  const meta = (s.metadata ?? {}) as Row;
  const shipping = strArray(meta.shippingRegions ?? meta.ShippingRegions);
  const seoTitle = storeSeoTitle(s.name);
  const seoDescription = storeSeoDescription(s.name);

  return {
    provider_entity_id: record.providerEntityId,
    name: s.name,
    slug: record.slug,
    description: s.description,
    logo_url: s.logo,
    logo_source_url: str(meta.originalLogo) ?? s.logo,
    affiliate_url: s.website,
    category_provider_id: null,
    country: s.country,
    shipping_regions: shipping,
    metadata: meta,
    seo_title: seoTitle,
    seo_description: seoDescription,
    seo_canonical_url: record.slug ? storeCanonical(record.slug) : null,
  };
}

function promotionRow(
  record: PlannedRecord<CanonicalCoupon> | PlannedRecord<CanonicalDeal>,
  stores: Map<string, StoreRef>,
): Row {
  const source = record.source as CanonicalCoupon & Partial<CanonicalDeal>;
  const isCoupon = record.entity === "coupon";
  const meta = (source.metadata ?? {}) as Row;

  const ref = storeKeys(source).map((k) => stores.get(k)).find(Boolean) ?? null;
  const storeName = ref?.name ?? str(meta.advertiserName) ?? "this store";
  const seoTitle = couponSeoTitle(source.title, storeName);
  const seoDescription = couponSeoDescription(source.title, storeName);

  return {
    provider_entity_id: record.providerEntityId,
    store_provider_id: source.providerStoreId,
    title: source.title,
    description: source.description,
    coupon_code: isCoupon ? (source.code ?? null) : null,
    coupon_type: isCoupon ? "code" : "deal",
    affiliate_url: source.trackingUrl,
    expiry_date: isoToDate(source.endDate ?? null),
    start_date: isoToDate(source.startDate ?? null),
    // Records that reach the executor already passed validation, so the
    // lifecycle window decides publication — no manual activation needed.
    status: resolveOfferStatus({
      providerStatus: source.status,
      startDate: source.startDate ?? null,
      endDate: source.endDate ?? null,
      valid: true,
      publiclyAvailable: meta.isPubliclyAvailable === false ? false : true,
    }),

    // Terms apply to codes and deals alike; generated deterministically from
    // provider values only (never AI, never invented).
    terms:
      source.terms ??
      generateTermsText(meta.structuredTerms ?? null, isoToDate(source.endDate ?? null)),
    discount_type: source.discountType ?? null,
    discount_value: source.discountValue ?? null,
    landing_page_url: str(meta.landingPageUrl),
    structured_terms: (meta.structuredTerms as Row | undefined) ?? null,

    metadata: meta,
    seo_title: seoTitle,
    seo_description: seoDescription,
    seo_canonical_url: ref?.slug ? couponCanonical(ref.slug, source.title) : null,
  };
}

export function buildPayload(plan: ImportPlan): Row {
  const categories = [...plan.categoriesToCreate, ...plan.categoriesToUpdate].map((r) => ({
    provider_entity_id: r.providerEntityId,
    name: r.source.name,
    slug: r.slug,
  }));

  const stores = [...plan.storesToCreate, ...plan.storesToUpdate].map(storeRow);
  const index = storeIndex(plan);

  const coupons = [
    ...plan.couponsToCreate,
    ...plan.couponsToUpdate,
    ...plan.dealsToCreate,
    ...plan.dealsToUpdate,
  ].map((r) => promotionRow(r, index));

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
