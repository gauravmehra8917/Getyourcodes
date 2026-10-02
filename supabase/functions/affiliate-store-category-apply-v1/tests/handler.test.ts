import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORY,
  ID,
  ORIGIN,
  OTHER,
  STORE,
  USER,
  harness,
  integration,
  mapping,
  request,
  store,
} from "./fixture.ts";

const valid = { integrationId: ID, apply: true, mode: "canary" };
async function assertSafe(response: Response) {
  const body = await response.json();
  const text = JSON.stringify(body);
  for (const secret of [
    ID,
    USER,
    STORE,
    CATEGORY,
    OTHER,
    "private-",
    "SQL",
    "raw-provider",
    "CampaignId",
    "categoryId",
    "storeId",
    "Fashion",
    "fashion",
  ])
    assert.equal(text.includes(secret), false, secret);
  return body;
}

test("success uses fresh Campaign evidence after admin/catalog gates and invokes one RPC", async () => {
  const h = harness();
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(h.operations, [
    "verify",
    "source",
    "admin",
    "integration",
    "stores",
    "categories",
    "mappings",
    "ciphertext",
    "decrypt",
    "transport",
    "fetch",
    "rpc",
  ]);
  assert.equal(h.requests.length, 1);
  assert.equal(new URL(h.requests[0]!.url).pathname, "/Mediapartners/private-account/Campaigns");
  assert.deepEqual(h.calls, [
    {
      storeId: STORE,
      campaignId: "private-campaign",
      categoryId: CATEGORY,
      providerCategoryKeys: ["fashion"],
    },
  ]);
  assert.deepEqual(await assertSafe(response), {
    host: { version: "p1c-a2-v1", mode: "canary" },
    result: { status: "assigned", assigned: 1, alreadyCategorized: 0, remainingAssignable: 0 },
  });
});

test("origin and POST gates cause zero privileged/provider/write work", async () => {
  for (const origin of [
    null,
    "null",
    "https://evil.example",
    "https://admin.example.evil",
    "http://localhost:8081",
  ]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { origin }))).status, 403);
    assert.deepEqual(h.operations, []);
  }
  for (const method of ["GET", "PUT", "DELETE"]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { method }))).status, 405);
    assert.deepEqual(h.operations, []);
  }
  assert.equal((await harness({ siteUrl: "invalid" }).handler(request())).status, 403);
});

test("preflight accepts only configured/exact local origins without trusted work", async () => {
  for (const origin of [
    ORIGIN,
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ]) {
    const h = harness();
    const response = await h.handler(request(undefined, { method: "OPTIONS", origin }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Vary"), "Origin");
    assert.deepEqual(h.operations, []);
  }
});

test("missing/malformed bearer JWT and unverified users cause zero privileged work", async () => {
  for (const authorization of [null, "", "bearer jwt", "Bearer  jwt", "Bearer jwt extra"]) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { authorization }))).status, 401);
    assert.deepEqual(h.operations, []);
  }
  for (const user of [null, { id: "invalid" }]) {
    const h = harness({ user });
    assert.equal((await h.handler(request())).status, 401);
    assert.deepEqual(h.operations, ["verify"]);
  }
});

test("non-admin user causes zero catalog, secret, provider or write work", async () => {
  const h = harness({ admin: false });
  assert.equal((await h.handler(request())).status, 403);
  assert.deepEqual(h.operations, ["verify", "source", "admin"]);
  assert.equal(h.calls.length, 0);
});

test("exact request rejects malformed body, extra fields and every mode except canary", async () => {
  for (const body of [
    null,
    [],
    {},
    { integrationId: ID },
    { ...valid, apply: false },
    { ...valid, integrationId: "invalid" },
    { ...valid, mode: "full" },
    { ...valid, mode: "scheduled" },
    { ...valid, mode: "CANARY" },
    { ...valid, extra: true },
    { ...valid, preview: true },
    { ...valid, extra: "x".repeat(2000) },
  ]) {
    const h = harness();
    assert.equal((await h.handler(request(body))).status, 400);
    assert.deepEqual(h.operations, ["verify", "source", "admin"]);
  }
});

test("client cannot submit any store/category/Campaign/mapping/priority target", async () => {
  for (const field of [
    "storeId",
    "categoryId",
    "CampaignId",
    "campaignId",
    "mappingId",
    "priority",
    "providerCategoryKeys",
  ]) {
    const h = harness();
    assert.equal((await h.handler(request({ ...valid, [field]: STORE }))).status, 400);
    assert.equal(h.requests.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test("malformed JSON, UTF-8 and streamed oversized bodies fail before catalog/credentials", async () => {
  for (const bytes of [
    new TextEncoder().encode("{"),
    new Uint8Array([255]),
    new TextEncoder().encode(" ".repeat(1025)),
  ]) {
    const h = harness();
    const template = request();
    const response = await h.handler(
      new Request(template.url, { method: "POST", headers: template.headers, body: bytes }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(h.operations, ["verify", "source", "admin"]);
  }
});

test("selected integration must match, be enabled, use Impact and approved Campaign config", async () => {
  for (const [row, status] of [
    [null, 404],
    [{ ...integration, id: USER }, 422],
    [{ ...integration, isEnabled: false }, 409],
    [{ ...integration, providerName: "other" }, 422],
    [{ ...integration, authenticationType: "bearer" }, 422],
    [{ ...integration, endpointConfiguration: { campaigns: "/unapproved/{AccountSID}/Ads" } }, 422],
  ] as const) {
    const h = harness({ integration: row });
    assert.equal((await h.handler(request())).status, status);
    assert.equal(h.requests.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test("zero assignable Campaigns produces bounded noop and zero RPC", async () => {
  for (const body of [
    { Campaigns: [] },
    { Campaigns: [{ CampaignId: "private-campaign", Category: "Unmapped" }] },
    { Campaigns: [{ AdvertiserId: "private-campaign", Category: "Fashion" }] },
  ]) {
    const h = harness({ body });
    const response = await h.handler(request());
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 0);
    assert.deepEqual((await assertSafe(response)).result, {
      status: "noop",
      assigned: 0,
      alreadyCategorized: 0,
      remainingAssignable: 0,
    });
  }
});

test("multiple assignable Campaigns persist exactly one deterministic code-unit first canary", async () => {
  const ids = ["z", "a", "Z", "10", "2"];
  for (const order of [ids, [...ids].reverse()]) {
    const stores = ids.map((campaignId, i) => ({
      ...store,
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
      providerEntityId: campaignId,
    }));
    const h = harness({
      stores,
      body: { Campaigns: order.map((CampaignId) => ({ CampaignId, Category: "Fashion" })) },
    });
    const response = await h.handler(request());
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0]!.campaignId, "10");
    assert.equal(h.state.stores.filter((row) => row.categoryId !== null).length, 1);
    assert.deepEqual((await assertSafe(response)).result, {
      status: "assigned",
      assigned: 1,
      alreadyCategorized: 0,
      remainingAssignable: 4,
    });
  }
});

test("RPC evidence includes all unique observed keys, including weaker and unmapped ones", async () => {
  const h = harness({
    body: {
      Campaigns: [
        { CampaignId: " private-campaign ", Categories: ["Fashion", "FASHION", "Travel", "Books"] },
      ],
    },
  });
  await h.handler(request());
  assert.deepEqual(h.calls[0]!.providerCategoryKeys, ["books", "fashion", "travel"]);
  assert.equal(h.calls[0]!.campaignId, "private-campaign");
});

test("manual category before planning produces no assignment or RPC even with invalid taxonomy", async () => {
  const h = harness({
    stores: [{ ...store, categoryId: OTHER }],
    body: { Campaigns: [{ CampaignId: "private-campaign", Category: { malformed: true } }] },
  });
  const response = await h.handler(request());
  assert.equal((await assertSafe(response)).result.status, "noop");
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.stores[0]!.categoryId, OTHER);
});

test("mocked SQL-time manual category race preserves the exact value with a bounded noop", async () => {
  const h = harness({
    beforeRpc(state) {
      state.stores[0]!.categoryId = OTHER;
    },
  });
  const response = await h.handler(request());
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.stores[0]!.categoryId, OTHER);
  assert.deepEqual((await assertSafe(response)).result, {
    status: "noop",
    assigned: 0,
    alreadyCategorized: 1,
    remainingAssignable: 0,
  });
});

test("mapping retargeted after planning is blocked by mocked transaction revalidation", async () => {
  const h = harness({
    beforeRpc(state) {
      state.mappings[0]!.categoryId = OTHER;
    },
  });
  const response = await h.handler(request());
  assert.equal((await assertSafe(response)).result.status, "blocked");
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.stores[0]!.categoryId, null);
});

test("newly enabled stronger mapping for previously unmapped key blocks stale target", async () => {
  const h = harness({
    body: { Campaigns: [{ CampaignId: "private-campaign", Categories: ["Fashion", "Travel"] }] },
    beforeRpc(state) {
      state.mappings.push({
        ...mapping,
        id: OTHER,
        normalizedProviderCategoryKey: "travel",
        priority: -1,
        categoryId: OTHER,
      });
    },
  });
  const response = await h.handler(request());
  assert.equal((await assertSafe(response)).result.status, "blocked");
  assert.equal(h.state.stores[0]!.categoryId, null);
});

test("strongest mappings tied on different targets before planning produce zero RPC", async () => {
  const h = harness({
    mappings: [
      mapping,
      { ...mapping, id: OTHER, normalizedProviderCategoryKey: "travel", categoryId: OTHER },
    ],
    body: { Campaigns: [{ CampaignId: "private-campaign", Categories: ["Fashion", "Travel"] }] },
  });
  assert.equal((await (await h.handler(request())).json()).result.status, "noop");
  assert.equal(h.calls.length, 0);
});

test("ambiguous mapping introduced at mocked SQL time yields no write", async () => {
  const h = harness({
    body: { Campaigns: [{ CampaignId: "private-campaign", Categories: ["Fashion", "Travel"] }] },
    beforeRpc(state) {
      state.mappings.push({
        ...mapping,
        id: OTHER,
        normalizedProviderCategoryKey: "travel",
        categoryId: OTHER,
      });
    },
  });
  assert.equal((await (await h.handler(request())).json()).result.status, "blocked");
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.stores[0]!.categoryId, null);
});

test("disabled/removed mappings and missing category at mocked SQL time cause no write", async () => {
  for (const beforeRpc of [
    (state: ReturnType<typeof harness>["state"]) => {
      state.mappings[0]!.enabled = false;
    },
    (state: ReturnType<typeof harness>["state"]) => {
      state.mappings = [];
    },
    (state: ReturnType<typeof harness>["state"]) => {
      state.categories = [OTHER];
    },
  ]) {
    const h = harness({ beforeRpc });
    assert.equal((await (await h.handler(request())).json()).result.status, "blocked");
    assert.equal(h.state.stores[0]!.categoryId, null);
  }
});

test("changed store identity at mocked SQL time is blocked without fallback", async () => {
  for (const field of ["provider", "providerEntityNamespace", "providerEntityId"] as const) {
    const h = harness({
      beforeRpc(state) {
        state.stores[0]![field] = "other";
      },
    });
    assert.equal((await (await h.handler(request())).json()).result.status, "blocked");
    assert.equal(h.state.stores[0]!.categoryId, null);
  }
});

test("RPC transport failure is bounded and never retried or replaced with a second canary", async () => {
  const h = harness({
    failAt: "rpc",
    stores: [store, { ...store, id: OTHER, providerEntityId: "z" }],
    body: {
      Campaigns: [
        { CampaignId: "private-campaign", Category: "Fashion" },
        { CampaignId: "z", Category: "Fashion" },
      ],
    },
  });
  const response = await h.handler(request());
  assert.equal(response.status, 502);
  assert.equal(h.operations.filter((op) => op === "rpc").length, 1);
  assert.equal(
    h.state.stores.every((row) => row.categoryId === null),
    true,
  );
  assert.equal((await assertSafe(response)).result.status, "blocked");
});

test("incomplete/malformed pages, redirect continuations and oversized provider evidence cause zero RPC", async () => {
  for (const body of [
    { Wrong: [] },
    { Campaigns: [], "@page": 1, "@numpages": 2 },
    { Campaigns: [], "@nextpageuri": "https://evil.example/steal" },
    { Campaigns: [], Unused: "x".repeat(2_000_001) },
  ]) {
    const h = harness({ body });
    assert.equal((await h.handler(request())).status, 502);
    assert.equal(h.calls.length, 0);
  }
});

test("fixed bounded Campaign requests stop incomplete pagination before persistence", async () => {
  const h = harness();
  h.dependencies.createImpactTransport = () => ({
    async execute(req) {
      h.requests.push(req);
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("Page"));
      url.searchParams.set("Page", String(page + 1));
      return {
        kind: "response",
        status: 200,
        retryAfterMs: null,
        bodyText: JSON.stringify({
          Campaigns: Array.from({ length: 100 }, (_, i) => ({
            CampaignId: `c-${page}-${i}`,
            Category: "Fashion",
          })),
          "@nextpageuri": url.toString(),
        }),
      };
    },
    async wait() {
      throw new Error("no retries");
    },
    readRateSnapshot: () => ({ limit: null, remaining: null, reset: null }),
    consumeResponseSizeLimitExceeded: () => false,
  });
  assert.equal((await h.handler(request())).status, 502);
  assert.equal(h.requests.length, 10);
  assert.equal(h.calls.length, 0);
});

test("catalog overflow fails before credentials, provider and persistence", async () => {
  const h = harness({ stores: Array.from({ length: 10_001 }, () => store) });
  assert.equal((await h.handler(request())).status, 500);
  assert.equal(h.operations.includes("decrypt"), false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.calls.length, 0);
});

test("every thrown dependency failure returns bounded safe content", async () => {
  for (const [failAt, status] of [
    ["verify", 401],
    ["source", 403],
    ["admin", 403],
    ["integration", 500],
    ["stores", 500],
    ["categories", 500],
    ["mappings", 500],
    ["ciphertext", 422],
    ["decrypt", 422],
    ["transport", 502],
    ["fetch", 502],
    ["rpc", 502],
  ] as const) {
    const h = harness({ failAt });
    const response = await h.handler(request());
    assert.equal(response.status, status, failAt);
    await assertSafe(response);
  }
});

test("duplicate Campaign identity and malformed taxonomy never become assignable", async () => {
  for (const Campaigns of [
    [
      { CampaignId: "private-campaign", Category: "Fashion" },
      { CampaignId: "private-campaign", Category: "Fashion" },
    ],
    [{ CampaignId: "private-campaign", Categories: ["Fashion", false] }],
  ]) {
    const h = harness({ body: { Campaigns } });
    assert.equal((await (await h.handler(request())).json()).result.status, "noop");
    assert.equal(h.calls.length, 0);
  }
});

test("each invocation fetches fresh evidence; no cached plan or second-store fallback", async () => {
  const h = harness();
  await h.handler(request());
  await h.handler(request());
  assert.equal(h.requests.length, 2);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.stores[0]!.categoryId, CATEGORY);
});

test("lost RPC response after mocked commit never triggers an automatic retry", async () => {
  const h = harness();
  const apply = h.source.applyCanary;
  h.source.applyCanary = async (evidence) => {
    await apply(evidence);
    throw new Error("SQL private lost response");
  };
  const response = await h.handler(request());
  assert.equal(response.status, 502);
  assert.equal((await assertSafe(response)).result.status, "blocked");
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.stores[0]!.categoryId, CATEGORY);
  const freshResponse = await h.handler(request());
  assert.equal((await freshResponse.json()).result.status, "noop");
  assert.equal(h.calls.length, 1);
});
