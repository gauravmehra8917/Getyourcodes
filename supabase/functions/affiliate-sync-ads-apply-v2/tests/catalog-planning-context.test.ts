import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdsCatalogPlanningContextV2,
  mapAdsCatalogPlanningContextV2,
} from "../catalog-planning-context.ts";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";

test("catalog mapper retains only exact namespace, parent, kind and slug evidence", () => {
  const result = mapAdsCatalogPlanningContextV2([
    {
      id: STORE_ID,
      slug: "campaign-store",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "Campaign-A",
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
      },
      {
        storeId: "33333333-3333-4333-8333-333333333333",
        slug: "manual-store",
        provider: null,
        providerEntityNamespace: null,
        providerEntityId: null,
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
      },
      {
        offerId: "44444444-4444-4444-8444-444444444444",
        storeId: STORE_ID,
        provider: "impact",
        providerEntityNamespace: "promotion",
        providerEntityId: "Ad-A",
        couponType: "code",
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes("coupon_code"), false);
  assert.equal(JSON.stringify(result).includes("description"), false);
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
  }));
  const offerRows: Row[] = [
    {
      id: "20000000-0000-4000-8000-000000000000",
      store_id: storeRows[0]!.id,
      provider: "impact",
      provider_entity_namespace: "ad",
      provider_entity_id: "Ad-A",
      coupon_type: "code",
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
      assert.equal(table === "stores" || table === "coupons", true);
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
  assert.equal(result.offers[0]?.providerEntityNamespace, "ad");
  const storeAudits = audit.filter((entry) => entry.table === "stores");
  const offerAudits = audit.filter((entry) => entry.table === "coupons");
  assert.equal(storeAudits.length, 4);
  assert.equal(offerAudits.length, 2);
  assert.equal(
    storeAudits[0]?.columns,
    "id,slug,provider,provider_entity_namespace,provider_entity_id",
  );
  assert.equal(
    offerAudits[0]?.columns,
    "id,store_id,provider,provider_entity_namespace,provider_entity_id,coupon_type",
  );
  assert.deepEqual(offerAudits[0]?.equals, [["provider", "impact"]]);
  assert.deepEqual(offerAudits[0]?.allowed, [[
    "provider_entity_namespace",
    ["ad", "legacy", "promotion"],
  ]]);
});
