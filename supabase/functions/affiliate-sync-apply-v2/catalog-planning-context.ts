import type { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import type {
  ExistingCatalogSnapshotV2,
  KnownOfferKindV2,
  KnownStoreSlugV2,
  ProviderStoreKey,
} from "../_shared/affiliate-sync-v2/index.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const PAGE_SIZE = 1_000;

export interface CatalogPlanningStoreRowV2 {
  id: unknown;
  slug: unknown;
  provider: unknown;
  providerEntityId: unknown;
}

export interface CatalogPlanningOfferRowV2 {
  id: unknown;
  providerEntityId: unknown;
  couponType: unknown;
}

/** Minimum trusted catalog evidence required by preview and persistence planning. */
export interface CatalogPlanningContextV2 {
  existingCatalogSnapshot: ExistingCatalogSnapshotV2;
  knownStoreSlugs: readonly KnownStoreSlugV2[];
  knownOfferKinds: readonly KnownOfferKindV2[];
}

function exactNonemptyText(value: unknown, errorCode: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(errorCode);
  }
  return value;
}

function exactImpactStoreKey(
  provider: unknown,
  providerEntityId: unknown,
): ProviderStoreKey | null {
  if (provider !== "impact") return null;
  if (
    typeof providerEntityId !== "string" || providerEntityId.length === 0 ||
    providerEntityId.trim() !== providerEntityId
  ) {
    return null;
  }
  return {
    provider: "impact",
    namespace: "campaign",
    id: providerEntityId,
  };
}

function exactOfferKind(value: unknown): KnownOfferKindV2["kind"] {
  if (value === "code") return "coupon";
  if (value === "deal") return "deal";
  throw new Error("catalog_offer_kind_invalid");
}

/**
 * Preserves every exact duplicate identity and slug as blocker evidence. It
 * never adopts a store by slug or repairs/cross-casts provider identities.
 */
export function mapCatalogPlanningContextV2(
  storeRows: readonly CatalogPlanningStoreRowV2[],
  offerRows: readonly CatalogPlanningOfferRowV2[],
): CatalogPlanningContextV2 {
  const knownStoreSlugs: KnownStoreSlugV2[] = [];
  const snapshotStores: ExistingCatalogSnapshotV2["stores"] = [];

  for (const row of storeRows) {
    const storeId = exactNonemptyText(row.id, "catalog_store_id_invalid");
    const slug = exactNonemptyText(row.slug, "catalog_store_slug_invalid");
    const providerStoreKey = exactImpactStoreKey(
      row.provider,
      row.providerEntityId,
    );

    knownStoreSlugs.push({ storeId, slug, providerStoreKey });
    if (providerStoreKey) {
      snapshotStores.push({ id: storeId, providerStoreKey });
    }
  }

  const knownOfferKinds: KnownOfferKindV2[] = [];
  const snapshotOffers: ExistingCatalogSnapshotV2["offers"] = [];
  for (const row of offerRows) {
    const offerId = exactNonemptyText(row.id, "catalog_offer_id_invalid");
    if (
      typeof row.providerEntityId !== "string" ||
      row.providerEntityId.length === 0 ||
      row.providerEntityId.trim() !== row.providerEntityId
    ) {
      continue;
    }
    const promotionId = row.providerEntityId;
    const kind = exactOfferKind(row.couponType);
    knownOfferKinds.push({ offerId, promotionId, kind });
    snapshotOffers.push({ id: offerId, promotionId });
  }

  return {
    existingCatalogSnapshot: {
      stores: snapshotStores,
      offers: snapshotOffers,
    },
    knownStoreSlugs,
    knownOfferKinds,
  };
}

async function readAllStoreRows(
  db: PrivilegedEdgeClient,
): Promise<CatalogPlanningStoreRowV2[]> {
  const rows: CatalogPlanningStoreRowV2[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = db
      .from("stores")
      .select("id,slug,provider,provider_entity_id");
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error("catalog_store_read_failed");
    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    rows.push(...page.map((row) => ({
      id: row.id,
      slug: row.slug,
      provider: row.provider,
      providerEntityId: row.provider_entity_id,
    })));
    const nextAfterId = exactNonemptyText(
      page[page.length - 1]?.id,
      "catalog_store_id_invalid",
    );
    if (nextAfterId === afterId) throw new Error("catalog_store_read_failed");
    afterId = nextAfterId;
  }
  return rows;
}

async function readImpactOfferRows(
  db: PrivilegedEdgeClient,
): Promise<CatalogPlanningOfferRowV2[]> {
  const rows: CatalogPlanningOfferRowV2[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = db
      .from("coupons")
      .select("id,provider_entity_id,coupon_type")
      .eq("provider", "impact")
      .not("provider_entity_id", "is", null);
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error("catalog_offer_read_failed");
    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    rows.push(...page.map((row) => ({
      id: row.id,
      providerEntityId: row.provider_entity_id,
      couponType: row.coupon_type,
    })));
    const nextAfterId = exactNonemptyText(
      page[page.length - 1]?.id,
      "catalog_offer_id_invalid",
    );
    if (nextAfterId === afterId) throw new Error("catalog_offer_read_failed");
    afterId = nextAfterId;
  }
  return rows;
}

/** Performs read-only, fully paged catalog reads through the trusted client. */
export async function loadCatalogPlanningContextV2(
  db: PrivilegedEdgeClient,
): Promise<CatalogPlanningContextV2> {
  const [stores, offers] = await Promise.all([
    readAllStoreRows(db),
    readImpactOfferRows(db),
  ]);
  return mapCatalogPlanningContextV2(stores, offers);
}
