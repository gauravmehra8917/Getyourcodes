import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMPACT_DEALS_APPLY_FUNCTION,
  IMPACT_DEALS_MUTATION_OPTIONS,
  IMPACT_DEALS_PREVIEW_FUNCTION,
  parseImpactDealsApplyResponse,
  parseImpactDealsPreviewResponse,
  requestImpactDealsApply,
  requestImpactDealsPreview,
  type ImpactDealsApplyInvoke,
  type ImpactDealsPreviewInvoke,
} from "./affiliate-sync-deals.client.ts";

const integrationId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const evaluationTimestamp = "2026-10-08T00:00:00.000Z";
function preview() {
  return {
    host: { version: "v2-a8a", readOnly: true, integrationId },
    preview: {
      provider: "impact",
      evaluationTimestamp,
      proposedActions: {
        counts: {
          deals: {
            normalized: 12,
            selected: 5,
            held: 4,
            unresolved: 3,
            existing: 2,
            proposedCreate: 3,
          },
          coupons: { proposedCreate: 50 },
        },
      },
      storeCoverage: { storesWithSelectedOffers: 2, qualifiedStores: 1 },
      identityIntegrityDiagnostics: { identityCollapseDetected: false },
      normalizedDeals: [{ promotionId: "private", providerUrl: "private" }],
      acceptedPromotions: [{ raw: "private" }],
      credentials: "private",
    },
  };
}
function success() {
  return {
    status: "committed",
    scope: "deals",
    mode: "full",
    runId,
    evaluationTimestamp,
    refreshedPlan: true,
    createdStores: 1,
    createdDeals: 3,
    noopStores: 2,
    noopDeals: 4,
    ledgerRows: 10,
    counts: {
      expected: {
        stores: { create: 1, noopExisting: 2, blockedAmbiguous: 0, noopUnmatched: 3 },
        offers: { create: 3, noopExisting: 4, noopHeld: 5, noopUnresolved: 6 },
        writableStores: 1,
        writableOffers: 3,
        writableEntities: 4,
      },
      actual: {
        storesCreated: 1,
        storesNoopExisting: 2,
        offersCreated: 3,
        offersNoopExisting: 4,
        ledgerRows: 10,
      },
    },
    created: { stores: 1, offers: 3 },
    noops: { stores: 2, offers: 4 },
  };
}

test("preview uses the exact endpoint and two-key read-only request once", async () => {
  const calls: Parameters<ImpactDealsPreviewInvoke>[] = [];
  const result = await requestImpactDealsPreview(integrationId, async (...args) => {
    calls.push(args);
    return { data: preview(), error: null };
  });
  assert.equal(IMPACT_DEALS_PREVIEW_FUNCTION, "affiliate-sync-preview-v2");
  assert.deepEqual(calls, [
    [IMPACT_DEALS_PREVIEW_FUNCTION, { body: { integrationId, preview: true } }],
  ]);
  assert.equal(result.status, "ready");
});

for (const operation of ["preview", "apply"] as const) {
  test(`${operation} rejects invalid UUID locally without invoking`, async () => {
    let calls = 0;
    const invoke = async () => {
      calls++;
      return { data: null, error: null };
    };
    const request = operation === "preview" ? requestImpactDealsPreview : requestImpactDealsApply;
    const result = await request("invalid", invoke);
    assert.equal(result.status, "failed");
    assert.equal(calls, 0);
  });
}

test("preview reduces real host shape to exact safe aggregates, stripping raw Promotions", () => {
  assert.deepEqual(parseImpactDealsPreviewResponse(preview()), {
    status: "ready",
    evaluationTimestamp,
    deals: { normalized: 12, selected: 5, held: 4, unresolved: 3, existing: 2, proposedCreate: 3 },
    stores: { withSelectedOffers: 2, qualified: 1 },
    identityIntegrity: { identityCollapseDetected: false },
  });
  assert.doesNotMatch(
    JSON.stringify(parseImpactDealsPreviewResponse(preview())),
    /private|normalizedDeals|acceptedPromotions|credentials|coupons/,
  );
});

test("malformed preview envelopes fail closed", () => {
  for (const value of [
    null,
    [],
    {},
    { preview: null },
    { preview: {} },
    { preview: preview().preview.proposedActions },
  ]) {
    assert.equal(parseImpactDealsPreviewResponse(value), null);
  }
  for (const field of [
    "proposedActions",
    "storeCoverage",
    "identityIntegrityDiagnostics",
    "evaluationTimestamp",
  ]) {
    const value = preview();
    delete (value.preview as Record<string, unknown>)[field];
    assert.equal(parseImpactDealsPreviewResponse(value), null);
  }
});

for (const field of [
  "normalized",
  "selected",
  "held",
  "unresolved",
  "existing",
  "proposedCreate",
] as const) {
  test(`preview ${field} rejects missing, negative, fractional, unsafe and coercible counts`, () => {
    for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
      const value = preview();
      (value.preview.proposedActions.counts.deals as Record<string, unknown>)[field] = bad;
      assert.equal(parseImpactDealsPreviewResponse(value), null);
    }
  });
}
for (const field of ["storesWithSelectedOffers", "qualifiedStores"] as const) {
  test(`preview ${field} validates non-negative safe integers`, () => {
    for (const bad of [-1, 1.5, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      const value = preview();
      (value.preview.storeCoverage as Record<string, unknown>)[field] = bad;
      assert.equal(parseImpactDealsPreviewResponse(value), null);
    }
  });
}

test("preview requires the exact Impact provider", () => {
  for (const provider of ["other", "impact.com", "IMPACT", "impact affiliate", null]) {
    const value = preview();
    (value.preview as Record<string, unknown>).provider = provider;
    assert.equal(parseImpactDealsPreviewResponse(value), null);
  }
});
test("identity collapse blocks readiness, and missing/incorrect integrity fails closed", () => {
  const value = preview();
  value.preview.identityIntegrityDiagnostics.identityCollapseDetected = true;
  const result = parseImpactDealsPreviewResponse(value);
  assert.equal(result?.status, "blocked");
  assert.match(result && "message" in result ? result.message : "", /safety check failed/);
  for (const bad of [undefined, "false", 0, null]) {
    (
      value.preview.identityIntegrityDiagnostics as Record<string, unknown>
    ).identityCollapseDetected = bad;
    assert.equal(parseImpactDealsPreviewResponse(value), null);
  }
});
test("preview proposedCreate zero represents successful no work", () => {
  const value = preview();
  value.preview.proposedActions.counts.deals = {
    normalized: 9,
    selected: 2,
    held: 4,
    unresolved: 3,
    existing: 2,
    proposedCreate: 0,
  };
  const result = parseImpactDealsPreviewResponse(value);
  assert.equal(result?.status, "ready");
  assert.equal(result && "deals" in result ? result.deals.proposedCreate : undefined, 0);
});
test("inconsistent preview aggregate counts fail closed", () => {
  const value = preview();
  value.preview.proposedActions.counts.deals.selected++;
  assert.equal(parseImpactDealsPreviewResponse(value), null);
});
test("preview provider failure wins over a planning model and transport error wins over readiness", async () => {
  const rejected = parseImpactDealsPreviewResponse({
    ...preview(),
    error: { code: "provider_fetch_failed", message: "private" },
  });
  assert.equal(rejected?.status, "failed");
  assert.doesNotMatch(JSON.stringify(rejected), /private/);
  const result = await requestImpactDealsPreview(integrationId, async () => ({
    data: preview(),
    error: new Error("private"),
  }));
  assert.equal(result.status, "failed");
});

test("apply uses the exact endpoint and exactly four full Deals request keys", async () => {
  const calls: Parameters<ImpactDealsApplyInvoke>[] = [];
  const result = await requestImpactDealsApply(integrationId, async (...args) => {
    calls.push(args);
    return { data: success(), error: null };
  });
  assert.equal(IMPACT_DEALS_APPLY_FUNCTION, "affiliate-sync-apply-v2");
  assert.deepEqual(calls, [
    [
      IMPACT_DEALS_APPLY_FUNCTION,
      { body: { integrationId, execute: true, scope: "deals", mode: "full" } },
    ],
  ]);
  assert.equal(result.status, "committed");
});
for (const status of ["committed", "replayed_existing"] as const) {
  test(`apply parses verified ${status} and reduces counts safely`, () => {
    const result = parseImpactDealsApplyResponse({ ...success(), status, private: "private" });
    assert.equal(result?.status, status);
    assert.doesNotMatch(JSON.stringify(result), /private|"created":|"noops":/);
    assert.ok(result && "counts" in result);
    assert.equal(result.scope, "deals");
    assert.equal(result.mode, "full");
    assert.equal(result.runId, runId);
    assert.equal(result.refreshedPlan, true);
  });
}
for (const field of [
  "createdDeals",
  "noopDeals",
  "createdStores",
  "noopStores",
  "ledgerRows",
] as const) {
  test(`apply parses ${field} and rejects invalid counts`, () => {
    const result = parseImpactDealsApplyResponse(success());
    assert.ok(result && "counts" in result);
    assert.equal(result[field], success()[field]);
    for (const bad of [-1, 1.5, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(parseImpactDealsApplyResponse({ ...success(), [field]: bad }), null);
    }
  });
}
test("apply parses held expected count when present and allows its absence", () => {
  const result = parseImpactDealsApplyResponse(success());
  assert.ok(result && "counts" in result);
  assert.equal(result.counts.expected.offers.noopHeld, 5);
  const value = success();
  delete (value.counts.expected.offers as Record<string, unknown>).noopHeld;
  const without = parseImpactDealsApplyResponse(value);
  assert.ok(without && "counts" in without);
  assert.equal(without.counts.expected.offers.noopHeld, undefined);
  (value.counts.expected.offers as Record<string, unknown>).noopHeld = -1;
  assert.equal(parseImpactDealsApplyResponse(value), null);
});
test("apply rejects malformed success contract, UUID, timestamp, scope, mode and plan flag", () => {
  for (const [field, bad] of [
    ["status", "ready"],
    ["runId", "bad"],
    ["evaluationTimestamp", "1"],
    ["evaluationTimestamp", "not-a-date"],
    ["scope", "coupons"],
    ["scope", undefined],
    ["mode", "other"],
    ["mode", undefined],
    ["refreshedPlan", false],
    ["counts", null],
    ["counts", {}],
  ])
    assert.equal(parseImpactDealsApplyResponse({ ...success(), [String(field)]: bad }), null);
});
test("apply validates and reconciles expected/actual counts without retaining unknown nested data", () => {
  for (const section of ["expected", "actual"] as const) {
    const value = success();
    (value.counts as Record<string, unknown>)[section] = { private: "private" };
    assert.equal(parseImpactDealsApplyResponse(value), null);
  }
  const value = success();
  value.counts.actual.offersCreated++;
  assert.equal(parseImpactDealsApplyResponse(value), null);
  const withPrivate = success();
  (withPrivate.counts.expected as Record<string, unknown>).private = { raw: "private" };
  assert.doesNotMatch(JSON.stringify(parseImpactDealsApplyResponse(withPrivate)), /private/);
});
for (const status of ["blocked", "failed", "indeterminate"] as const) {
  test(`apply ${status} uses bounded safe failure parsing and fixed user copy`, () => {
    const result = parseImpactDealsApplyResponse({
      status,
      stage: "persistence_plan",
      reason: "plan_blocked",
      rpcStage: "store_insert",
      rpcReason: "integration_disabled",
      blockerReasonCounts: { expired: 2, negative: -1, fraction: 1.5, ["x".repeat(81)]: 2 },
      body: { private: "secret" },
      message: "private",
      credentials: "secret",
    });
    assert.ok(result && "message" in result);
    assert.equal(result.status, status);
    assert.deepEqual(result.blockerReasonCounts, { expired: 2 });
    assert.equal(result.stage, "persistence_plan");
    assert.equal(result.rpcStage, "store_insert");
    assert.doesNotMatch(JSON.stringify(result), /private|secret|credentials/);
    const bounded = parseImpactDealsApplyResponse({
      status,
      stage: "x".repeat(81),
      reason: "https://private.test",
      blockerReasonCounts: Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [`code_${i}`, i]),
      ),
    });
    assert.ok(bounded && "message" in bounded);
    assert.equal(bounded.stage, undefined);
    assert.equal(bounded.reason, undefined);
    assert.equal(Object.keys(bounded.blockerReasonCounts ?? {}).length, 50);
  });
}
for (const [reason, expected] of [
  ["provider_fetch_failed", "Impact could not be fully read. No Deals were imported."],
  ["plan_blocked", "The Deals import was blocked by safety or catalog checks."],
  ["deals_only_invariant_failed", "The Deals safety check failed. No import was applied."],
  ["unauthorized", "Administrator access is required."],
  ["integration_disabled", "Enable this Impact integration before importing."],
])
  test(`maps ${reason} to concise copy`, () => {
    const result = parseImpactDealsApplyResponse({ status: "failed", reason });
    assert.ok(result && "message" in result);
    assert.equal(result.message, expected);
  });
test("HTTP error envelopes are parsed safely for both endpoints", async () => {
  const httpError = (body: unknown) => ({
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status: 403 }),
  });
  const review = await requestImpactDealsPreview(integrationId, async () => ({
    data: null,
    error: httpError({ error: { code: "unauthorized", message: "private" } }),
  }));
  assert.ok("message" in review);
  assert.equal(review.message, "Administrator access is required.");
  const apply = await requestImpactDealsApply(integrationId, async () => ({
    data: null,
    error: httpError({ status: "failed", reason: "integration_disabled", raw: "private" }),
  }));
  assert.ok("message" in apply);
  assert.equal(apply.message, "Enable this Impact integration before importing.");
  assert.doesNotMatch(JSON.stringify([review, apply]), /private/);
});
test("oversized or malformed HTTP error body keeps apply outcome indeterminate", async () => {
  for (const body of [
    "not-json",
    JSON.stringify({ status: "failed", reason: "unauthorized", raw: "x".repeat(17_000) }),
    JSON.stringify(success()),
  ]) {
    const result = await requestImpactDealsApply(integrationId, async () => ({
      data: null,
      error: { name: "FunctionsHttpError", context: new Response(body, { status: 500 }) },
    }));
    assert.equal(result.status, "indeterminate");
  }
});
test("apply transport errors and malformed responses become indeterminate with no retry", async () => {
  for (const kind of ["throw", "error", "malformed", "success_with_error"]) {
    let calls = 0;
    const result = await requestImpactDealsApply(integrationId, async () => {
      calls++;
      if (kind === "throw") throw new Error("private transport");
      return {
        data: kind === "success_with_error" ? success() : null,
        error: kind === "malformed" ? null : new Error("private"),
      };
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "indeterminate");
    assert.ok("message" in result);
    assert.match(result.message, /Do not retry immediately\. Check Deals and Import History first/);
  }
});
test("read-only preview transport failures run once and fail safely", async () => {
  let calls = 0;
  const result = await requestImpactDealsPreview(integrationId, async () => {
    calls++;
    throw new Error("private");
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test("structured apply rejections remain failures, never fabricated success", async () => {
  const result = await requestImpactDealsApply(integrationId, async () => ({
    data: { status: "blocked", reason: "plan_blocked" },
    error: new Error("http"),
  }));
  assert.equal(result.status, "blocked");
});
test("client and admin have no canary request, raw logging, manual tokens or automatic retry", () => {
  assert.equal(IMPACT_DEALS_MUTATION_OPTIONS.retry, false);
  const client = readFileSync(new URL("./affiliate-sync-deals.client.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../routes/admin.integrations.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client + admin, /canary/);
  assert.doesNotMatch(
    client,
    /console\.|getSession|getAccessToken|Authorization|setTimeout|setInterval/,
  );
  assert.match(client, /supabase\.functions\.invoke/);
});
