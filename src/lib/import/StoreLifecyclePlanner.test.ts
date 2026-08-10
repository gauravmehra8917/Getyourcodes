import assert from "node:assert/strict";
import test from "node:test";
import { planStoreLifecycle } from "./StoreLifecyclePlanner";

const candidate = (existingId: string | null, managed = false, hidden = false) => ({ entity: "store" as const, action: existingId ? "update" as const : "create" as const, providerEntityId: "merchant", existingId, slug: "merchant", source: { providerStoreId: "merchant", providerAdvertiserId: null, providerCampaignId: null }, existingLifecycleManaged: managed, existingLifecycleHidden: hidden });
const qualified = { storeKey: "merchant", eligibleCoupons: 2, eligibleDeals: 0, selectedCoupons: 1, selectedDeals: 0, qualified: true, reason: "qualified_coupon_threshold" as const };
const unqualified = { ...qualified, eligibleCoupons: 0, qualified: false, reason: "insufficient_publishable_offers" as const };

test("plans all provider lifecycle decisions without writes", () => {
  assert.equal(planStoreLifecycle([candidate(null)], [qualified]).decisions[0]?.action, "create_store");
  assert.equal(planStoreLifecycle([candidate(null)], [unqualified]).decisions[0]?.action, "hold_store");
  assert.equal(planStoreLifecycle([candidate("id", true)], [qualified]).decisions[0]?.action, "update_store");
  assert.equal(planStoreLifecycle([candidate("id", true)], [unqualified]).decisions[0]?.action, "lifecycle_hide_store");
  assert.equal(planStoreLifecycle([candidate("id", true, true)], [qualified]).decisions[0]?.action, "lifecycle_republish_store");
  assert.equal(planStoreLifecycle([candidate("id", false, true)], [qualified]).decisions[0]?.action, "hold_store");
});
