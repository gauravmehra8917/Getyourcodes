import assert from "node:assert/strict";
import test from "node:test";
import { deleteAdminCatalogRow } from "./admin-catalog-delete.ts";

function harness(kind: "coupon" | "store" | "category") {
  const errors: string[] = [];
  const busy: boolean[] = [];
  const pendingIds = new Set<string>();
  let deleteCalls = 0;
  let refreshes = 0;
  let confirmations = 0;
  const options = {
    kind,
    row: {
      id: "record",
      provider: null as string | null,
      provider_entity_namespace: "campaign",
      provider_entity_id: "123",
    },
    pendingIds,
    confirmDelete: () => {
      confirmations++;
      return true;
    },
    deleteRow: async (): Promise<{ error: unknown }> => {
      deleteCalls++;
      return { error: null };
    },
    onBusyChange: () => {
      busy.push(pendingIds.has("record"));
    },
    onError: (message: string) => {
      errors.push(message);
    },
    refresh: () => {
      refreshes++;
    },
  };
  return {
    options,
    errors,
    busy,
    deleteCalls: () => deleteCalls,
    refreshes: () => refreshes,
    confirmations: () => confirmations,
  };
}

for (const kind of ["coupon", "store"] as const) {
  test(`provider-managed ${kind} guard prevents confirmation and DB delete`, async () => {
    const fixture = harness(kind);
    fixture.options.row.provider = "impact";
    await deleteAdminCatalogRow(fixture.options);
    assert.equal(fixture.deleteCalls(), 0);
    assert.equal(fixture.confirmations(), 0);
    assert.equal(fixture.refreshes(), 0);
    assert.match(fixture.errors[0], /Provider-managed records cannot be deleted manually/);
    assert.deepEqual(fixture.busy, []);
  });

  test(`manual ${kind} reaches DB delete and refreshes on success`, async () => {
    const fixture = harness(kind);
    await deleteAdminCatalogRow(fixture.options);
    assert.equal(fixture.deleteCalls(), 1);
    assert.equal(fixture.refreshes(), 1);
    assert.equal(fixture.confirmations(), 1);
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.busy, [true, false]);
  });
}

test("category delete stays available even with provider-like fields", async () => {
  const fixture = harness("category");
  fixture.options.row.provider = "impact";
  await deleteAdminCatalogRow(fixture.options);
  assert.equal(fixture.deleteCalls(), 1);
  assert.equal(fixture.refreshes(), 1);
});

for (const kind of ["coupon", "store", "category"] as const) {
  test(`${kind} returned DB failure is visible without a false-success refresh`, async () => {
    const fixture = harness(kind);
    fixture.options.deleteRow = async () => ({
      error: { code: "XX000", message: "private_constraint_name" },
    });
    await deleteAdminCatalogRow(fixture.options);
    assert.deepEqual(fixture.errors, [`Could not delete this ${kind}. Please try again.`]);
    assert.equal(fixture.refreshes(), 0);
    assert.deepEqual(fixture.busy, [true, false]);
    assert.equal(fixture.options.pendingIds.size, 0);
  });

  test(`${kind} dependency failure gives an understandable message`, async () => {
    const fixture = harness(kind);
    fixture.options.deleteRow = async () => ({
      error: { code: "23503", message: "private_fk_name" },
    });
    await deleteAdminCatalogRow(fixture.options);
    assert.match(fixture.errors[0], /still referenced.*cannot be deleted/);
    if (kind === "category") assert.match(fixture.errors[0], /stores or mappings/);
    if (kind === "store") assert.match(fixture.errors[0], /coupons or other related records/);
    assert.doesNotMatch(fixture.errors[0], /private_fk_name/);
    assert.equal(fixture.refreshes(), 0);
  });
}

test("permission failures are visible and do not refresh", async () => {
  const fixture = harness("store");
  fixture.options.deleteRow = async () => ({ error: { code: "42501" } });
  await deleteAdminCatalogRow(fixture.options);
  assert.deepEqual(fixture.errors, ["You do not have permission to delete this store."]);
  assert.equal(fixture.refreshes(), 0);
});

test("thrown network failures are visible, release busy state and allow retry", async () => {
  const fixture = harness("coupon");
  fixture.options.deleteRow = async () => {
    throw new Error("private network details");
  };
  await deleteAdminCatalogRow(fixture.options);
  assert.deepEqual(fixture.errors, ["Could not delete this coupon. Please try again."]);
  assert.equal(fixture.refreshes(), 0);
  assert.equal(fixture.options.pendingIds.size, 0);
  fixture.options.deleteRow = async () => ({ error: null });
  await deleteAdminCatalogRow(fixture.options);
  assert.equal(fixture.refreshes(), 1);
});

test("cancelled confirmation never deletes or changes busy state", async () => {
  const fixture = harness("category");
  fixture.options.confirmDelete = () => false;
  await deleteAdminCatalogRow(fixture.options);
  assert.equal(fixture.deleteCalls(), 0);
  assert.equal(fixture.refreshes(), 0);
  assert.deepEqual(fixture.busy, []);
});

test("a duplicate invocation cannot delete the same pending row twice", async () => {
  const fixture = harness("store");
  let resolve!: (result: { error: unknown }) => void;
  let calls = 0;
  fixture.options.deleteRow = () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const first = deleteAdminCatalogRow(fixture.options);
  assert.equal(fixture.options.pendingIds.has("record"), true);
  await deleteAdminCatalogRow(fixture.options);
  assert.equal(calls, 1);
  assert.equal(fixture.confirmations(), 1);
  assert.equal(fixture.refreshes(), 0);
  resolve({ error: null });
  await first;
  assert.equal(fixture.refreshes(), 1);
  assert.deepEqual(fixture.busy, [true, false]);
});

test("refresh failure reports that deletion succeeded and releases busy state", async () => {
  const fixture = harness("coupon");
  fixture.options.refresh = () => {
    throw new Error("refresh failed");
  };
  await deleteAdminCatalogRow(fixture.options);
  assert.equal(fixture.deleteCalls(), 1);
  assert.match(fixture.errors[0], /was deleted, but the list could not be refreshed/);
  assert.equal(fixture.options.pendingIds.size, 0);
});
