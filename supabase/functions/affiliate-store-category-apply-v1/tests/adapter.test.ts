import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCategoryCanaryResult,
  SupabaseCategoryCanaryDataSource,
} from "../supabase-canary-boundary.ts";
import { BLOCKED_OUTCOMES } from "../types.ts";
import type { CategoryCanaryEvidence } from "../types.ts";
import { CATEGORY, ID, STORE, USER } from "./fixture.ts";

const evidence: CategoryCanaryEvidence = {
  storeId: STORE,
  campaignId: "C01",
  categoryId: CATEGORY,
  providerCategoryKeys: ["fashion"],
};
function adapter(
  data: unknown = { status: "assigned", outcome: "assigned" },
  error: unknown = null,
) {
  const calls: { name: string; args: unknown }[] = [];
  const tables: string[] = [];
  const db = {
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return { data, error };
    },
    from(name: string) {
      tables.push(name);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          return { data: name === "user_roles" ? { id: USER } : null, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return {
    source: new SupabaseCategoryCanaryDataSource(
      db as unknown as ConstructorParameters<typeof SupabaseCategoryCanaryDataSource>[0],
    ),
    calls,
    tables,
  };
}

test("adapter exposes bounded existing reads with zero write calls", async () => {
  const h = adapter();
  assert.equal(await h.source.hasAdminRole(USER), true);
  assert.equal(await h.source.readIntegration(ID), null);
  assert.equal(await h.source.readCredentialCiphertext(ID), null);
  assert.deepEqual(await h.source.readStores(), []);
  assert.deepEqual(await h.source.readCategoryIds(), []);
  assert.deepEqual(await h.source.readMappings(), []);
  assert.deepEqual(h.tables, [
    "user_roles",
    "affiliate_integrations",
    "affiliate_integration_credentials",
    "stores",
    "categories",
    "affiliate_store_category_mappings",
  ]);
  assert.equal(h.calls.length, 0);
});

test("persistence invokes only named category RPC once with bounded evidence", async () => {
  const h = adapter();
  const before = structuredClone(evidence);
  assert.deepEqual(await h.source.applyCanary(evidence), {
    status: "assigned",
    outcome: "assigned",
  });
  assert.deepEqual(h.calls, [
    {
      name: "apply_affiliate_store_category_canary_v1",
      args: {
        p_store_id: STORE,
        p_campaign_id: "C01",
        p_category_id: CATEGORY,
        p_provider_category_keys: ["fashion"],
      },
    },
  ]);
  assert.deepEqual(evidence, before);
  assert.deepEqual(h.tables, []);
});

test("invalid/duplicate/oversized persistence evidence causes zero RPC", async () => {
  for (const invalid of [
    { ...evidence, storeId: "bad" },
    { ...evidence, categoryId: "bad" },
    { ...evidence, campaignId: " C01 " },
    { ...evidence, campaignId: "" },
    { ...evidence, campaignId: "x".repeat(1025) },
    { ...evidence, providerCategoryKeys: [] },
    { ...evidence, providerCategoryKeys: ["fashion", "fashion"] },
    { ...evidence, providerCategoryKeys: Array.from({ length: 33 }, (_, i) => `key-${i}`) },
    { ...evidence, providerCategoryKeys: ["x".repeat(321)] },
  ]) {
    const h = adapter();
    await assert.rejects(h.source.applyCanary(invalid), /invalid_canary_evidence/);
    assert.equal(h.calls.length, 0);
  }
});

test("32 distinct bounded keys remain accepted without truncation", async () => {
  const h = adapter();
  const keys = Array.from({ length: 32 }, (_, i) => `key-${i}`);
  await h.source.applyCanary({ ...evidence, providerCategoryKeys: keys });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    (h.calls[0]!.args as { p_provider_category_keys: string[] }).p_provider_category_keys,
    keys,
  );
});

test("closed result parser accepts only all declared status/outcome pairs", () => {
  for (const status of ["assigned", "noop_existing_category"])
    assert.deepEqual(parseCategoryCanaryResult({ status, outcome: status }), {
      status,
      outcome: status,
    });
  for (const outcome of BLOCKED_OUTCOMES)
    assert.deepEqual(parseCategoryCanaryResult({ status: "blocked", outcome }), {
      status: "blocked",
      outcome,
    });
});

test("malformed/unbounded RPC results fail closed and are never forwarded", async () => {
  for (const data of [
    null,
    [],
    "assigned",
    {},
    { status: "assigned" },
    { status: "assigned", outcome: "internal_failure" },
    { status: "blocked", outcome: "SQL secret" },
    { status: "assigned", outcome: "assigned", storeId: STORE },
    { status: "noop", outcome: "noop_existing_category" },
  ]) {
    assert.throws(() => parseCategoryCanaryResult(data), /invalid_canary_result/);
    const h = adapter(data);
    await assert.rejects(h.source.applyCanary(evidence), /invalid_canary_result/);
    assert.equal(h.calls.length, 1);
  }
});

test("RPC error returns fixed failure text without retry or exception details", async () => {
  const h = adapter(null, { message: "SQL credentials secret", details: STORE });
  await assert.rejects(
    h.source.applyCanary(evidence),
    (error: Error) => error.message === "canary_persistence_failed",
  );
  assert.equal(h.calls.length, 1);
});
