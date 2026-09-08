import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactAdsTransportRequestV2,
  ImpactAdsTransportResultV2,
  ImpactAdsTransportV2,
} from "../../_shared/affiliate-sync-v2-ads/index.ts";
import { createAffiliateSyncAdsPreviewV2Handler } from "../handler.ts";
import type {
  AdsPreviewV2HostDependencies,
  AffiliateSyncAdsPreviewHostResponseV2,
} from "../types.ts";

const ORIGIN = "https://api.impact.com";
const BROWSER_ORIGIN = "http://localhost:8080";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "auth-token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";
const JWT = "jwt-sensitive";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVALUATION_TIMESTAMP = "2026-06-01T12:00:00.000Z";
const CAMPAIGN_COUNT = 177;
const AD_COUNT = 800;

type ProviderEnvelope = Record<string, unknown>;

function opaque(prefix: string, value: number): string {
  return `${prefix}-sensitive-${String(value).padStart(3, "0")}`;
}

const CAMPAIGNS = Array.from({ length: CAMPAIGN_COUNT }, (_, index) => ({
  CampaignId: opaque("campaign", index),
  AdvertiserId: opaque("advertiser", index % 145),
  CampaignName: `Campaign Private ${index}`,
  CampaignUrl: `https://merchant.example/private/${index}`,
  TrackingLink: `https://tracking.example/campaign/private/${index}`,
}));

function liveShapeDealIds(): Array<string | null> {
  const dealIds: string[] = [];
  const append = (dealIndex: number, count: number) => {
    for (let index = 0; index < count; index += 1) {
      dealIds.push(opaque("deal", dealIndex));
    }
  };
  append(0, 17);
  for (let deal = 1; deal <= 4; deal += 1) append(deal, 4);
  for (let deal = 5; deal <= 22; deal += 1) append(deal, 3);
  for (let deal = 23; deal <= 180; deal += 1) append(deal, 1);
  assert.equal(dealIds.length, 245);
  return [
    ...dealIds,
    ...Array.from({ length: AD_COUNT - dealIds.length }, () => null),
  ];
}

const DEAL_IDS = liveShapeDealIds();

function campaignIndexForAd(adIndex: number): number {
  // One store deliberately receives 30 Ads, proving neither the 20 coupon cap
  // nor the 18 deal cap is applied to this source-neutral selection.
  return adIndex < 30 ? 0 : 1 + ((adIndex - 30) % (CAMPAIGN_COUNT - 1));
}

const ADS = Array.from({ length: AD_COUNT }, (_, index) => {
  const campaignIndex = campaignIndexForAd(index);
  const expectedAdvertiser = campaignIndex % 145;
  const record: Record<string, unknown> = {
    Id: opaque("ad", index),
    CampaignId: opaque("campaign", campaignIndex),
    AdvertiserId: opaque(
      "advertiser",
      index === AD_COUNT - 1
        ? (expectedAdvertiser + 1) % 145
        : expectedAdvertiser,
    ),
    Name: `Ad Private Title ${index}`,
    Description: `Ad Private Description ${index}`,
    TrackingLink: `https://tracking.example/ad/private/${index}`,
    LandingPageUrl: `https://merchant.example/ad/private/${index}`,
    StartDate: "2026-01-01T00:00:00.000Z",
    DealDefaultPromoCode: index < 168 ? `PROMO-PRIVATE-${index}` : "  ",
    // Impact Code is deliberately populated for every row. The planner must
    // still classify only the 168 DealDefaultPromoCode-bearing Ads as such.
    Code: `IGNORED-IMPACT-CODE-PRIVATE-${index}`,
  };
  if (DEAL_IDS[index] !== null) record.DealId = DEAL_IDS[index];
  return record;
});

function continuation(
  resource: "Campaigns" | "Ads",
  page: number,
): string {
  const url = new URL(`/Mediapartners/${ACCOUNT_SID}/${resource}`, ORIGIN);
  if (resource === "Ads") url.searchParams.set("Type", "COUPON");
  url.searchParams.set("Page", String(page));
  url.searchParams.set("PageSize", "100");
  return url.toString();
}

function pagedEnvelope(
  resource: "Campaigns" | "Ads",
  records: readonly Record<string, unknown>[],
  page: number,
): ProviderEnvelope {
  const pageCount = Math.ceil(records.length / 100);
  return {
    "@page": String(page),
    "@numpages": String(pageCount),
    "@pagesize": "100",
    "@nextpageuri": page === pageCount
      ? null
      : continuation(resource, page + 1),
    [resource]: records.slice((page - 1) * 100, page * 100),
  };
}

class FixtureTransport implements ImpactAdsTransportV2 {
  readonly requests: ImpactAdsTransportRequestV2[] = [];
  private readonly campaignFailureStatus: number | null;

  constructor(campaignFailureStatus: number | null = null) {
    this.campaignFailureStatus = campaignFailureStatus;
  }

  execute(
    request: ImpactAdsTransportRequestV2,
  ): Promise<ImpactAdsTransportResultV2> {
    this.requests.push(request);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("Page"));
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.credentialDisposition, "attach_if_same_origin");

    if (url.pathname.endsWith("/Campaigns")) {
      if (this.campaignFailureStatus !== null) {
        return Promise.resolve({
          kind: "response",
          status: this.campaignFailureStatus,
          bodyText: "provider-private-body",
          retryAfterMs: null,
        });
      }
      return Promise.resolve({
        kind: "response",
        status: 200,
        bodyText: JSON.stringify(
          pagedEnvelope("Campaigns", CAMPAIGNS, page),
        ),
        retryAfterMs: null,
      });
    }
    assert.equal(url.pathname.endsWith("/Ads"), true);
    return Promise.resolve({
      kind: "response",
      status: 200,
      bodyText: JSON.stringify(pagedEnvelope("Ads", ADS, page)),
      retryAfterMs: null,
    });
  }

  wait(): Promise<void> {
    return Promise.reject(new Error("fixture must not retry"));
  }

  readRateSnapshot() {
    return { limit: null, remaining: null, reset: null };
  }

  consumeResponseSizeLimitExceeded(): boolean {
    return false;
  }
}

function dependencies(
  transport: FixtureTransport,
): AdsPreviewV2HostDependencies {
  return {
    async verifyUser(authorization, jwt) {
      assert.equal(authorization, `Bearer ${JWT}`);
      assert.equal(jwt, JWT);
      return { id: USER_ID };
    },
    createDataSource: () => ({
      async hasAdminRole(userId) {
        assert.equal(userId, USER_ID);
        return true;
      },
      async readIntegration(integrationId) {
        assert.equal(integrationId, INTEGRATION_ID);
        return {
          id: INTEGRATION_ID,
          providerName: "impact",
          authenticationType: "basic",
          baseUrl: ORIGIN,
          endpointConfiguration: {},
          isEnabled: true,
          timeoutSeconds: 30,
          retryAttempts: 0,
          pageSize: 100,
          maxPages: 50,
          publishingPolicyId: null,
        };
      },
      async readCredentialCiphertext(integrationId) {
        assert.equal(integrationId, INTEGRATION_ID);
        return CIPHERTEXT;
      },
      async readPublishingPolicy(policyId) {
        assert.equal(policyId, null);
        return {
          enabled: true,
          minimumCouponsPerStore: 0,
          maximumCouponsPerStore: 20,
          minimumDealsPerStore: 0,
          maximumDealsPerStore: 18,
        };
      },
      async readImpactStoreIdentityRows() {
        return [{
          id: "existing-store-safe-id",
          providerEntityId: opaque("campaign", 0),
        }];
      },
    }),
    async decryptCredentialEnvelope(ciphertext) {
      assert.equal(ciphertext, CIPHERTEXT);
      return JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    },
    createImpactTransport(credentials, approvedCredentialOrigin) {
      assert.deepEqual(credentials, {
        accountSid: ACCOUNT_SID,
        authToken: AUTH_TOKEN,
      });
      assert.equal(approvedCredentialOrigin, ORIGIN);
      return transport;
    },
    now: () => EVALUATION_TIMESTAMP,
    siteUrl: "https://getyourcodes.com",
  };
}

function request(): Request {
  return new Request("https://edge.example/affiliate-sync-ads-preview-v2", {
    method: "POST",
    headers: {
      Origin: BROWSER_ORIGIN,
      Authorization: `Bearer ${JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ integrationId: INTEGRATION_ID, preview: true }),
  });
}

test("177 Campaigns and 800 Ads retain exact identities through aggregate preview", async () => {
  const transport = new FixtureTransport();
  const handler = createAffiliateSyncAdsPreviewV2Handler(
    dependencies(transport),
  );
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    BROWSER_ORIGIN,
  );
  const payload = await response
    .json() as AffiliateSyncAdsPreviewHostResponseV2;
  assert.equal(payload.host.readOnly, true);
  assert.equal(payload.host.existingOfferMatching, "not_evaluated");
  assert.equal(payload.result.complete, true);
  if (!payload.result.complete) assert.fail("fixture must complete");

  const { preview, fetch } = payload.result;
  assert.equal(fetch.campaigns.pagesFetched, 2);
  assert.equal(fetch.campaigns.acceptedRecords, CAMPAIGN_COUNT);
  assert.equal(fetch.ads.pagesFetched, 8);
  assert.equal(fetch.ads.acceptedRecords, AD_COUNT);
  assert.equal(transport.requests.length, 10);

  assert.deepEqual(preview.deduplication, {
    acceptedInputRecords: AD_COUNT,
    uniqueAds: AD_COUNT,
    duplicateRecordsRemoved: 0,
    duplicatedAdIdentities: 0,
    identitiesWithConflictingProviderFields: 0,
  });
  assert.equal(preview.campaignIndex.indexedCampaigns, CAMPAIGN_COUNT);
  assert.equal(preview.merchantIdentity.adsEvaluated, AD_COUNT);
  assert.equal(preview.merchantIdentity.resolvedByCampaignId, AD_COUNT - 1);
  assert.equal(preview.merchantIdentity.unresolvedTotal, 1);
  assert.deepEqual(preview.merchantIdentity.unresolvedReasonCounts, {
    missing_campaign_id: 0,
    unknown_campaign_id: 0,
    campaign_advertiser_conflict: 1,
  });
  assert.equal(preview.merchantIdentity.advertiserConflicts, 1);
  assert.equal(
    preview.merchantIdentity.distinctResolvedProviderStoreKeys,
    CAMPAIGN_COUNT,
  );

  assert.equal(preview.normalization.normalizedOffers, AD_COUNT);
  assert.equal(preview.normalization.normalizedStores, CAMPAIGN_COUNT);
  assert.deepEqual(preview.normalization.codeClassCounts, {
    code_bearing: 168,
    no_code: 632,
  });
  assert.equal(preview.qualification.reasonCounts.unresolved_store, 1);
  assert.equal(preview.selection.sourceNeutralMaxSelectedAdsPerStore, 0);
  assert.equal(preview.selection.selectedAdsTotal, AD_COUNT - 1);
  assert.equal(preview.selection.heldAdsTotal, 1);
  assert.equal(preview.selection.codeBearingSelected, 168);
  assert.equal(preview.selection.noCodeSelected, 631);
  assert.deepEqual(preview.policy.couponCap, {
    value: 20,
    evaluation: "classification_dependent",
  });
  assert.deepEqual(preview.policy.dealCap, {
    value: 18,
    evaluation: "classification_dependent",
  });
  assert.equal(preview.policy.policyQualificationPass, CAMPAIGN_COUNT);
  assert.equal(preview.policy.policyQualificationFail, 0);

  assert.deepEqual(preview.dealCardinality, {
    adsWithDealId: 245,
    adsWithoutDealId: 555,
    distinctDealIds: 181,
    dealIdsWithOneAd: 158,
    dealIdsWithMultipleAds: 23,
    maxAdsPerDeal: 17,
  });
  assert.deepEqual(preview.identityIntegrity, {
    distinctAdIdsAfterFetch: AD_COUNT,
    distinctAdIdsAfterDeduplication: AD_COUNT,
    distinctAdIdsAfterNormalization: AD_COUNT,
    distinctAdIdsAfterFinalDisposition: AD_COUNT,
    distinctProviderStoreKeysAfterResolution: CAMPAIGN_COUNT,
    distinctProviderStoreKeysAfterNormalization: CAMPAIGN_COUNT,
    distinctProviderStoreKeysAfterMatching: CAMPAIGN_COUNT,
    distinctProviderStoreKeysAfterQualification: CAMPAIGN_COUNT,
    identityCollapseDetected: false,
  });

  const serialized = JSON.stringify(payload);
  for (
    const privateValue of [
      opaque("ad", 0),
      opaque("ad", AD_COUNT - 1),
      opaque("campaign", 0),
      opaque("campaign", CAMPAIGN_COUNT - 1),
      opaque("advertiser", 0),
      opaque("deal", 0),
      "PROMO-PRIVATE-0",
      "IGNORED-IMPACT-CODE-PRIVATE-0",
      "Ad Private Title 0",
      "Ad Private Description 0",
      "https://tracking.example/ad/private/0",
      ACCOUNT_SID,
      AUTH_TOKEN,
      CIPHERTEXT,
      JWT,
    ]
  ) assert.equal(serialized.includes(privateValue), false, privateValue);
});

test("incomplete Campaign retrieval blocks Ads contact and planning", async () => {
  const transport = new FixtureTransport(429);
  const handler = createAffiliateSyncAdsPreviewV2Handler(
    dependencies(transport),
  );
  const response = await handler(request());
  assert.equal(response.status, 200);
  const payload = await response
    .json() as AffiliateSyncAdsPreviewHostResponseV2;
  assert.equal(payload.result.complete, false);
  if (payload.result.complete) assert.fail("fixture must be blocked");
  assert.equal(payload.result.blockedStage, "campaign_fetch");
  assert.equal(payload.result.stopReason, "rate_limited");
  assert.equal(payload.result.fetch.ads, null);
  assert.equal(payload.result.preview, null);
  assert.equal(transport.requests.length, 1);
  assert.equal(
    new URL(transport.requests[0]!.url).pathname.endsWith("/Campaigns"),
    true,
  );
  assert.equal(
    JSON.stringify(payload).includes("provider-private-body"),
    false,
  );
});
