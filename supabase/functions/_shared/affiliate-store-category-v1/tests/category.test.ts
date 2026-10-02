import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCampaignId,
  extractCampaignCategories,
  normalizeCategoryLabel,
} from "../taxonomy.ts";
import { toOpaqueAdProviderIdV2 } from "../../affiliate-sync-v2-ads/ad-models.ts";
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

test("summary counts distinct normalized unmapped labels and includes bounded observations", () => {
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
    unmappedLabels: [{ label: "UNKNOWN", key: "unknown", campaignCount: 1 }],
    unmappedLabelsTruncated: false,
  });
  assert.equal(JSON.stringify(summary).includes(STORE), false);
});

test("category Campaign canonicalization exactly matches the immutable Ads V2 helper", () => {
  for (const value of [
    "campaign-1",
    " \tcampaign-1\n",
    "",
    " \t\n",
    "CaseSensitive",
    "id with space",
    "x".repeat(300),
    123,
    0,
    -42,
    1.5,
    1e21,
    Number.MAX_VALUE,
    -0,
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    {},
    [],
    true,
  ]) {
    const expected = toOpaqueAdProviderIdV2(value);
    assert.equal(canonicalCampaignId(value), expected);
    assert.equal(
      extractCampaignCategories({ CampaignId: value, Category: "Fashion" }).campaignId,
      expected,
    );
  }
});

test("surrounding whitespace cannot cause Campaign/store identity drift", () => {
  const input = facts({ CampaignId: " \tcampaign-1\n", Category: "Fashion" });
  assert.equal(input.campaigns[0]!.campaignId, "campaign-1");
  assert.deepEqual(planStoreCategories(input), planStoreCategories(facts()));
  const parsed = parseCategoryCampaignPage(
    JSON.stringify({ Campaigns: [{ CampaignId: " campaign-1 ", Category: "Fashion" }] }),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.records[0]!.campaignId, "campaign-1");
});

test("all finite numeric identities use the Ads V2 canonical string for exact store matching", () => {
  for (const value of [123, 0, -42, 1.5, 1e21, Number.MAX_VALUE, -0]) {
    const input = facts({ CampaignId: value, Category: "Fashion" });
    input.stores = [{ ...input.stores[0]!, providerEntityId: toOpaqueAdProviderIdV2(value)! }];
    assert.equal(planStoreCategories(input)[0]!.action, "assign");
  }
});

function multipleCampaignFacts(records: readonly unknown[]): CategoryPlanningInput {
  const input = facts();
  input.campaigns = records.map(extractCampaignCategories);
  input.stores = input.campaigns.map((campaign, index) => ({
    ...input.stores[0]!,
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    providerEntityId: campaign.campaignId!,
  }));
  return input;
}

test("unmapped observations aggregate each key once per Campaign with a stable label and sort", () => {
  const records = [
    {
      CampaignId: "c1",
      Categories: [" travel ", "TRAVEL", "Travel"],
      Category: "Travel",
      Vertical: "Hotels",
    },
    { CampaignId: "c2", Categories: ["Travel", " hotels "] },
    { CampaignId: "c3", Category: "Books" },
  ];
  const input = multipleCampaignFacts(records);
  const before = structuredClone(input);
  const summary = summarizeCategoryPlan(input, planStoreCategories(input));
  assert.equal(summary.distinctUnmappedLabels, 3);
  assert.deepEqual(summary.unmappedLabels, [
    { label: "Books", key: "books", campaignCount: 1 },
    { label: "Hotels", key: "hotels", campaignCount: 2 },
    { label: "TRAVEL", key: "travel", campaignCount: 2 },
  ]);
  assert.equal(summary.unmappedLabelsTruncated, false);
  const reversed = multipleCampaignFacts([...records].reverse());
  assert.deepEqual(summarizeCategoryPlan(reversed, planStoreCategories(reversed)), summary);
  assert.deepEqual(input, before);
});

test("only unmapped decisions contribute observations; assigned, manual, unknown, invalid and ambiguous are excluded", () => {
  const input = multipleCampaignFacts([
    { CampaignId: "unmapped", Category: "Travel" },
    { CampaignId: "assigned", Categories: ["Fashion", "Other Label"] },
    { CampaignId: "manual", Category: "Manual Label" },
    { CampaignId: "unknown", Category: "Unknown Label" },
    { CampaignId: "invalid", Categories: ["Invalid Label", false] },
    { CampaignId: "ambiguous", Categories: ["Fashion", "Clothing"] },
  ]);
  input.stores = input.stores
    .filter((store) => store.providerEntityId !== "unknown")
    .map((store) =>
      store.providerEntityId === "manual" ? { ...store, categoryId: OTHER } : store,
    );
  input.mappings = [
    ...input.mappings,
    { ...input.mappings[0]!, normalizedProviderCategoryKey: "clothing", categoryId: OTHER },
  ];
  const decisions = planStoreCategories(input);
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    [
      "unmapped",
      "assign",
      "noop_existing_category",
      "unknown_store",
      "invalid_source",
      "ambiguous_mapping",
    ],
  );
  const summary = summarizeCategoryPlan(input, decisions);
  assert.equal(summary.distinctUnmappedLabels, 1);
  assert.deepEqual(summary.unmappedLabels, [{ label: "Travel", key: "travel", campaignCount: 1 }]);
});

test("unmapped list caps at 100 sorted keys while retaining the total distinct count", () => {
  for (const size of [99, 100, 101, 120]) {
    const records = Array.from({ length: size }, (_, i) => ({
      CampaignId: `c-${i}`,
      Category: `Label ${i.toString().padStart(3, "0")}`,
    }));
    const input = multipleCampaignFacts([...records].reverse());
    const summary = summarizeCategoryPlan(input, planStoreCategories(input));
    assert.equal(summary.distinctUnmappedLabels, size);
    assert.equal(summary.unmappedLabels.length, Math.min(100, size));
    assert.equal(summary.unmappedLabelsTruncated, size > 100);
    assert.equal(summary.unmappedLabels[0]!.key, "label 000");
    assert.equal(
      summary.unmappedLabels.at(-1)!.key,
      `label ${String(Math.min(100, size) - 1).padStart(3, "0")}`,
    );
  }
});

test("empty unmapped evidence always returns an empty list and false truncation", () => {
  for (const input of [
    facts(),
    facts({ CampaignId: "campaign-1" }),
    { ...facts(), campaigns: [], stores: [] },
  ]) {
    const summary = summarizeCategoryPlan(input, planStoreCategories(input));
    assert.deepEqual(summary.unmappedLabels, []);
    assert.equal(summary.unmappedLabelsTruncated, false);
    assert.equal(summary.distinctUnmappedLabels, 0);
  }
});

test("unmapped label/key sizes remain bounded by taxonomy validation", () => {
  const input = multipleCampaignFacts([
    { CampaignId: "bounded", Category: "İ".repeat(160) },
    { CampaignId: "oversized", Category: "x".repeat(161) },
  ]);
  const summary = summarizeCategoryPlan(input, planStoreCategories(input));
  assert.equal(summary.unmappedLabels.length, 1);
  assert.equal(summary.unmappedLabels[0]!.label.length, 160);
  assert.equal(summary.unmappedLabels[0]!.key.length, 320);
});
