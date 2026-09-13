import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyCurrentOfferWindow,
  applyPublicOfferVisibility,
  currentUtcDate,
  excludeLifecycleHiddenStores,
  isCurrentlyValidOffer,
  isPublicStoreVisible,
  PUBLIC_STORE_VISIBILITY_FILTER,
} from "./catalog-visibility";

test("only lifecycle-managed hidden stores are excluded", () => {
  assert.equal(
    isPublicStoreVisible({
      lifecycle_managed: true,
      lifecycle_hidden: true,
    }),
    false,
  );
  assert.equal(
    isPublicStoreVisible({
      lifecycle_managed: true,
      lifecycle_hidden: false,
    }),
    true,
  );
  assert.equal(
    isPublicStoreVisible({
      lifecycle_managed: false,
      lifecycle_hidden: true,
    }),
    true,
  );
  assert.equal(
    isPublicStoreVisible({
      lifecycle_managed: null,
      lifecycle_hidden: null,
    }),
    true,
  );
});

test("public store filter is applied without changing unrelated query behavior", () => {
  const calls: string[] = [];
  const query = {
    or: (filter: string) => {
      calls.push(filter);
      return query;
    },
  };

  assert.equal(excludeLifecycleHiddenStores(query), query);
  assert.deepEqual(calls, [PUBLIC_STORE_VISIBILITY_FILTER]);
});

test("currentUtcDate uses the UTC calendar date", () => {
  assert.equal(
    currentUtcDate(new Date("2026-09-13T23:30:00-02:00")),
    "2026-09-14",
  );
});

test("current offer window applies exact start and expiry filters", () => {
  const calls: string[] = [];

  const query = {
    or: (filter: string) => {
      calls.push(filter);
      return query;
    },
  };

  assert.equal(applyCurrentOfferWindow(query, "2026-09-13"), query);

  assert.deepEqual(calls, [
    "start_date.is.null,start_date.lte.2026-09-13",
    "expiry_date.is.null,expiry_date.gte.2026-09-13",
  ]);
});

test("public offer visibility composes active, date window and parent-store visibility", () => {
  const calls: Array<
    | { method: "eq"; column: string; value: string }
    | {
        method: "or";
        filter: string;
        referencedTable?: string;
      }
  > = [];

  const query = {
    eq: (column: string, value: string) => {
      calls.push({ method: "eq", column, value });
      return query;
    },
    or: (
      filter: string,
      options?: {
        referencedTable?: string;
      },
    ) => {
      calls.push({
        method: "or",
        filter,
        referencedTable: options?.referencedTable,
      });
      return query;
    },
  };

  assert.equal(applyPublicOfferVisibility(query, "2026-09-13"), query);

  assert.deepEqual(calls, [
    {
      method: "eq",
      column: "status",
      value: "active",
    },
    {
      method: "or",
      filter: "start_date.is.null,start_date.lte.2026-09-13",
      referencedTable: undefined,
    },
    {
      method: "or",
      filter: "expiry_date.is.null,expiry_date.gte.2026-09-13",
      referencedTable: undefined,
    },
    {
      method: "or",
      filter: PUBLIC_STORE_VISIBILITY_FILTER,
      referencedTable: "stores",
    },
  ]);
});

test("current-offer predicate handles inclusive date boundaries", () => {
  const today = "2026-09-13";

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "active",
        start_date: null,
        expiry_date: null,
      },
      today,
    ),
    true,
  );

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "active",
        start_date: "2026-09-13",
        expiry_date: null,
      },
      today,
    ),
    true,
  );

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "active",
        start_date: "2026-09-14",
        expiry_date: null,
      },
      today,
    ),
    false,
  );

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "active",
        start_date: null,
        expiry_date: "2026-09-12",
      },
      today,
    ),
    false,
  );

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "active",
        start_date: null,
        expiry_date: "2026-09-13",
      },
      today,
    ),
    true,
  );

  assert.equal(
    isCurrentlyValidOffer(
      {
        status: "draft",
        start_date: null,
        expiry_date: null,
      },
      today,
    ),
    false,
  );
});

test("public catalog, sitemap, and AI store discovery use the visibility guard", () => {
  const files = [
    "./home-data.ts",
    "../routes/search.tsx",
    "../routes/$slug.tsx",
    "../routes/sitemap[.]xml.ts",
    "../routes/api/chat.ts",
    "../components/hero-search-results.tsx",
    "mcp/tools/search-stores.ts",
  ];

  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /excludeLifecycleHiddenStore/);
  }
});

test("every P0 public coupon surface uses the centralized public-offer guard", () => {
  const files = [
    "./home-data.ts",
    "../routes/index.tsx",
    "../routes/search.tsx",
    "../components/hero-search-results.tsx",
    "../components/global-deals-banner.tsx",
    "../components/recommended-for-you.tsx",
    "../routes/api/chat.ts",
    "mcp/tools/search-coupons.ts",
  ];

  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");

    assert.match(
      source,
      /applyPublicOfferVisibility/,
      `${relative} must use applyPublicOfferVisibility`,
    );
  }
});

test("store and category slug route guards both current dates and parent visibility", () => {
  const source = readFileSync(
    new URL("../routes/$slug.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /applyCurrentOfferWindow/,
    "store coupon loader must enforce the current date window",
  );

  assert.match(
    source,
    /applyPublicOfferVisibility/,
    "category coupon query must enforce full public offer visibility",
  );

  assert.match(
    source,
    /excludeLifecycleHiddenStores/,
    "store page itself must remain lifecycle guarded",
  );
});

test("full public offer surfaces use inner store relations", () => {
  const files = [
    "./home-data.ts",
    "../routes/index.tsx",
    "../routes/search.tsx",
    "../components/hero-search-results.tsx",
    "../components/global-deals-banner.tsx",
    "../components/recommended-for-you.tsx",
    "../routes/api/chat.ts",
    "mcp/tools/search-coupons.ts",
  ];

  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");

    assert.match(
      source,
      /stores!inner/,
      `${relative} must use an inner stores relation for lifecycle filtering`,
    );
  }
});
