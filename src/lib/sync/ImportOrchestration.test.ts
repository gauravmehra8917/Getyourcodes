import assert from "node:assert/strict";
import test from "node:test";
import type { StandardResponse } from "@/lib/integration-engine/types";
import type { NormalizationBatch, PromotionSplit } from "@/lib/normalizers";
import type { ProviderAdapter, ProviderResult } from "@/lib/providers/index.server";
import { extractImpactPagination } from "@/lib/providers/adapters/ImpactAdapter";
import { classifyOfferIdentities, resolveOrchestrationSettings, shouldPersistOffer } from "./ImportOrchestration";
import { SyncContext } from "./SyncContext";
import { SyncEngine } from "./SyncEngine";

type RawOffer = { external_id: string; kind?: "coupon" | "deal" };

function response<T>(body: T, pagination?: ProviderResult<T>["pagination"]): ProviderResult<T> {
  return {
    success: true,
    status: 200,
    latencyMs: 0,
    headers: {},
    body,
    error: null,
    retryCount: 0,
    meta: { integrationId: "test-integration", method: "GET", url: "test://provider", at: new Date().toISOString() },
    ...(pagination ? { pagination } : {}),
  };
}

function batch<T>(items: T[]): StandardResponse<NormalizationBatch<T>> {
  return {
    ...response({ items, received: items.length, normalized: items.length, skipped: 0, issues: [], durationMs: 0 }),
  };
}

function makeAdapter(pages: Array<ProviderResult<RawOffer[]>>) {
  const couponPages: number[] = [];
  const storePages: number[] = [];
  const adapter = {
    providerKey: "test-provider",
    getConfig: () => ({ id: "test-integration", providerName: "test", providerType: "test", baseUrl: "https://example.test" }),
    fetchCoupons: async (options?: { page?: number }) => {
      const page = options?.page ?? 1;
      couponPages.push(page);
      return pages[page - 1] ?? response([]);
    },
    fetchDeals: async () => response([]),
    fetchStores: async (options?: { page?: number }) => {
      const page = options?.page ?? 1;
      storePages.push(page);
      return pages[page - 1] ?? response([]);
    },
    fetchCategories: async () => response([]),
  } as unknown as ProviderAdapter;
  return { adapter, couponPages, storePages };
}

function couponNormalizer(withPromotionSplit = false) {
  const normalizer = {
    provider: "test-provider",
    normalizeCoupons: (raw: unknown) => batch(
      (raw as RawOffer[]).map((offer) => ({ providerCouponId: offer.external_id })),
    ),
    normalizeDeals: (raw: unknown) => batch(
      (raw as RawOffer[]).map((offer) => ({ providerDealId: offer.external_id })),
    ),
    normalizeStores: () => batch([]),
  } as Record<string, unknown>;

  if (withPromotionSplit) {
    normalizer.normalizePromotions = (raw: unknown): StandardResponse<PromotionSplit> => response({
      coupons: (raw as RawOffer[])
        .filter((offer) => offer.kind === "coupon")
        .map((offer) => ({ providerCouponId: offer.external_id })),
      deals: (raw as RawOffer[])
        .filter((offer) => offer.kind === "deal")
        .map((offer) => ({ providerDealId: offer.external_id })),
    } as PromotionSplit);
  }
  return normalizer as unknown as SyncContext["normalizer"];
}

async function runCoupons(
  pages: Array<ProviderResult<RawOffer[]>>,
  options: ConstructorParameters<typeof SyncContext>[0]["options"],
) {
  const { adapter, couponPages } = makeAdapter(pages);
  const engine = new SyncEngine(new SyncContext({ adapter, normalizer: couponNormalizer(), options }));
  const result = await engine.run();
  assert.equal(result.success, true);
  assert.ok(result.body);
  return { result: result.body!, couponPages };
}

test("identity discovery preserves traversal signals across existing pages", () => {
  const seen = new Set<string>();
  const existing = new Set(["known-1", "known-2"]);
  assert.deepEqual(classifyOfferIdentities(["known-1"], existing, seen), { newProviderIdentities: 0, existingProviderIdentities: 1 });
  assert.deepEqual(classifyOfferIdentities(["new-on-later-page"], existing, seen), { newProviderIdentities: 1, existingProviderIdentities: 0 });
});

test("strategies retain the correct offer identities", () => {
  assert.equal(shouldPersistOffer("refresh_existing_only", false), false);
  assert.equal(shouldPersistOffer("refresh_existing_only", true), true);
  assert.equal(shouldPersistOffer("discover_new_offers", true), false);
  assert.equal(shouldPersistOffer("discover_new_offers", false), true);
  assert.equal(shouldPersistOffer("full_sync", true), true);
});

test("nullable page limits resolve from the selected strategy", () => {
  assert.equal(resolveOrchestrationSettings({ strategy: "incremental", maxPages: null }).maxPages, 2);
  assert.equal(resolveOrchestrationSettings({ strategy: "discover_new_offers", maxPages: null }).maxPages, 10);
  assert.equal(resolveOrchestrationSettings({ strategy: "refresh_existing_only", maxPages: null }).maxPages, 10);
  assert.equal(resolveOrchestrationSettings({ strategy: "full_sync", maxPages: null }).maxPages, 50);
  assert.equal(resolveOrchestrationSettings({ maxApiCalls: 3 }).maxApiCalls, 3);
});

test("traverses page 3 and beyond while full pages remain", async () => {
  const { result, couponPages } = await runCoupons([
    response([{ external_id: "one" }]),
    response([{ external_id: "two" }]),
    response([{ external_id: "three" }]),
    response([]),
  ], { entityTypes: ["coupon"], strategy: "full_sync", pageSize: 1, maxPages: 10, maxApiCalls: 10 });

  assert.deepEqual(couponPages, [1, 2, 3, 4]);
  assert.equal(result.coupons.length, 3);
  assert.equal(result.orchestration.stopReason, "provider_end");
});

test("follows Impact's explicit next-page metadata", async () => {
  const pageOne = extractImpactPagination({
    "@page": "1",
    "@numpages": "3",
    "@nextpageuri": "/Mediapartners/test/Promotions?Page=3&PageSize=1",
    Promotions: [{ external_id: "one" }],
  });
  const finalPage = extractImpactPagination({ "@page": "3", "@numpages": "3", Promotions: [{ external_id: "three" }] });
  assert.deepEqual(pageOne, { hasNextPage: true, nextPage: 3 });
  assert.deepEqual(finalPage, { hasNextPage: false, nextPage: null });

  const { result, couponPages } = await runCoupons([
    response([{ external_id: "one" }], pageOne),
    response([]),
    response([{ external_id: "three" }], finalPage),
  ], { entityTypes: ["coupon"], strategy: "full_sync", pageSize: 1, maxPages: 10, maxApiCalls: 10 });

  assert.deepEqual(couponPages, [1, 3]);
  assert.deepEqual(result.coupons.map((coupon) => coupon.providerCouponId), ["one", "three"]);
});

test("uses a short page as the pagination fallback", async () => {
  const { result, couponPages } = await runCoupons([
    response([{ external_id: "one" }]),
  ], { entityTypes: ["coupon"], strategy: "full_sync", pageSize: 2, maxPages: 10, maxApiCalls: 10 });

  assert.deepEqual(couponPages, [1]);
  assert.equal(result.orchestration.stopReason, "provider_end");
});

test("stops the run when the shared API-call budget is exhausted", async () => {
  const { result, couponPages } = await runCoupons([
    response([{ external_id: "one" }]),
    response([{ external_id: "two" }]),
    response([{ external_id: "three" }]),
  ], { entityTypes: ["coupon"], strategy: "full_sync", pageSize: 1, maxPages: 10, maxApiCalls: 2 });

  assert.deepEqual(couponPages, [1, 2]);
  assert.equal(result.orchestration.apiCallsUsed, 2);
  assert.equal(result.orchestration.stopReason, "max_api_calls");
});

test("offer discovery runs before stores and cannot be starved by their API calls", async () => {
  const { adapter, couponPages, storePages } = makeAdapter([
    response([{ external_id: "store-page-one" }]),
    response([{ external_id: "store-page-two" }]),
  ]);
  const engine = new SyncEngine(new SyncContext({
    adapter,
    normalizer: couponNormalizer(),
    options: { entityTypes: ["store", "coupon"], strategy: "full_sync", pageSize: 1, maxPages: 10, maxApiCalls: 2 },
  }));
  const result = await engine.run();

  assert.equal(result.success, true);
  assert.ok(result.body);
  assert.deepEqual(couponPages, [1, 2]);
  assert.deepEqual(storePages, []);
  assert.equal(result.body!.orchestration.stopReason, "max_api_calls");
});

test("uses a provider's explicit end-of-pagination signal", async () => {
  const { result, couponPages } = await runCoupons([
    response([{ external_id: "one" }], { hasNextPage: false }),
  ], { entityTypes: ["coupon"], strategy: "full_sync", pageSize: 1, maxPages: 10, maxApiCalls: 10 });

  assert.deepEqual(couponPages, [1]);
  assert.equal(result.orchestration.stopReason, "provider_end");
});

test("does not stop discovery when early pages contain only existing identities", async () => {
  const { result, couponPages } = await runCoupons([
    response([{ external_id: "known" }]),
    response([{ external_id: "new-later" }]),
    response([]),
  ], {
    entityTypes: ["coupon"],
    strategy: "incremental",
    pageSize: 1,
    maxPages: 10,
    maxApiCalls: 10,
    consecutiveNoNewPages: 2,
    existingProviderOfferIds: ["known"],
  });

  assert.deepEqual(couponPages, [1, 2, 3]);
  assert.deepEqual(result.coupons.map((coupon) => coupon.providerCouponId), ["known", "new-later"]);
  assert.equal(result.orchestration.existingProviderIdentitiesEncountered, 1);
  assert.equal(result.orchestration.newProviderIdentitiesDiscovered, 1);
});

test("fetches a shared promotions feed once and emits both coupons and deals", async () => {
  const { adapter, couponPages } = makeAdapter([
    response([{ external_id: "coupon-1", kind: "coupon" }, { external_id: "deal-1", kind: "deal" }]),
    response([]),
  ]);
  let dealFetches = 0;
  (adapter as unknown as { fetchDeals: () => Promise<ProviderResult<RawOffer[]>> }).fetchDeals = async () => {
    dealFetches += 1;
    return response([]);
  };
  const engine = new SyncEngine(new SyncContext({
    adapter,
    normalizer: couponNormalizer(true),
    options: { entityTypes: ["coupon", "deal"], strategy: "full_sync", pageSize: 2, maxPages: 10, maxApiCalls: 10 },
  }));
  const result = await engine.run();

  assert.equal(result.success, true);
  assert.ok(result.body);
  assert.deepEqual(couponPages, [1, 2]);
  assert.equal(dealFetches, 0);
  assert.deepEqual(result.body!.coupons.map((coupon) => coupon.providerCouponId), ["coupon-1"]);
  assert.deepEqual(result.body!.deals.map((deal) => deal.providerDealId), ["deal-1"]);
});
