import type { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import type {
  AdsCatalogOfferFactV2,
  AdsCatalogPlanningContextV2,
  AdsCatalogStoreFactV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-models.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const PAGE_SIZE = 1_000;

export interface AdsCatalogStoreRowV2 {
  id: unknown;
  slug: unknown;
  provider: unknown;
  providerEntityNamespace: unknown;
  providerEntityId: unknown;
}

export interface AdsCatalogOfferRowV2 {
  id: unknown;
  storeId: unknown;
  provider: unknown;
  providerEntityNamespace: unknown;
  providerEntityId: unknown;
  couponType: unknown;
}

function exactText(value: unknown, code: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim()
  ) throw new Error(code);
  return value;
}

function nullableExactText(value: unknown, code: string): string | null {
  return value === null ? null : exactText(value, code);
}

function exactOfferNamespace(
  value: unknown,
): AdsCatalogOfferFactV2["providerEntityNamespace"] {
  if (value === "ad" || value === "legacy" || value === "promotion") {
    return value;
  }
  throw new Error("ads_catalog_offer_namespace_invalid");
}

function exactCouponType(
  value: unknown,
): AdsCatalogOfferFactV2["couponType"] {
  if (value === "code" || value === "deal") return value;
  throw new Error("ads_catalog_offer_kind_invalid");
}

/** Maps only identity/slug evidence. No catalog presentation content is read. */
export function mapAdsCatalogPlanningContextV2(
  storeRows: readonly AdsCatalogStoreRowV2[],
  offerRows: readonly AdsCatalogOfferRowV2[],
): AdsCatalogPlanningContextV2 {
  const stores: AdsCatalogStoreFactV2[] = storeRows.map((row) => {
    const provider = nullableExactText(
      row.provider,
      "ads_catalog_store_provider_invalid",
    );
    const namespace = nullableExactText(
      row.providerEntityNamespace,
      "ads_catalog_store_namespace_invalid",
    );
    const providerId = nullableExactText(
      row.providerEntityId,
      "ads_catalog_store_provider_id_invalid",
    );
    if (
      (provider === null) !== (namespace === null) ||
      (provider === null) !== (providerId === null)
    ) throw new Error("ads_catalog_store_partial_identity");
    return {
      storeId: exactText(row.id, "ads_catalog_store_id_invalid"),
      slug: exactText(row.slug, "ads_catalog_store_slug_invalid"),
      provider,
      providerEntityNamespace: namespace,
      providerEntityId: providerId,
    };
  });

  const offers: AdsCatalogOfferFactV2[] = offerRows.map((row) => ({
    offerId: exactText(row.id, "ads_catalog_offer_id_invalid"),
    storeId: exactText(row.storeId, "ads_catalog_offer_store_id_invalid"),
    provider: row.provider === "impact" ? "impact" : (() => {
      throw new Error("ads_catalog_offer_provider_invalid");
    })(),
    providerEntityNamespace: exactOfferNamespace(row.providerEntityNamespace),
    providerEntityId: exactText(
      row.providerEntityId,
      "ads_catalog_offer_provider_id_invalid",
    ),
    couponType: exactCouponType(row.couponType),
  }));

  return { stores, offers };
}

async function readAllStoreFacts(
  db: PrivilegedEdgeClient,
): Promise<AdsCatalogStoreRowV2[]> {
  const rows: AdsCatalogStoreRowV2[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = db.from("stores").select(
      "id,slug,provider,provider_entity_namespace,provider_entity_id",
    );
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query.order("id", { ascending: true }).limit(
      PAGE_SIZE,
    );
    if (error) throw new Error("ads_catalog_store_read_failed");
    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    rows.push(...page.map((row) => ({
      id: row.id,
      slug: row.slug,
      provider: row.provider,
      providerEntityNamespace: row.provider_entity_namespace,
      providerEntityId: row.provider_entity_id,
    })));
    const cursor = exactText(
      page[page.length - 1]?.id,
      "ads_catalog_store_id_invalid",
    );
    if (cursor === afterId) throw new Error("ads_catalog_store_read_failed");
    afterId = cursor;
  }
  return rows;
}

async function readImpactOfferFacts(
  db: PrivilegedEdgeClient,
): Promise<AdsCatalogOfferRowV2[]> {
  const rows: AdsCatalogOfferRowV2[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = db.from("coupons").select(
      "id,store_id,provider,provider_entity_namespace,provider_entity_id,coupon_type",
    ).eq("provider", "impact").in(
      "provider_entity_namespace",
      ["ad", "legacy", "promotion"],
    ).not("provider_entity_id", "is", null);
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query.order("id", { ascending: true }).limit(
      PAGE_SIZE,
    );
    if (error) throw new Error("ads_catalog_offer_read_failed");
    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    rows.push(...page.map((row) => ({
      id: row.id,
      storeId: row.store_id,
      provider: row.provider,
      providerEntityNamespace: row.provider_entity_namespace,
      providerEntityId: row.provider_entity_id,
      couponType: row.coupon_type,
    })));
    const cursor = exactText(
      page[page.length - 1]?.id,
      "ads_catalog_offer_id_invalid",
    );
    if (cursor === afterId) throw new Error("ads_catalog_offer_read_failed");
    afterId = cursor;
  }
  return rows;
}

/** Fully paged, read-only snapshot for exact Ads persistence planning. */
export async function loadAdsCatalogPlanningContextV2(
  db: PrivilegedEdgeClient,
): Promise<AdsCatalogPlanningContextV2> {
  const [stores, offers] = await Promise.all([
    readAllStoreFacts(db),
    readImpactOfferFacts(db),
  ]);
  return mapAdsCatalogPlanningContextV2(stores, offers);
}
