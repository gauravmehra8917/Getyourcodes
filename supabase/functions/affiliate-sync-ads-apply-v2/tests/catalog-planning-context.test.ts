import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdsCatalogPlanningContextV2,
  mapAdsCatalogPlanningContextV2,
} from "../catalog-planning-context.ts";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";

test("catalog mapper retains exact identity and bounded provider-managed state", () => {
  const result = mapAdsCatalogPlanningContextV2([
    {
      id: STORE_ID,
      slug: "campaign-store",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Campaign-A",
      affiliateUrl: "https://campaign.example/",
      metadata: {
        advertiserId: "Advertiser-A",
        campaignId: "Campaign-A",
        campaignName: "Campaign Store",
        destinationUrl: "https://campaign.example/",
        trackingUrl: "https://track.example/campaign",
        originalLogo: "/Mediapartners/SID/Campaigns/Campaign-A/Logo",
        logoSyncedFrom: "https://api.impact.com/logo",
        logoSyncedAt: "2026-09-15T00:00:00Z",
      },
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      slug: "manual-store",
      provider: null,
      providerEntityNamespace: null,
      providerEntityId: null,
    },
  ], [
    {
      id: OFFER_ID,
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: "Ad-A",
      couponType: "code",
      couponCode: "SAVE20",
      affiliateUrl: "https://track.example/ad",
      landingPageUrl: "https://campaign.example/coupon",
      startDate: "2026-09-01",
      expiryDate: "2026-12-31",
      status: "active",
      terms: "Provider terms",
      discountType: "percentage",
      discountValue: 20,
      structuredTerms: {
        minimumPurchase: 50,
        maximumSavings: 20,
        purchaseLimit: 1,
        scope: "Sitewide",
        currency: "USD",
        text: null,
      },
      metadata: {
        adId: "Ad-A",
        campaignId: "Campaign-A",
        advertiserId: "Advertiser-A",
        dealId: "Deal-A",
        campaignName: "Campaign Store",
        adName: "Provider Ad",
        dealStartDate: "2026-09-01T00:00:00Z",
        dealEndDate: "2026-12-31T23:59:59Z",
        startDate: "2026-08-01",
        endDate: "2027-01-31",
        manualNote: "must not enter managed snapshot",
      },
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "promotion",
      providerEntityId: "Ad-A",
      couponType: "code",
    },
  ]);

  assert.deepEqual(result, {
    stores: [
      {
        storeId: STORE_ID,
        slug: "campaign-store",
        provider: "impact",
        providerEntityNamespace: "campaign",
        providerEntityId: "Campaign-A",
        providerManagedState: {
          affiliateUrl: "https://campaign.example/",
          metadata: {
            advertiserId: "Advertiser-A",
            campaignId: "Campaign-A",
            campaignName: "Campaign Store",
            destinationUrl: "https://campaign.example/",
            trackingUrl: "https://track.example/campaign",
          },
        },
      },
      {
        storeId: "33333333-3333-4333-8333-333333333333",
        slug: "manual-store",
        provider: null,
        providerEntityNamespace: null,
        providerEntityId: null,
        providerManagedState: null,
      },
    ],
    offers: [
      {
        offerId: OFFER_ID,
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: "Ad-A",
        couponType: "code",
        providerManagedState: {
          couponCode: "SAVE20",
          affiliateUrl: "https://track.example/ad",
          landingPageUrl: "https://campaign.example/coupon",
          startDate: "2026-09-01",
          expiryDate: "2026-12-31",
          status: "active",
          terms: "Provider terms",
          discountType: "percentage",
          discountValue: 20,
          structuredTerms: {
            minimumPurchase: 50,
            maximumSavings: 20,
            purchaseLimit: 1,
            scope: "Sitewide",
            currency: "USD",
            text: null,
          },
          metadata: {
            adId: "Ad-A",
            campaignId: "Campaign-A",
            advertiserId: "Advertiser-A",
            dealId: "Deal-A",
            campaignName: "Campaign Store",
            adName: "Provider Ad",
            dealStartDate: "2026-09-01T00:00:00Z",
            dealEndDate: "2026-12-31T23:59:59Z",
            startDate: "2026-08-01",
            endDate: "2027-01-31",
          },
        },
      },
      {
        offerId: "44444444-4444-4444-8444-444444444444",
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "promotion",
        providerEntityId: "Ad-A",
        couponType: "code",
        providerManagedState: null,
      },
    ],
  });

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("originalLogo"), false);
  assert.equal(serialized.includes("logoSyncedFrom"), false);
  assert.equal(serialized.includes("logoSyncedAt"), false);
  assert.equal(serialized.includes("manualNote"), false);
  assert.equal(serialized.includes("description"), false);
  assert.equal(serialized.includes("seo_title"), false);
});

test("catalog mapper fails closed for partial or malformed identities", () => {
  assert.throws(() =>
    mapAdsCatalogPlanningContextV2([{
      id: STORE_ID,
      slug: "campaign-store",
      provider: "impact",
      providerEntityNamespace: null,
      providerEntityId: "Campaign-A",
    }], [])
  );
  assert.throws(() =>
    mapAdsCatalogPlanningContextV2([], [{
      id: OFFER_ID,
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Ad-A",
      couponType: "code",
    }])
  );
  assert.throws(() =>
    mapAdsCatalogPlanningContextV2([], [{
      id: OFFER_ID,
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: "Ad-A",
      couponType: "unexpected",
    }])
  );
});


test("historical Campaign rows may lack duplicated campaignId metadata", () => {
  const result = mapAdsCatalogPlanningContextV2([{
    id: STORE_ID,
    slug: "historical-campaign",
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: "Campaign-A",
    affiliateUrl: "https://campaign.example/",
    metadata: {
      advertiserId: "Advertiser-A",
      campaignName: "Historical Campaign",
    },
  }], []);

  assert.equal(
    result.stores[0]?.providerManagedState?.metadata.campaignId,
    null,
  );

  assert.equal(
    result.stores[0]?.providerEntityId,
    "Campaign-A",
  );
});

test("catalog mapper fails closed for malformed managed state", () => {
  assert.throws(() =>
    mapAdsCatalogPlanningContextV2([{
      id: STORE_ID,
      slug: "campaign-store",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Campaign-A",
      affiliateUrl: "javascript:alert(1)",
      metadata: {},
    }], [])
  );

  assert.throws(() =>
    mapAdsCatalogPlanningContextV2([], [{
      id: OFFER_ID,
      storeId: STORE_ID,
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: "Ad-A",
      couponType: "code",
      couponCode: "SAVE20",
      affiliateUrl: null,
      landingPageUrl: null,
      startDate: null,
      expiryDate: null,
      status: "unexpected",
      terms: null,
      discountType: null,
      discountValue: null,
      structuredTerms: null,
      metadata: {},
    }])
  );
});

type Row = Record<string, unknown> & { id: string };

class Query {
  private readonly table: "stores" | "coupons";
  private readonly rows: readonly Row[];
  private readonly audit: Array<Record<string, unknown>>;
  private readonly serverCap: number;
  private columns = "";
  private after: string | null = null;
  private equals: Array<[string, unknown]> = [];
  private allowed: Array<[string, readonly unknown[]]> = [];
  private nonnull: string[] = [];
  private ascending = false;
  private orderColumn = "";
  private requestedLimit = 0;

  constructor(
    table: "stores" | "coupons",
    rows: readonly Row[],
    audit: Array<Record<string, unknown>>,
    serverCap: number,
  ) {
    this.table = table;
    this.rows = rows;
    this.audit = audit;
    this.serverCap = serverCap;
  }

  select(columns: string): this {
    this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.equals.push([column, value]);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.allowed.push([column, values]);
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    assert.equal(operator, "is");
    assert.equal(value, null);
    this.nonnull.push(column);
    return this;
  }
  gt(column: string, value: string): this {
    assert.equal(column, "id");
    this.after = value;
    return this;
  }
  order(column: string, options: { ascending: boolean }): this {
    this.orderColumn = column;
    this.ascending = options.ascending;
    return this;
  }
  limit(value: number): this {
    this.requestedLimit = value;
    return this;
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: Row[]; error: null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  private async execute(): Promise<{ data: Row[]; error: null }> {
    assert.equal(this.orderColumn, "id");
    assert.equal(this.ascending, true);
    assert.equal(this.requestedLimit, 1_000);
    let page = [...this.rows];
    for (const [key, value] of this.equals) {
      page = page.filter((row) => row[key] === value);
    }
    for (const [key, values] of this.allowed) {
      page = page.filter((row) => values.includes(row[key]));
    }
    for (const key of this.nonnull) {
      page = page.filter((row) => row[key] !== null);
    }
    if (this.after !== null) page = page.filter((row) => row.id > this.after!);
    page.sort((left, right) => left.id.localeCompare(right.id));
    page = page.slice(0, this.serverCap);
    this.audit.push({
      table: this.table,
      columns: this.columns,
      after: this.after,
      equals: this.equals,
      allowed: this.allowed,
      nonnull: this.nonnull,
      ids: page.map((row) => row.id),
    });
    return { data: page.map((row) => ({ ...row })), error: null };
  }
}

test("catalog loader is fully keyset-paged and reads only bounded planning columns", async () => {
  const storeRows: Row[] = [0, 1, 2].map((number) => ({
    id: `10000000-0000-4000-8000-${number.toString().padStart(12, "0")}`,
    slug: `store-${number}`,
    provider: number === 2 ? null : "impact",
    provider_entity_namespace: number === 2
      ? null
      : number === 1
      ? "legacy"
      : "campaign",
    provider_entity_id: number === 2 ? null : `Campaign-${number}`,
    import_origin: number === 2 ? null : "provider",
    lifecycle_managed: number !== 2,
    affiliate_url: number === 0 ? "https://campaign.example/" : null,
    metadata: number === 0
      ? {
          advertiserId: "Advertiser-A",
          campaignId: "Campaign-0",
          campaignName: "Campaign 0",
          destinationUrl: "https://campaign.example/",
          trackingUrl: "https://track.example/campaign",
        }
      : {},
  }));

  const offerRows: Row[] = [
    {
      id: "20000000-0000-4000-8000-000000000000",
      store_id: storeRows[0]!.id,
      provider: "impact",
      provider_entity_namespace: "ad",
      provider_entity_id: "Ad-A",
      coupon_type: "code",
      coupon_code: "SAVE20",
      affiliate_url: "https://track.example/ad",
      landing_page_url: "https://campaign.example/coupon",
      start_date: "2026-09-01",
      expiry_date: "2026-12-31",
      status: "active",
      terms: "Provider terms",
      discount_type: "percentage",
      discount_value: 20,
      structured_terms: {
        minimumPurchase: 50,
        maximumSavings: 20,
        purchaseLimit: 1,
        scope: "Sitewide",
        currency: "USD",
        text: null,
      },
      metadata: {
        adId: "Ad-A",
        campaignId: "Campaign-0",
        advertiserId: "Advertiser-A",
        dealId: "Deal-A",
        campaignName: "Campaign 0",
        adName: "Provider Ad",
        dealStartDate: "2026-09-01T00:00:00Z",
        dealEndDate: "2026-12-31T23:59:59Z",
        startDate: "2026-08-01",
        endDate: "2027-01-31",
      },
    },
    {
      id: "20000000-0000-4000-8000-000000000001",
      store_id: storeRows[0]!.id,
      provider: "other",
      provider_entity_namespace: "ad",
      provider_entity_id: "Other-Ad",
      coupon_type: "code",
    },
  ];

  const audit: Array<Record<string, unknown>> = [];

  const db = {
    from(table: string) {
      assert.equal(
        table === "stores" || table === "coupons",
        true,
      );

      return new Query(
        table as "stores" | "coupons",
        table === "stores" ? storeRows : offerRows,
        audit,
        1,
      );
    },
  };

  const result = await loadAdsCatalogPlanningContextV2(db as never);

  assert.equal(result.stores.length, 3);
  assert.equal(result.offers.length, 1);

  assert.equal(
    result.stores[0]?.importOrigin,
    "provider",
  );

  assert.equal(
    result.stores[0]?.lifecycleManaged,
    true,
  );

  assert.equal(
    result.stores[2]?.importOrigin,
    null,
  );

  assert.equal(
    result.stores[2]?.lifecycleManaged,
    false,
  );
  assert.equal(
    result.stores[0]?.providerManagedState?.metadata.campaignId,
    "Campaign-0",
  );
  assert.equal(
    result.offers[0]?.providerManagedState?.couponCode,
    "SAVE20",
  );
  assert.equal(
    result.offers[0]?.providerEntityNamespace,
    "ad",
  );

  const storeAudits = audit.filter(
    (entry) => entry.table === "stores",
  );

  const offerAudits = audit.filter(
    (entry) => entry.table === "coupons",
  );

  assert.equal(storeAudits.length, 4);
  assert.equal(offerAudits.length, 2);

  assert.equal(
    storeAudits[0]?.columns,
    "id,slug,provider,provider_entity_namespace,provider_entity_id,import_origin,lifecycle_managed,affiliate_url,metadata",
  );

  assert.equal(
    offerAudits[0]?.columns,
    "id,store_id,provider,provider_entity_namespace,provider_entity_id,coupon_type,coupon_code,affiliate_url,landing_page_url,start_date,expiry_date,status,terms,discount_type,discount_value,structured_terms,metadata",
  );

  assert.deepEqual(
    offerAudits[0]?.equals,
    [["provider", "impact"]],
  );

  assert.deepEqual(
    offerAudits[0]?.allowed,
    [[
      "provider_entity_namespace",
      ["ad", "legacy", "promotion"],
    ]],
  );
});
test("catalog mapper retains ownership evidence and rejects malformed ownership evidence", () => {
  const mapped = mapAdsCatalogPlanningContextV2([
    {
      id: STORE_ID,
      slug: "provider-campaign",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Campaign-A",
      importOrigin: "provider",
      lifecycleManaged: true,
      affiliateUrl: null,
      metadata: {},
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      slug: "manual-store",
      provider: null,
      providerEntityNamespace: null,
      providerEntityId: null,
      importOrigin: null,
      lifecycleManaged: false,
    },
  ], []);

  assert.equal(
    mapped.stores[0]?.importOrigin,
    "provider",
  );

  assert.equal(
    mapped.stores[0]?.lifecycleManaged,
    true,
  );

  assert.equal(
    mapped.stores[1]?.importOrigin,
    null,
  );

  assert.equal(
    mapped.stores[1]?.lifecycleManaged,
    false,
  );

  assert.throws(
    () =>
      mapAdsCatalogPlanningContextV2([
        {
          id: STORE_ID,
          slug: "partial-ownership",
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: "Campaign-A",
          importOrigin: "provider",
          metadata: {},
        },
      ], []),
    /ads_catalog_store_ownership_evidence_partial/,
  );

  assert.throws(
    () =>
      mapAdsCatalogPlanningContextV2([
        {
          id: STORE_ID,
          slug: "invalid-origin",
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: "Campaign-A",
          importOrigin: "manual",
          lifecycleManaged: false,
          metadata: {},
        },
      ], []),
    /ads_catalog_store_import_origin_invalid/,
  );

  assert.throws(
    () =>
      mapAdsCatalogPlanningContextV2([
        {
          id: STORE_ID,
          slug: "invalid-lifecycle",
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: "Campaign-A",
          importOrigin: "provider",
          lifecycleManaged: "true",
          metadata: {},
        },
      ], []),
    /ads_catalog_store_lifecycle_managed_invalid/,
  );
});
