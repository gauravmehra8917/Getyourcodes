import assert from "node:assert/strict";
import test from "node:test";
import { extractCampaignCategories, normalizeCategoryLabel } from "../taxonomy.ts";
import { planStoreCategories, summarizeCategoryPlan } from "../planner.ts";
import type { CategoryPlanningInput } from "../planner.ts";
import { parseCategoryCampaignPage } from "../campaign-client.ts";
import { malformedCampaigns, safeCampaigns } from "./fixtures/campaigns.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const CATEGORY = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const MAPPING = "44444444-4444-4444-8444-444444444444";

function facts(
  record: unknown = { CampaignId: "campaign-1", Category: "Fashion" },
): CategoryPlanningInput {
  return {
    campaigns: [extractCampaignCategories(record)],
    stores: [
      {
        id: STORE,
        provider: "impact",
        providerEntityNamespace: "campaign",
        providerEntityId: "campaign-1",
        categoryId: null,
      },
    ],
    categoryIds: [CATEGORY, OTHER],
    mappings: [
      {
        id: MAPPING,
        provider: "impact",
        normalizedProviderCategoryKey: "fashion",
        categoryId: CATEGORY,
        priority: 100,
        enabled: true,
      },
    ],
  };
}

test("normalization trims, lowercases and collapses whitespace deterministically", () => {
  assert.deepEqual(normalizeCategoryLabel("  Home\t &  Garden  "), {
    label: "Home\t &  Garden",
    key: "home & garden",
  });
  assert.equal(normalizeCategoryLabel("CAFÉ")?.key, "café");
  assert.notEqual(
    normalizeCategoryLabel("Home/Garden")?.key,
    normalizeCategoryLabel("Home Garden")?.key,
  );
  for (let i = 0; i < 10; i++) assert.equal(normalizeCategoryLabel("Fashion")?.key, "fashion");
  for (const bad of [true, 12, {}, [], " ", "---", "Fashion\u200b"])
    assert.equal(normalizeCategoryLabel(bad), null);
});

test("parser fixtures cover strings and string arrays in all four supported fields", () => {
  const parsed = parseCategoryCampaignPage(JSON.stringify({ Campaigns: safeCampaigns }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.records.length, 6);
  assert.deepEqual(
    parsed.records.map((record) => record.labels.map((label) => label.key)),
    [
      ["fashion"],
      ["clothing", "fashion"],
      ["home & garden"],
      ["hotels", "travel"],
      ["electronics"],
      [],
    ],
  );
  assert.equal(
    parsed.records.some((record) => record.invalid),
    false,
  );
  assert.equal(parsed.records[4]!.campaignId, "123");
});

test("page parser rejects malformed envelopes and unsafe continuation metadata", () => {
  for (const body of [
    "{",
    "null",
    "[]",
    "{}",
    '{"Campaigns":{}}',
    '{"Campaigns":[],"@nextpageuri":42}',
    '{"Campaigns":[],"@page":1,"@numpages":2}',
  ]) {
    assert.equal(parseCategoryCampaignPage(body).ok, false);
  }
});

test("exact Campaign identity resolves only the intended store", () => {
  const input = facts();
  input.stores = [
    ...input.stores,
    { ...input.stores[0]!, id: OTHER, providerEntityId: "campaign-10" },
  ];
  assert.deepEqual(planStoreCategories(input), [
    { action: "assign", storeId: STORE, categoryId: CATEGORY, campaignId: "campaign-1" },
  ]);
});

test("AdvertiserId alone never resolves a store", () => {
  assert.deepEqual(
    planStoreCategories(facts({ AdvertiserId: "campaign-1", Category: "Fashion" })),
    [{ action: "invalid_source" }],
  );
  assert.deepEqual(
    planStoreCategories(
      facts({ CampaignId: "unknown", AdvertiserId: "campaign-1", Category: "Fashion" }),
    ),
    [{ action: "unknown_store" }],
  );
});

test("names, domains, slugs and partial IDs never resolve a store", () => {
  assert.deepEqual(
    planStoreCategories(
      facts({
        CampaignId: "campaign",
        CampaignName: "Fashion",
        Name: "campaign-1",
        Url: "https://merchant.example",
        Slug: "campaign-1",
        Category: "Fashion",
      }),
    ),
    [{ action: "unknown_store" }],
  );
  for (const override of [
    { provider: "other" },
    { providerEntityNamespace: "advertiser" },
    { providerEntityId: "CAMPAIGN-1" },
  ]) {
    const input = facts();
    input.stores = [{ ...input.stores[0]!, ...override }];
    assert.deepEqual(planStoreCategories(input), [{ action: "unknown_store" }]);
  }
});

test("duplicate exact stores are held as ambiguous_store", () => {
  const input = facts();
  input.stores = [...input.stores, { ...input.stores[0]!, id: OTHER }];
  assert.deepEqual(planStoreCategories(input), [{ action: "ambiguous_store" }]);
});

test("non-null editorial category always wins, including disappeared or malformed taxonomy", () => {
  for (const record of [
    { CampaignId: "campaign-1" },
    { CampaignId: "campaign-1", Category: 42 },
    safeCampaigns[0],
  ]) {
    const input = facts(record);
    input.stores = [{ ...input.stores[0]!, categoryId: OTHER }];
    assert.deepEqual(planStoreCategories(input), [{ action: "noop_existing_category" }]);
  }
});

test("null category plus an exact enabled mapping is assignable; disabled/other provider rows are ignored", () => {
  const input = facts();
  assert.equal(planStoreCategories(input)[0]!.action, "assign");
  for (const override of [
    { enabled: false },
    { provider: "other" },
    { normalizedProviderCategoryKey: "Fashion" },
  ]) {
    input.mappings = [{ ...facts().mappings[0]!, ...override }];
    assert.deepEqual(planStoreCategories(input), [{ action: "unmapped" }]);
  }
});

test("unmapped and empty taxonomy never guess a category", () => {
  for (const record of [
    { CampaignId: "campaign-1", Category: "Unknown" },
    { CampaignId: "campaign-1", Name: "Fashion" },
  ]) {
    assert.deepEqual(planStoreCategories(facts(record)), [{ action: "unmapped" }]);
  }
});

test("multiple labels resolving to one target remain assignable", () => {
  const input = facts({ CampaignId: "campaign-1", Categories: ["Fashion", "Clothing"] });
  input.mappings = [
    ...input.mappings,
    { ...input.mappings[0]!, normalizedProviderCategoryKey: "clothing" },
  ];
  assert.equal(planStoreCategories(input)[0]!.action, "assign");
});

test("different targets tied at best priority are ambiguous regardless of order", () => {
  const input = facts({ CampaignId: "campaign-1", Categories: ["Fashion", "Clothing"] });
  input.mappings = [
    ...input.mappings,
    { ...input.mappings[0]!, normalizedProviderCategoryKey: "clothing", categoryId: OTHER },
  ];
  assert.deepEqual(planStoreCategories(input), [{ action: "ambiguous_mapping" }]);
  input.mappings = [...input.mappings].reverse();
  assert.deepEqual(planStoreCategories(input), [{ action: "ambiguous_mapping" }]);
});

test("lower numeric priority beats higher numeric priority", () => {
  const input = facts({ CampaignId: "campaign-1", Categories: ["Fashion", "Clothing"] });
  input.mappings = [
    ...input.mappings,
    {
      ...input.mappings[0]!,
      normalizedProviderCategoryKey: "clothing",
      categoryId: OTHER,
      priority: -1,
    },
  ];
  const decision = planStoreCategories(input)[0]!;
  assert.equal(decision.action, "assign");
  if (decision.action === "assign") assert.equal(decision.categoryId, OTHER);
});

test("every malformed provider fixture prevents assignment", () => {
  for (const record of malformedCampaigns)
    assert.equal(planStoreCategories(facts(record))[0]!.action, "invalid_source");
});

test("duplicate and equivalent labels do not affect the decision and facts are immutable", () => {
  const input = facts({
    CampaignId: "campaign-1",
    Category: "FASHION",
    Categories: [" fashion ", "Fashion", "Fashion"],
  });
  assert.equal(input.campaigns[0]!.labels.length, 1);
  const before = structuredClone(input);
  assert.deepEqual(planStoreCategories(input), planStoreCategories(facts()));
  assert.deepEqual(input, before);
});

test("duplicate Campaign records are held instead of arbitrarily choosing taxonomy", () => {
  const input = facts();
  input.campaigns = [
    ...input.campaigns,
    extractCampaignCategories({ CampaignId: "campaign-1", Category: "Other" }),
  ];
  assert.deepEqual(planStoreCategories(input), [
    { action: "invalid_source" },
    { action: "invalid_source" },
  ]);
});

test("unavailable categories and malformed mapping facts cannot fall through to a weaker target", () => {
  for (const override of [
    { categoryId: "missing" },
    { priority: NaN },
    { priority: 1.5 },
    { id: "bad" },
    { categoryId: "55555555-5555-4555-8555-555555555555" },
  ]) {
    const input = facts();
    input.mappings = [{ ...input.mappings[0]!, ...override }];
    assert.deepEqual(planStoreCategories(input), [{ action: "invalid_source" }]);
  }
});

test("summary is aggregate only and counts distinct normalized unmapped labels", () => {
  const input = facts({ CampaignId: "campaign-1", Categories: ["Unknown", "UNKNOWN"] });
  const summary = summarizeCategoryPlan(input, planStoreCategories(input));
  assert.deepEqual(summary, {
    campaignsEvaluated: 1,
    exactStoresMatched: 1,
    assignable: 0,
    alreadyCategorized: 0,
    unmapped: 1,
    ambiguous: 0,
    ambiguousMapping: 0,
    ambiguousStore: 0,
    unknownStore: 0,
    invalidSource: 0,
    distinctUnmappedLabels: 1,
  });
  assert.equal(JSON.stringify(summary).includes(STORE), false);
});
