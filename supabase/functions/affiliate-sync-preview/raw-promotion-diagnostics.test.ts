import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  RawPromotionDiagnosticsCollector,
  sanitizePromotionDiagnosticUrl,
} from "../_shared/affiliate-sync-core/diagnostics/RawPromotionDiagnostics.ts";
import { IntegrationEngine } from "../_shared/affiliate-sync-core/integration-engine/engine.ts";
import { ImpactAdapter } from "../_shared/affiliate-sync-core/providers/adapters/ImpactAdapter.ts";
import { ImpactNormalizer } from "../_shared/affiliate-sync-core/normalizers/impact/ImpactNormalizer.ts";

const REQUEST = "https://api.impact.com/Mediapartners/2303074/Promotions?Page=1&PageSize=2";

function page(
  pageNumber: number,
  promotions: Record<string, unknown>[],
  next = pageNumber < 2
    ? "/Mediapartners/2303074/Promotions?Page=2&PageSize=2&Sort=UpdatedDate"
    : undefined,
) {
  return {
    "@page": String(pageNumber),
    "@pagesize": "2",
    "@total": "4",
    "@numpages": "2",
    "@uri": `/Mediapartners/2303074/Promotions?Page=${pageNumber}&PageSize=2`,
    ...(next ? { "@nextpageuri": next } : {}),
    Promotions: promotions,
  };
}

test("preserves raw page provenance and duplicate PromotionIds across pages", () => {
  const collector = new RawPromotionDiagnosticsCollector();
  collector.recordPage({
    requestedPage: 1,
    requestedPageSize: 2,
    requestedUrl: REQUEST,
    body: page(1, [
      { PromotionIds: "duplicate", AdvertiserId: "advertiser-a", AdvertiserName: "Alpha" },
      { PromotionIds: "one", AdvertiserId: "advertiser-b", AdvertiserName: "Beta" },
    ]),
  });
  collector.recordPage({
    requestedPage: 2,
    requestedPageSize: 2,
    requestedUrl: REQUEST.replace("Page=1", "Page=2"),
    body: page(2, [
      { PromotionIds: "duplicate", AdvertiserId: "advertiser-c", AdvertiserName: "Gamma" },
      { PromotionIds: "two", AdvertiserId: "advertiser-c", AdvertiserName: "Gamma" },
    ]),
  });

  const snapshot = collector.snapshot();
  assert.deepEqual(
    snapshot.pages.map((entry) => entry.requestedPageNumber),
    [1, 2],
  );
  assert.deepEqual(snapshot.duplicatePromotionProvenance, [
    {
      providerId: "duplicate",
      occurrenceCount: 2,
      pages: [1, 2],
    },
  ]);
});

test("uses raw promotion advertiser values for distributions and target records", () => {
  const input = page(1, [
    {
      PromotionIds: "26b410_ridgid_10off",
      PromotionTitle: "RIDGID 10% off",
      AdvertiserId: "ridgid-id",
      AdvertiserName: "RIDGID",
      CampaignId: "campaign-r",
      ProgramId: "program-r",
      Uri: "/Mediapartners/2303074/Promotions/26b410_ridgid_10off",
    },
    { PromotionIds: "other", AdvertiserId: "other-id", AdvertiserName: "Other" },
  ]);
  const original = structuredClone(input);
  const collector = new RawPromotionDiagnosticsCollector();
  collector.recordPage({
    requestedPage: 1,
    requestedPageSize: 2,
    requestedUrl: REQUEST,
    body: input,
  });

  const snapshot = collector.snapshot();
  assert.deepEqual(input, original, "diagnostics must not mutate the raw provider response");
  assert.deepEqual(snapshot.pages[0].topAdvertisers, [
    { advertiserId: "other-id", advertiserName: "Other", count: 1 },
    { advertiserId: "ridgid-id", advertiserName: "RIDGID", count: 1 },
  ]);
  assert.deepEqual(snapshot.targetRawPromotionRecords, [
    {
      promotionIds: "26b410_ridgid_10off",
      promotionTitle: "RIDGID 10% off",
      advertiserId: "ridgid-id",
      advertiserName: "RIDGID",
      campaignId: "campaign-r",
      programId: "program-r",
      sanitizedUri: "/Mediapartners/••••3074/Promotions/26b410_ridgid_10off",
      pageNumber: 1,
    },
  ]);
});

test("sanitizes AccountSID and credential-shaped URL components", () => {
  const sanitized = sanitizePromotionDiagnosticUrl(
    "https://username:basic-secret@api.impact.com/Mediapartners/account-super-secret/Promotions?Page=1&Authorization=Basic%20secret&auth=provider-auth&token=provider-token#fragment-secret",
  );
  assert.equal(sanitized, "https://api.impact.com/Mediapartners/••••cret/Promotions?Page=1");
  assert.equal(sanitized?.includes("account-super-secret"), false);
  assert.equal(sanitized?.includes("basic-secret"), false);
  assert.equal(sanitized?.toLowerCase().includes("authorization"), false);
  assert.equal(sanitized?.toLowerCase().includes("provider-auth"), false);
  assert.equal(sanitized?.includes("provider-token"), false);
  assert.equal(sanitized?.includes("fragment-secret"), false);
});

test("compares the reconstructed URL with additional next-page parameters", () => {
  const collector = new RawPromotionDiagnosticsCollector();
  collector.recordPage({
    requestedPage: 1,
    requestedPageSize: 2,
    requestedUrl: REQUEST,
    body: page(1, [{ PromotionIds: "one", AdvertiserId: "a" }]),
  });
  const comparison = collector.snapshot().pages[0].nextPageComparison;
  assert.deepEqual(
    comparison && {
      samePath: comparison.samePath,
      sameQueryParameters: comparison.sameQueryParameters,
      onlyInImpact: comparison.parametersOnlyInNextPageUri,
      onlyInReconstructed: comparison.parametersOnlyInReconstructedRequest,
      different: comparison.parametersWithDifferentValues,
    },
    {
      samePath: true,
      sameQueryParameters: false,
      onlyInImpact: ["Sort"],
      onlyInReconstructed: [],
      different: [],
    },
  );
});

test("observing Promotions does not change adapter records or normalized output", async () => {
  const raw = page(1, [
    {
      PromotionIds: "26b212_acme_10off",
      PromotionTitle: "Save 10%",
      AdvertiserId: "advertiser-1",
      AdvertiserName: "Acme",
      GenericRedemptionCode: "SAVE10",
    },
  ]);
  const engine = IntegrationEngine.fromConfig(
    {
      id: "test-impact",
      name: "Impact",
      providerName: "Impact",
      providerType: "affiliate_network",
      authenticationType: "basic",
      baseUrl: "https://api.impact.com",
      timeoutMs: 1_000,
      retryAttempts: 0,
      customHeaders: [],
      endpoints: { deals: "/Mediapartners/{AccountSID}/Promotions" },
      environment: "test",
      isEnabled: true,
      credentials: { username: "2303074", password: "secret" },
    },
    {
      validate: () => ({ ok: true, errors: [] }),
      request: async (_config, options) => ({
        success: true,
        status: 200,
        latencyMs: 0,
        headers: {},
        body: structuredClone(raw),
        error: null,
        retryCount: 0,
        meta: {
          integrationId: "test-impact",
          method: "GET" as const,
          url: `https://api.impact.com/Mediapartners/2303074/Promotions?Page=${options.query?.Page ?? 1}&PageSize=${options.query?.PageSize ?? 100}`,
          at: new Date().toISOString(),
        },
      }),
      healthCheck: async () => {
        throw new Error("not used");
      },
    },
  );
  const adapter = new ImpactAdapter(engine);
  const normalizer = new ImpactNormalizer();

  const withoutDiagnostics = await adapter.fetchPromotions({ page: 1, pageSize: 100 });
  const normalizedWithoutDiagnostics = normalizer.normalizePromotions(
    withoutDiagnostics.body ?? [],
  );
  adapter.enableRawPromotionDiagnostics();
  const withDiagnostics = await adapter.fetchPromotions({ page: 1, pageSize: 100 });
  const normalizedWithDiagnostics = normalizer.normalizePromotions(withDiagnostics.body ?? []);

  assert.deepEqual(withDiagnostics.body, withoutDiagnostics.body);
  assert.deepEqual(normalizedWithDiagnostics.body, normalizedWithoutDiagnostics.body);
  assert.equal(adapter.getRawPromotionDiagnostics()?.pages.length, 1);
});

test("temporary diagnostics have no persistence or Supabase path", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "supabase/functions/_shared/affiliate-sync-core/diagnostics/RawPromotionDiagnostics.ts",
    ),
    "utf8",
  );
  for (const forbidden of [
    "supabase",
    ".from(",
    ".insert(",
    ".update(",
    ".upsert(",
    ".delete(",
    ".rpc(",
    "fetch(",
  ]) {
    assert.equal(
      source.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `diagnostics contains ${forbidden}`,
    );
  }
});
