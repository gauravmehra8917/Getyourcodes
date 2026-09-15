import type { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import type {
  AdsCatalogOfferFactV2,
  AdsCatalogPlanningContextV2,
  AdsCatalogStoreFactV2,
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-models.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const PAGE_SIZE = 1_000;
const INVALID_COUPON_CODES = new Set([
  "n/a",
  "none",
  "no code",
  "null",
  "undefined",
]);

export interface AdsCatalogStoreRowV2 {
  id: unknown;
  slug: unknown;
  provider: unknown;
  providerEntityNamespace: unknown;
  providerEntityId: unknown;

  /**
   * Ownership columns are optional at this raw mapper boundary so synthetic
   * callers that do not provide ownership evidence remain distinguishable
   * from a database row that explicitly contains NULL / false.
   */
  importOrigin?: unknown;
  lifecycleManaged?: unknown;

  affiliateUrl?: unknown;
  metadata?: unknown;
}

export interface AdsCatalogOfferRowV2 {
  id: unknown;
  storeId: unknown;
  provider: unknown;
  providerEntityNamespace: unknown;
  providerEntityId: unknown;
  couponType: unknown;
  couponCode?: unknown;
  affiliateUrl?: unknown;
  landingPageUrl?: unknown;
  startDate?: unknown;
  expiryDate?: unknown;
  status?: unknown;
  terms?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  structuredTerms?: unknown;
  metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function optionalExactText(value: unknown, code: string): string | null {
  return value === null || value === undefined ? null : exactText(value, code);
}

function nullableHttpUrl(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  const text = exactText(value, code);
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.origin === "null"
    ) throw new Error(code);
    return url.toString();
  } catch {
    throw new Error(code);
  }
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value;
}

function nullableIsoDate(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  const text = exactText(value, code);
  if (!validIsoDate(text)) throw new Error(code);
  return text;
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

function metadataRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function metadataText(
  metadata: Record<string, unknown>,
  key: string,
  code: string,
): string | null {
  return optionalExactText(metadata[key], code);
}

function storeOwnershipEvidence(
  row: AdsCatalogStoreRowV2,
): Pick<
  AdsCatalogStoreFactV2,
  "importOrigin" | "lifecycleManaged"
> | null {
  const hasImportOrigin =
    row.importOrigin !== undefined;

  const hasLifecycleManaged =
    row.lifecycleManaged !== undefined;

  if (hasImportOrigin !== hasLifecycleManaged) {
    throw new Error(
      "ads_catalog_store_ownership_evidence_partial",
    );
  }

  if (!hasImportOrigin) {
    return null;
  }

  if (
    row.importOrigin !== null &&
    row.importOrigin !== "provider"
  ) {
    throw new Error(
      "ads_catalog_store_import_origin_invalid",
    );
  }

  if (
    typeof row.lifecycleManaged !== "boolean"
  ) {
    throw new Error(
      "ads_catalog_store_lifecycle_managed_invalid",
    );
  }

  return {
    importOrigin: row.importOrigin,
    lifecycleManaged: row.lifecycleManaged,
  };
}

function managedStoreState(
  row: AdsCatalogStoreRowV2,
  provider: string | null,
  namespace: string | null,
): AdsProviderManagedStoreStateV2 | null {
  if (provider !== "impact" || namespace !== "campaign") return null;

  const metadata = metadataRecord(
    row.metadata,
    "ads_catalog_store_metadata_invalid",
  );

  return {
    affiliateUrl: nullableHttpUrl(
      row.affiliateUrl,
      "ads_catalog_store_affiliate_url_invalid",
    ),
    metadata: {
      advertiserId: metadataText(
        metadata,
        "advertiserId",
        "ads_catalog_store_advertiser_id_invalid",
      ),
      campaignId: metadataText(
        metadata,
        "campaignId",
        "ads_catalog_store_campaign_id_metadata_invalid",
      ),
      campaignName: metadataText(
        metadata,
        "campaignName",
        "ads_catalog_store_campaign_name_invalid",
      ),
      destinationUrl: nullableHttpUrl(
        metadata.destinationUrl,
        "ads_catalog_store_destination_url_invalid",
      ),
      trackingUrl: nullableHttpUrl(
        metadata.trackingUrl,
        "ads_catalog_store_tracking_url_invalid",
      ),
    },
  };
}

function nullableNonnegativeNumber(
  value: unknown,
  code: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) throw new Error(code);
  return value;
}

function structuredTerms(
  value: unknown,
): AdsProviderManagedOfferStateV2["structuredTerms"] {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error("ads_catalog_offer_structured_terms_invalid");
  }

  const minimumPurchase = nullableNonnegativeNumber(
    value.minimumPurchase,
    "ads_catalog_offer_minimum_purchase_invalid",
  );
  const maximumSavings = nullableNonnegativeNumber(
    value.maximumSavings,
    "ads_catalog_offer_maximum_savings_invalid",
  );
  const purchaseLimit = nullableNonnegativeNumber(
    value.purchaseLimit,
    "ads_catalog_offer_purchase_limit_invalid",
  );

  if (purchaseLimit !== null && purchaseLimit <= 0) {
    throw new Error("ads_catalog_offer_purchase_limit_invalid");
  }

  const currency = optionalExactText(
    value.currency,
    "ads_catalog_offer_currency_invalid",
  );

  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("ads_catalog_offer_currency_invalid");
  }

  return {
    minimumPurchase,
    maximumSavings,
    purchaseLimit,
    scope: optionalExactText(
      value.scope,
      "ads_catalog_offer_scope_invalid",
    ),
    currency,
    text: optionalExactText(
      value.text,
      "ads_catalog_offer_terms_text_invalid",
    ),
  };
}

function managedOfferState(
  row: AdsCatalogOfferRowV2,
  namespace: AdsCatalogOfferFactV2["providerEntityNamespace"],
): AdsProviderManagedOfferStateV2 | null {
  if (namespace !== "ad") return null;

  const couponCode = exactText(
    row.couponCode,
    "ads_catalog_offer_coupon_code_invalid",
  );

  if (INVALID_COUPON_CODES.has(couponCode.toLowerCase())) {
    throw new Error("ads_catalog_offer_coupon_code_invalid");
  }

  const startDate = nullableIsoDate(
    row.startDate,
    "ads_catalog_offer_start_date_invalid",
  );
  const expiryDate = nullableIsoDate(
    row.expiryDate,
    "ads_catalog_offer_expiry_date_invalid",
  );

  if (
    startDate !== null &&
    expiryDate !== null &&
    startDate > expiryDate
  ) {
    throw new Error("ads_catalog_offer_date_range_invalid");
  }

  if (
    row.status !== "active" &&
    row.status !== "expired" &&
    row.status !== "draft"
  ) {
    throw new Error("ads_catalog_offer_status_invalid");
  }

  const discountType =
    row.discountType === null || row.discountType === undefined
      ? null
      : row.discountType === "percentage" || row.discountType === "fixed"
        ? row.discountType
        : (() => {
            throw new Error("ads_catalog_offer_discount_type_invalid");
          })();

  const discountValue = nullableNonnegativeNumber(
    row.discountValue,
    "ads_catalog_offer_discount_value_invalid",
  );

  if ((discountType === null) !== (discountValue === null)) {
    throw new Error("ads_catalog_offer_discount_invalid");
  }

  const metadata = metadataRecord(
    row.metadata,
    "ads_catalog_offer_metadata_invalid",
  );

  return {
    couponCode,
    affiliateUrl: nullableHttpUrl(
      row.affiliateUrl,
      "ads_catalog_offer_affiliate_url_invalid",
    ),
    landingPageUrl: nullableHttpUrl(
      row.landingPageUrl,
      "ads_catalog_offer_landing_page_url_invalid",
    ),
    startDate,
    expiryDate,
    status: row.status,
    terms: optionalExactText(
      row.terms,
      "ads_catalog_offer_terms_invalid",
    ),
    discountType,
    discountValue,
    structuredTerms: structuredTerms(row.structuredTerms),
    metadata: {
      adId: metadataText(
        metadata,
        "adId",
        "ads_catalog_offer_ad_id_metadata_invalid",
      ),
      campaignId: metadataText(
        metadata,
        "campaignId",
        "ads_catalog_offer_campaign_id_metadata_invalid",
      ),
      advertiserId: metadataText(
        metadata,
        "advertiserId",
        "ads_catalog_offer_advertiser_id_invalid",
      ),
      dealId: metadataText(
        metadata,
        "dealId",
        "ads_catalog_offer_deal_id_invalid",
      ),
      campaignName: metadataText(
        metadata,
        "campaignName",
        "ads_catalog_offer_campaign_name_invalid",
      ),
      adName: metadataText(
        metadata,
        "adName",
        "ads_catalog_offer_ad_name_invalid",
      ),
      dealStartDate: metadataText(
        metadata,
        "dealStartDate",
        "ads_catalog_offer_deal_start_date_invalid",
      ),
      dealEndDate: metadataText(
        metadata,
        "dealEndDate",
        "ads_catalog_offer_deal_end_date_invalid",
      ),
      startDate: metadataText(
        metadata,
        "startDate",
        "ads_catalog_offer_provider_start_date_invalid",
      ),
      endDate: metadataText(
        metadata,
        "endDate",
        "ads_catalog_offer_provider_end_date_invalid",
      ),
    },
  };
}

/**
 * Maps exact identity plus bounded provider-owned refresh evidence.
 * Curated presentation fields and unrelated metadata are deliberately absent.
 */
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

    const ownership =
      storeOwnershipEvidence(row);

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
      ...(ownership ?? {}),
      providerManagedState: managedStoreState(row, provider, namespace),
    };
  });

  const offers: AdsCatalogOfferFactV2[] = offerRows.map((row) => {
    const namespace = exactOfferNamespace(row.providerEntityNamespace);

    return {
      offerId: exactText(row.id, "ads_catalog_offer_id_invalid"),
      storeId: exactText(row.storeId, "ads_catalog_offer_store_id_invalid"),
      provider: row.provider === "impact"
        ? "impact"
        : (() => {
            throw new Error("ads_catalog_offer_provider_invalid");
          })(),
      providerEntityNamespace: namespace,
      providerEntityId: exactText(
        row.providerEntityId,
        "ads_catalog_offer_provider_id_invalid",
      ),
      couponType: exactCouponType(row.couponType),
      providerManagedState: managedOfferState(row, namespace),
    };
  });

  return { stores, offers };
}

async function readAllStoreFacts(
  db: PrivilegedEdgeClient,
): Promise<AdsCatalogStoreRowV2[]> {
  const rows: AdsCatalogStoreRowV2[] = [];
  let afterId: string | null = null;

  for (;;) {
    let query = db.from("stores").select(
      "id,slug,provider,provider_entity_namespace,provider_entity_id,import_origin,lifecycle_managed,affiliate_url,metadata",
    );

    if (afterId !== null) query = query.gt("id", afterId);

    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

    if (error) throw new Error("ads_catalog_store_read_failed");

    const page = (data ?? []) as Row[];
    if (page.length === 0) break;

    rows.push(...page.map((row) => ({
      id: row.id,
      slug: row.slug,
      provider: row.provider,
      providerEntityNamespace: row.provider_entity_namespace,
      providerEntityId: row.provider_entity_id,
      importOrigin: row.import_origin,
      lifecycleManaged: row.lifecycle_managed,
      affiliateUrl: row.affiliate_url,
      metadata: row.metadata,
    })));

    const cursor = exactText(
      page[page.length - 1]?.id,
      "ads_catalog_store_id_invalid",
    );

    if (cursor === afterId) {
      throw new Error("ads_catalog_store_read_failed");
    }

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
    let query = db
      .from("coupons")
      .select(
        "id,store_id,provider,provider_entity_namespace,provider_entity_id,coupon_type,coupon_code,affiliate_url,landing_page_url,start_date,expiry_date,status,terms,discount_type,discount_value,structured_terms,metadata",
      )
      .eq("provider", "impact")
      .in(
        "provider_entity_namespace",
        ["ad", "legacy", "promotion"],
      )
      .not("provider_entity_id", "is", null);

    if (afterId !== null) query = query.gt("id", afterId);

    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

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
      couponCode: row.coupon_code,
      affiliateUrl: row.affiliate_url,
      landingPageUrl: row.landing_page_url,
      startDate: row.start_date,
      expiryDate: row.expiry_date,
      status: row.status,
      terms: row.terms,
      discountType: row.discount_type,
      discountValue: row.discount_value,
      structuredTerms: row.structured_terms,
      metadata: row.metadata,
    })));

    const cursor = exactText(
      page[page.length - 1]?.id,
      "ads_catalog_offer_id_invalid",
    );

    if (cursor === afterId) {
      throw new Error("ads_catalog_offer_read_failed");
    }

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
