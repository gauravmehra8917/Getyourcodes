import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  excludeLifecycleHiddenStores,
  isPublicStoreVisible,
  PUBLIC_STORE_VISIBILITY_FILTER,
} from "./catalog-visibility";

test("only lifecycle-managed hidden stores are excluded", () => {
  assert.equal(isPublicStoreVisible({ lifecycle_managed: true, lifecycle_hidden: true }), false);
  assert.equal(isPublicStoreVisible({ lifecycle_managed: true, lifecycle_hidden: false }), true);
  assert.equal(isPublicStoreVisible({ lifecycle_managed: false, lifecycle_hidden: true }), true);
  assert.equal(isPublicStoreVisible({ lifecycle_managed: null, lifecycle_hidden: null }), true);
});

test("public store filter is applied without changing unrelated query behavior", () => {
  const calls: string[] = [];
  const query = { or: (filter: string) => { calls.push(filter); return query; } };
  assert.equal(excludeLifecycleHiddenStores(query), query);
  assert.deepEqual(calls, [PUBLIC_STORE_VISIBILITY_FILTER]);
});

test("public catalog, sitemap, and AI store discovery use the visibility guard", () => {
  const files = [
    "./home-data.ts",
    "../routes/search.tsx",
    "../routes/$slug.tsx",
    "../routes/sitemap[.]xml.ts",
    "../routes/api/chat.ts",
    "../components/hero-search-results.tsx",
    "mcp/tools/search-stores.ts",
  ];
  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /excludeLifecycleHiddenStore/);
  }
});
