import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProviderManagedStoreOwnershipV2,
} from "../provider-refresh-ownership.ts";

test("provider-owned lifecycle-managed Campaign is refresh eligible", () => {
  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      importOrigin: "provider",
      lifecycleManaged: true,
    }),
    {
      action: "eligible",
      reason: null,
    },
  );
});

test("missing ownership evidence fails closed", () => {
  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({}),
    {
      action: "blocked",
      reason: "missing_ownership_evidence",
    },
  );

  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      importOrigin: "provider",
    }),
    {
      action: "blocked",
      reason: "missing_ownership_evidence",
    },
  );

  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      lifecycleManaged: true,
    }),
    {
      action: "blocked",
      reason: "missing_ownership_evidence",
    },
  );
});

test("explicit manual ownership state is not provider refresh eligible", () => {
  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      importOrigin: null,
      lifecycleManaged: false,
    }),
    {
      action: "blocked",
      reason: "ownership_not_provider_managed",
    },
  );
});

test("partial provider ownership is still blocked", () => {
  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      importOrigin: "provider",
      lifecycleManaged: false,
    }),
    {
      action: "blocked",
      reason: "ownership_not_provider_managed",
    },
  );

  assert.deepEqual(
    classifyProviderManagedStoreOwnershipV2({
      importOrigin: null,
      lifecycleManaged: true,
    }),
    {
      action: "blocked",
      reason: "ownership_not_provider_managed",
    },
  );
});
