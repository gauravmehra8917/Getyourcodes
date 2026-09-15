import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "../ads-persistence-models.ts";

import {
  decideProviderManagedOfferRefreshV2,
  decideProviderManagedStoreRefreshV2,
} from "../provider-refresh-decision.ts";

function storeState(): AdsProviderManagedStoreStateV2 {
  return {
    affiliateUrl: "https://campaign.example/",
    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: "Campaign-A",
      campaignName: "Campaign Store",
      destinationUrl: "https://campaign.example/",
      trackingUrl: "https://track.example/campaign",
    },
  };
}

function offerState(): AdsProviderManagedOfferStateV2 {
  return {
    couponCode: "SAVE20",
    affiliateUrl: "https://track.example/ad",
    landingPageUrl: "https://campaign.example/coupon",
    startDate: "2026-09-01",
    expiryDate: "2026-12-31",
    status: "active",
    terms: "Provider terms",
    discountType: "percentage",
    discountValue: 20,
    structuredTerms: {
      minimumPurchase: 50,
      maximumSavings: 20,
      purchaseLimit: 1,
      scope: "Sitewide",
      currency: "USD",
      text: null,
    },
    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Campaign Store",
      adName: "Provider Ad",
      dealStartDate: "2026-09-01T00:00:00Z",
      dealEndDate: "2026-12-31T23:59:59Z",
      startDate: "2026-08-01",
      endDate: "2027-01-31",
    },
  };
}

test("identical Campaign managed state is a NOOP", () => {
  const current = storeState();
  const desired = structuredClone(current);

  assert.equal(
    decideProviderManagedStoreRefreshV2(current, desired),
    "noop_existing",
  );
});

test("changed Campaign operational state requires UPDATE", () => {
  const current = storeState();
  const desired = structuredClone(current);

  desired.metadata.trackingUrl =
    "https://track.example/campaign-updated";

  assert.equal(
    decideProviderManagedStoreRefreshV2(current, desired),
    "update_existing",
  );
});

test("missing Campaign snapshot fails closed", () => {
  assert.equal(
    decideProviderManagedStoreRefreshV2(null, storeState()),
    "blocked_missing_snapshot",
  );

  assert.equal(
    decideProviderManagedStoreRefreshV2(undefined, storeState()),
    "blocked_missing_snapshot",
  );
});

test("identical Ad managed state is a NOOP", () => {
  const current = offerState();
  const desired = structuredClone(current);

  assert.equal(
    decideProviderManagedOfferRefreshV2(current, desired),
    "noop_existing",
  );
});

test("changed Ad provider state requires UPDATE", () => {
  const current = offerState();
  const desired = structuredClone(current);

  desired.couponCode = "SAVE25";
  desired.expiryDate = "2027-01-31";
  desired.status = "expired";
  desired.metadata.dealId = "Deal-B";

  assert.equal(
    decideProviderManagedOfferRefreshV2(current, desired),
    "update_existing",
  );
});

test("missing Ad snapshot fails closed", () => {
  assert.equal(
    decideProviderManagedOfferRefreshV2(null, offerState()),
    "blocked_missing_snapshot",
  );

  assert.equal(
    decideProviderManagedOfferRefreshV2(undefined, offerState()),
    "blocked_missing_snapshot",
  );
});
