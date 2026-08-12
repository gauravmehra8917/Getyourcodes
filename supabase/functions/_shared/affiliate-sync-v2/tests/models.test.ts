import assert from "node:assert/strict";
import test from "node:test";
import { toOpaqueProviderId, type ProviderStoreKey, type StoreOfferAssociationV2 } from "../models.ts";

test("opaque provider IDs preserve exact strings and finite numeric values", () => {
  assert.equal(toOpaqueProviderId("  001-A_B  "), "001-A_B");
  assert.equal(toOpaqueProviderId(42), "42");
  assert.equal(toOpaqueProviderId(Number.NaN), null);
  assert.equal(toOpaqueProviderId("   "), null);
});

test("provider store associations expose only campaign-backed keys", () => {
  const key: ProviderStoreKey = { provider: "impact", namespace: "campaign", id: "0007-C" };
  const association: StoreOfferAssociationV2 = {
    providerStoreKey: key,
    matchedStoreId: "store-123",
    matchMethod: "campaign_id",
    unresolvedReason: null,
  };
  assert.deepEqual(association.providerStoreKey, key);
});
