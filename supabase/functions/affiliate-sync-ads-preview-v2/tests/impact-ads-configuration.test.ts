import assert from "node:assert/strict";
import test from "node:test";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import { resolveImpactAdsHostConfigV2 } from "../impact-ads-configuration.ts";

const integration: StoredIntegrationV2 = {
  id: "11111111-1111-4111-8111-111111111111",
  providerName: "Impact.com",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: {
    campaigns: "/Mediapartners/{AccountSID}/Campaigns",
  },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 2,
  pageSize: 321,
  maxPages: 42,
  publishingPolicyId: null,
};

const credentials = { accountSid: "account-id", authToken: "token" };

test("host config constructs exact Ads request and stored Campaigns request", () => {
  const resolved = resolveImpactAdsHostConfigV2(integration, credentials);
  const ads = new URL(resolved.adsInitialUrl);
  assert.equal(ads.origin, "https://api.impact.com");
  assert.equal(ads.pathname, "/Mediapartners/account-id/Ads");
  assert.deepEqual([...ads.searchParams.entries()], [
    ["Type", "COUPON"],
    ["Page", "1"],
    ["PageSize", "100"],
  ]);

  const campaigns = new URL(resolved.campaignsInitialUrl);
  assert.equal(campaigns.pathname, "/Mediapartners/account-id/Campaigns");
  assert.equal(campaigns.searchParams.get("Page"), "1");
  assert.equal(campaigns.searchParams.get("PageSize"), "321");
  assert.equal(resolved.campaignLimits.pageSize, 321);
  assert.equal(resolved.campaignLimits.maxPages, 42);
  assert.equal(resolved.campaignLimits.maxPhysicalRequests, 42);
  assert.equal(resolved.campaignLimits.maxAttemptsPerPage, 1);
  assert.equal(resolved.adsLimits.pageSize, 100);
  assert.equal(resolved.adsLimits.maxPages, 25);
  assert.equal(resolved.adsLimits.maxRecords, 2_500);
  assert.equal(resolved.adsLimits.maxPhysicalRequests, 35);
  assert.equal(resolved.adsLimits.maxResponseBytes, 5 * 1024 * 1024);
  assert.equal(resolved.adsLimits.rateRemainingFloor, 10);
  assert.equal(resolved.adsLimits.maxAttemptsPerPage, 3);
  assert.deepEqual(resolved.continuationPolicy, {
    approvedBaseUrl: "https://api.impact.com",
    allowedOrigins: ["https://api.impact.com"],
    accountSidPathSegments: ["account-id"],
  });
});

test("Campaign endpoint permits only the exact trusted Impact resource", () => {
  for (
    const campaigns of [
      "https://evil.example/Mediapartners/{AccountSID}/Campaigns",
      "/Mediapartners/{AccountSID}/Promotions",
      "/Mediapartners/another/Campaigns",
      "/Mediapartners/{AccountSID}/Campaigns#fragment",
      "POST /Mediapartners/{AccountSID}/Campaigns",
      "/Mediapartners/{AccountSID}/{Other}",
      "/Mediapartners/{AccountSID}/Campaigns?Page=2",
      "/Mediapartners/{AccountSID}/Campaigns?Page=1&Page=1",
      "/Mediapartners/{AccountSID}/Campaigns?PageSize=100",
      "/Mediapartners/{AccountSID}/Campaigns?page=1",
      "/Mediapartners/{AccountSID}/Campaigns?pagesize=321",
    ]
  ) {
    assert.throws(() =>
      resolveImpactAdsHostConfigV2(
        {
          ...integration,
          endpointConfiguration: { campaigns },
        },
        credentials,
      )
    );
  }
});

test("base URL, provider and authentication fail closed", () => {
  for (
    const patch of [
      { baseUrl: "http://api.impact.com" },
      { baseUrl: "https://api.impact.com/path" },
      { baseUrl: "https://user:pass@api.impact.com" },
      { providerName: "other" },
      { authenticationType: "bearer" },
    ]
  ) {
    assert.throws(() =>
      resolveImpactAdsHostConfigV2({ ...integration, ...patch }, credentials)
    );
  }
});

test("stored orchestration settings use existing bounded fallback and clamping behavior", () => {
  const resolved = resolveImpactAdsHostConfigV2({
    ...integration,
    timeoutSeconds: 999,
    retryAttempts: 99,
    pageSize: 999,
    maxPages: 999,
  }, credentials);
  assert.equal(resolved.requestTimeoutMs, 30_000);
  assert.equal(resolved.campaignLimits.pageSize, 100);
  assert.equal(resolved.campaignLimits.maxPages, 50);
  assert.equal(resolved.adsLimits.maxAttemptsPerPage, 21);
});
