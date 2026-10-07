import assert from "node:assert/strict";
import test from "node:test";
import { isProviderManagedEntity } from "./admin-entity-ownership.ts";

const identity = {
  provider: "impact",
  provider_entity_namespace: "campaign",
  provider_entity_id: "11565",
};

for (const [label, namespace, id] of [
  ["Impact Campaign Store", "campaign", "11565"],
  ["Impact Ad Coupon", "ad", "123"],
  ["Impact Promotion Deal", "promotion", "456"],
] as const) {
  test(`${label} is provider-managed`, () => {
    assert.equal(
      isProviderManagedEntity({
        ...identity,
        provider_entity_namespace: namespace,
        provider_entity_id: id,
      }),
      true,
    );
  });
}

test("future providers use the same canonical identity rule", () => {
  assert.equal(isProviderManagedEntity({ ...identity, provider: "future-provider" }), true);
});

for (const kind of ["Store", "Coupon"]) {
  test(`manual ${kind} is not provider-managed`, () => {
    assert.equal(
      isProviderManagedEntity({
        provider: null,
        provider_entity_namespace: null,
        provider_entity_id: null,
      }),
      false,
    );
  });
}

for (const key of Object.keys(identity)) {
  test(`${key} must be a non-empty string after trimming`, () => {
    for (const value of [undefined, null, "", " \t\n ", 123, true]) {
      assert.equal(isProviderManagedEntity({ ...identity, [key]: value }), false);
    }
  });
}

test("partial identities and absent identities are not provider-managed", () => {
  assert.equal(isProviderManagedEntity({}), false);
  assert.equal(isProviderManagedEntity({ provider: "impact" }), false);
  assert.equal(isProviderManagedEntity({ provider: "impact", provider_entity_id: "123" }), false);
});

test("whitespace is trimmed without mutating the input", () => {
  const row = Object.freeze({
    provider: " impact ",
    provider_entity_namespace: " campaign\t",
    provider_entity_id: " 11565\n",
  });
  assert.equal(isProviderManagedEntity(row), true);
  assert.equal(row.provider, " impact ");
  assert.equal(row.provider_entity_namespace, " campaign\t");
  assert.equal(row.provider_entity_id, " 11565\n");
});

test("metadata, names, slugs and affiliate URLs do not establish ownership", () => {
  const misleading = {
    provider: null,
    metadata: identity,
    name: "Impact Campaign Store",
    slug: "impact-campaign",
    affiliate_url: "https://impact.example/123",
  };
  assert.equal(isProviderManagedEntity(misleading), false);
  assert.equal(isProviderManagedEntity({ ...identity, metadata: {} }), true);
});

test("lifecycle flags do not establish or negate ownership", () => {
  for (const lifecycle_managed of [true, false, null]) {
    for (const lifecycle_hidden of [true, false, null]) {
      const flags = { lifecycle_managed, lifecycle_hidden };
      assert.equal(isProviderManagedEntity({ provider: null, ...flags }), false);
      assert.equal(isProviderManagedEntity({ ...identity, ...flags }), true);
    }
  }
});
