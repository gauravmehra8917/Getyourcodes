import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
} from "@/lib/normalizers";
import type { SyncResult } from "@/lib/sync";
import { buildPayload, ImportExecutor } from "./ImportExecutor";
import {
  emptyPlan,
  hasPlanWork,
  type ImportPlan,
  type StoreCandidate,
  type StoreLifecycleDecision,
} from "./ImportPlan";
import { runImport } from "./ImportPipeline";

const store: CanonicalStore = {
  provider: "test",
  providerStoreId: "merchant",
  providerAdvertiserId: null,
  providerCampaignId: null,
  name: "Merchant",
  description: null,
  website: "https://merchant.test",
  logo: null,
  categories: [],
  country: null,
  status: "active",
  commission: null,
  metadata: {},
};

const candidate = (existingId: string | null = null): StoreCandidate => ({
  entity: "store",
  action: existingId ? "update" : "create",
  providerEntityId: "merchant",
  existingId,
  slug: "merchant",
  source: store,
  existingLifecycleManaged: existingId !== null,
  existingLifecycleHidden: false,
});

const decision = (
  action: StoreLifecycleDecision["action"],
  existingId: string | null = action === "create_store" ? null : "store-id",
): StoreLifecycleDecision => ({
  action,
  providerEntityId: "merchant",
  candidate: candidate(existingId),
  qualification: {
    qualified: action !== "hold_store" && action !== "lifecycle_hide_store",
    reason: action === "hold_store" || action === "lifecycle_hide_store"
      ? "insufficient_publishable_offers"
      : "qualified_coupon_threshold",
    eligibleCoupons: 2,
    eligibleDeals: 0,
    selectedCoupons: 1,
    selectedDeals: 0,
  },
});

const planWith = (...decisions: StoreLifecycleDecision[]): ImportPlan => {
  const plan = emptyPlan("test", "integration");
  plan.storeLifecycle = decisions;
  return plan;
};

test("serializes every writable lifecycle action and excludes holds", () => {
  for (const action of [
    "create_store",
    "update_store",
    "lifecycle_hide_store",
    "lifecycle_republish_store",
  ] as const) {
    const payload = buildPayload(planWith(decision(action)));
    assert.equal(payload.store_lifecycle[0]?.action, action);
    assert.equal(payload.store_lifecycle[0]?.providerEntityId, "merchant");
    assert.equal(payload.store_lifecycle[0]?.existingId, action === "create_store" ? null : "store-id");
    assert.equal(payload.store_lifecycle[0]?.slug, "merchant");
    assert.equal(payload.store_lifecycle[0]?.source, store);
    assert.equal(payload.store_lifecycle[0]?.qualification.eligibleCoupons, 2);
  }

  const held = buildPayload(planWith(decision("hold_store")));
  assert.deepEqual(held.store_lifecycle, []);
  assert.deepEqual(held.stores, []);
});

test("legacy store arrays cannot bypass lifecycle holds or run-work detection", () => {
  const plan = planWith(decision("hold_store"));
  plan.storesToCreate.push(candidate());
  plan.storesToUpdate.push(candidate("store-id"));

  assert.deepEqual(buildPayload(plan).store_lifecycle, []);
  assert.deepEqual(buildPayload(plan).stores, []);
  assert.equal(hasPlanWork(plan), false);

  assert.equal(hasPlanWork(planWith(decision("lifecycle_hide_store"))), true);
  assert.equal(hasPlanWork(planWith(decision("lifecycle_republish_store"))), true);
});

test("category and promotion payloads remain unchanged", () => {
  const plan = planWith();
  const category: CanonicalCategory = {
    provider: "test", providerCategoryId: "category", name: "Category", parentId: null, metadata: {},
  };
  const coupon: CanonicalCoupon = {
    provider: "test", providerCouponId: "coupon", providerStoreId: "merchant",
    providerAdvertiserId: null, providerCampaignId: null, title: "Coupon", description: null,
    code: "SAVE", discountType: "percentage", discountValue: 10, startDate: null, endDate: null,
    trackingUrl: null, terms: null, status: "active", metadata: {},
  };
  const deal: CanonicalDeal = {
    provider: "test", providerDealId: "deal", providerStoreId: "merchant",
    providerAdvertiserId: null, providerCampaignId: null, title: "Deal", description: null,
    trackingUrl: null, startDate: null, endDate: null, status: "active", metadata: {},
  };
  plan.categoriesToCreate.push({
    entity: "category", action: "create", providerEntityId: "category", existingId: null, slug: "category", source: category,
  });
  plan.couponsToCreate.push({
    entity: "coupon", action: "create", providerEntityId: "coupon", existingId: null, slug: null, source: coupon,
  });
  plan.dealsToCreate.push({
    entity: "deal", action: "create", providerEntityId: "deal", existingId: null, slug: null, source: deal,
  });

  const payload = buildPayload(plan);
  assert.equal(payload.categories.length, 1);
  assert.equal(payload.coupons.length, 2);
  assert.equal(payload.coupons[0]?.provider_entity_id, "coupon");
  assert.equal(payload.coupons[1]?.provider_entity_id, "deal");
});

test("preview never invokes the executor", async () => {
  const original = ImportExecutor.executePlan;
  let calls = 0;
  ImportExecutor.executePlan = async () => {
    calls++;
    return { created: 0, updated: 0, skipped: 0, error: null };
  };

  try {
    const sync = {
      provider: "test",
      integrationId: "integration",
      startedAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:00:00.000Z",
      entityTypes: ["category"],
      stores: [],
      coupons: [],
      deals: [],
      categories: [{
        provider: "test", providerCategoryId: "category", name: "Category", parentId: null, metadata: {},
      }],
      statistics: null,
      progress: {
        provider: "test", integrationId: "integration", currentEntity: null, currentPage: 0,
        totalPages: null, recordsFetched: 0, recordsNormalized: 0, elapsedMs: 0, status: "completed",
      },
      warnings: [],
      errors: [],
      orchestration: {
        strategy: "incremental", pagesCrawled: 0, apiCallsUsed: 0, recordsFetched: 0,
        newProviderIdentitiesDiscovered: 0, existingProviderIdentitiesEncountered: 0, stopReason: null,
      },
    } as SyncResult;

    const result = await runImport(sync, {
      preview: true,
      existing: { stores: [], categories: [], coupons: [] },
    });
    assert.equal(result.body.committed, false);
    assert.equal(calls, 0);
  } finally {
    ImportExecutor.executePlan = original;
  }
});
