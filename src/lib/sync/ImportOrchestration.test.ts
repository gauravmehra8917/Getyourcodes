import assert from "node:assert/strict";
import test from "node:test";
import { classifyOfferIdentities, resolveOrchestrationSettings, shouldPersistOffer } from "./ImportOrchestration";

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

test("safe defaults preserve incremental two-page imports while full sync has a larger bounded window", () => {
  assert.equal(resolveOrchestrationSettings().maxPages, 2);
  assert.equal(resolveOrchestrationSettings({ strategy: "full_sync" }).maxPages, 50);
  assert.equal(resolveOrchestrationSettings({ maxApiCalls: 3 }).maxApiCalls, 3);
});
