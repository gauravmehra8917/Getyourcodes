import assert from "node:assert/strict";
import test from "node:test";
import { applyPublishingPolicy, FALLBACK_POLICY, type PublishingPolicy } from "@/lib/publishing-policy";
import type { ImportPlan, PlannedRecord } from "./ImportPlan";
import { qualifyStores } from "./StoreQualification";

const policy = (overrides: Partial<PublishingPolicy> = {}): PublishingPolicy => ({ ...FALLBACK_POLICY, minCouponsPerStore: 2, minDealsPerStore: 2, maxCouponsPerStore: 20, ...overrides });
const coupon = (id: string, store = "merchant", extra: Record<string, unknown> = {}): PlannedRecord<any> => ({ entity: "coupon", action: "create", providerEntityId: id, existingId: null, slug: null, source: { providerCouponId: id, providerStoreId: store, providerAdvertiserId: null, providerCampaignId: null, status: "active", startDate: null, endDate: null, ...extra } });
const deal = (id: string, store = "merchant"): PlannedRecord<any> => ({ entity: "deal", action: "create", providerEntityId: id, existingId: null, slug: null, source: { providerDealId: id, providerStoreId: store, providerAdvertiserId: null, providerCampaignId: null, status: "active", startDate: null, endDate: null } });
const plan = (coupons: PlannedRecord<any>[], deals: PlannedRecord<any>[] = []): ImportPlan => ({ provider: "test", integrationId: "test", createdAt: "", storesToCreate: [], storesToUpdate: [], couponsToCreate: coupons, couponsToUpdate: [], dealsToCreate: deals, dealsToUpdate: [], categoriesToCreate: [], categoriesToUpdate: [], skipped: [], validationErrors: [], conflicts: [], warnings: [], identity: [] });

test("qualification accepts coupon-only and deal-only merchants", () => {
  assert.equal(qualifyStores([coupon("a"), coupon("b")], [], [], [], policy())[0].qualified, true);
  assert.equal(qualifyStores([], [deal("a"), deal("b")], [], [], policy())[0].reason, "qualified_deal_threshold");
});

test("qualification holds a merchant below both thresholds", () => {
  assert.equal(qualifyStores([coupon("a")], [deal("a")], [], [], policy())[0].reason, "insufficient_publishable_offers");
});

test("policy preserves pre-cap eligibility for qualification", () => {
  const offers = Array.from({ length: 90 }, (_, i) => coupon(String(i)));
  const outcome = applyPublishingPolicy(plan(offers), policy({ minCouponsPerStore: 1, maxCouponsPerStore: 20 }));
  assert.equal(outcome.eligibleCoupons.length, 90);
  assert.equal(outcome.selectedCoupons.length, 20);
  const q = qualifyStores(outcome.eligibleCoupons as any, [], outcome.selectedCoupons as any, [], policy({ minCouponsPerStore: 1, maxCouponsPerStore: 20 }));
  assert.deepEqual(q[0] && { eligible: q[0].eligibleCoupons, selected: q[0].selectedCoupons, qualified: q[0].qualified }, { eligible: 90, selected: 20, qualified: true });
});

test("ineligible offers are excluded before qualification and caps do not alter eligibility", () => {
  const disabled = coupon("disabled");
  disabled.existingId = "existing-disabled";
  const outcome = applyPublishingPolicy(plan([
    coupon("active-1"), coupon("active-2"), coupon("expired", "merchant", { endDate: "2000-01-01" }), coupon("inactive", "merchant", { status: "inactive" }), disabled,
  ]), policy({ minCouponsPerStore: 1, maxCouponsPerStore: 1 }), { now: new Date("2026-01-01"), manuallyDisabledIds: ["existing-disabled"] });
  assert.equal(outcome.eligibleCoupons.length, 2);
  assert.equal(outcome.selectedCoupons.length, 1);
});

test("qualification helper deduplicates immutable provider identities", () => {
  const q = qualifyStores([coupon("duplicate"), coupon("duplicate")], [], [], [], policy({ minCouponsPerStore: 2 }));
  // The planner normally deduplicates first; this guard prevents an accidental
  // duplicate from inflating a lifecycle qualification count.
  assert.equal(q[0].eligibleCoupons, 1);
});
