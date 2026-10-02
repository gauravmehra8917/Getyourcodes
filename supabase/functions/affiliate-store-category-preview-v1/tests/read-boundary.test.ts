import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseCategoryPreviewDataSource } from "../supabase-read-boundary.ts";

type Row = Record<string, unknown>;
function id(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function fakeDb(tables: Record<string, Row[]>, serverCap = 500, error = false) {
  const operations: string[] = [];
  const db = {
    from(table: string) {
      operations.push(`from:${table}`);
      const filters: [string, unknown][] = [];
      let after: string | null = null;
      let limit = 500;
      const result = () => ({
        data: (tables[table] ?? [])
          .filter(
            (row) =>
              filters.every(([key, value]) => row[key] === value) &&
              (after === null || String(row.id) > after),
          )
          .slice(0, Math.min(limit, serverCap)),
        error: error ? { message: "SQL private detail" } : null,
      });
      const query = {
        select(columns: string) {
          operations.push(`select:${columns}`);
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        gt(key: string, value: string) {
          assert.equal(key, "id");
          after = value;
          return query;
        },
        order(key: string, options: unknown) {
          assert.equal(key, "id");
          assert.deepEqual(options, { ascending: true });
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        async maybeSingle() {
          const response = result();
          return { ...response, data: response.data[0] ?? null };
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
  };
  return {
    source: new SupabaseCategoryPreviewDataSource(
      db as unknown as ConstructorParameters<typeof SupabaseCategoryPreviewDataSource>[0],
    ),
    operations,
  };
}

test("bounded store reads select exact identity and current category, never merchant fallback fields", async () => {
  const { source, operations } = fakeDb({
    stores: [
      {
        id: id(1),
        provider: "impact",
        provider_entity_namespace: "campaign",
        provider_entity_id: "C01",
        category_id: null,
      },
      {
        id: id(2),
        provider: "impact",
        provider_entity_namespace: "advertiser",
        provider_entity_id: "C01",
        category_id: null,
      },
      {
        id: id(3),
        provider: "other",
        provider_entity_namespace: "campaign",
        provider_entity_id: "C01",
        category_id: null,
      },
    ],
  });
  assert.deepEqual(await source.readStores(), [
    {
      id: id(1),
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: "C01",
      categoryId: null,
    },
  ]);
  assert.ok(
    operations.includes(
      "select:id,provider,provider_entity_namespace,provider_entity_id,category_id",
    ),
  );
});

test("keyset reader continues past a server row cap instead of treating it as completion", async () => {
  const { source, operations } = fakeDb(
    { categories: Array.from({ length: 5 }, (_, index) => ({ id: id(index + 1) })) },
    2,
  );
  assert.equal((await source.readCategoryIds()).length, 5);
  assert.equal(operations.filter((op) => op === "from:categories").length, 4);
});

test("catalog row overflow is rejected rather than silently truncated", async () => {
  const { source } = fakeDb({
    categories: Array.from({ length: 10_001 }, (_, index) => ({ id: id(index + 1) })),
  });
  await assert.rejects(source.readCategoryIds(), /category_facts_limit_exceeded/);
});

test("missing/null facts, invalid UUIDs and read errors fail closed", async () => {
  for (const category_id of [undefined, "invalid"]) {
    const { source } = fakeDb({
      stores: [
        {
          id: id(1),
          provider: "impact",
          provider_entity_namespace: "campaign",
          provider_entity_id: "C01",
          category_id,
        },
      ],
    });
    await assert.rejects(source.readStores(), /invalid_read_fact/);
  }
  await assert.rejects(fakeDb({ categories: [{ id: "invalid" }] }).source.readCategoryIds());
  await assert.rejects(
    fakeDb({}, 500, true).source.readCategoryIds(),
    /category_facts_read_failed/,
  );
});

test("mapping reads are restricted to enabled Impact rows with valid integer priorities", async () => {
  const row = {
    id: id(1),
    provider: "impact",
    normalized_provider_category_key: "fashion",
    category_id: id(2),
    priority: 0,
    enabled: true,
  };
  const { source } = fakeDb({
    affiliate_store_category_mappings: [
      row,
      { ...row, id: id(3), provider: "other" },
      { ...row, id: id(4), enabled: false },
    ],
  });
  assert.deepEqual(await source.readMappings(), [
    {
      id: id(1),
      provider: "impact",
      normalizedProviderCategoryKey: "fashion",
      categoryId: id(2),
      priority: 0,
      enabled: true,
    },
  ]);
  await assert.rejects(
    fakeDb({
      affiliate_store_category_mappings: [{ ...row, priority: "0" }],
    }).source.readMappings(),
  );
});
