import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsOfferCreateProjectionV2,
  AdsStoreCreateProjectionV2,
} from "../ads-persistence-models.ts";
import {
  providerManagedOfferStateFromProjectionV2,
  providerManagedStoreStateFromProjectionV2,
  sameProviderManagedOfferStateV2,
  sameProviderManagedStoreStateV2,
} from "../provider-managed-state.ts";

function storeProjection(): AdsStoreCreateProjectionV2 {
  return {
    name: "Acme Store",
    slugCandidate: "acme-store",
    description: "Curated description",
    affiliateUrl: "https://acme.example/",
    destinationUrl: "https://acme.example/",
    country: null,
    shippingRegions: [],
    logoSourceUrl: null,
    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: "Campaign-A",
      campaignName: "Acme Store",
      destinationUrl: "https://acme.example/",
      trackingUrl: "https://track.example/campaign",
    },
    importOrigin: "provider",
    lifecycleManaged: true,
    lifecycleHidden: false,
    lastQualificationResult: "qualified",
    lastQualifiedAt: "2026-09-15T00:00:00.000Z",
    seoTitle: "Curated SEO title",
    seoDescription: "Curated SEO description",
    seoCanonicalUrl: "https://getyourcodes.com/acme-store-coupons",
  };
}

function offerProjection(): AdsOfferCreateProjectionV2 {
  return {
    title: "Curated visible title",
    description: "Curated visible description",
    couponCode: "SAVE20",
    couponType: "code",
    affiliateUrl: "https://track.example/ad",
    landingPageUrl: "https://acme.example/coupon",
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
      campaignName: "Acme Store",
      adName: "Provider Ad Name",
      dealStartDate: "2026-09-01T00:00:00Z",
      dealEndDate: "2026-12-31T23:59:59Z",
      startDate: "2026-08-01",
      endDate: "2027-01-31",
    },
    seoTitle: "Curated coupon SEO title",
    seoDescription: "Curated coupon SEO description",
    seoCanonicalUrl:
      "https://getyourcodes.com/acme-store-coupons#curated-visible-title",
  };
}

test("store managed state excludes presentation, logo and SEO fields", () => {
  const first = storeProjection();
  const second = {
    ...first,
    name: "Manually Curated Store Name",
    slugCandidate: "manual-store-slug",
    description: "Manual description",
    logoSourceUrl: "https://cdn.example/manual-logo.png",
    seoTitle: "Manual SEO title",
    seoDescription: "Manual SEO description",
    seoCanonicalUrl: "https://getyourcodes.com/manual-store",
  };

  assert.equal(
    sameProviderManagedStoreStateV2(
      providerManagedStoreStateFromProjectionV2(first),
      providerManagedStoreStateFromProjectionV2(second),
    ),
    true,
  );
});

test("store managed comparison detects provider operational changes", () => {
  const first = providerManagedStoreStateFromProjectionV2(storeProjection());
  const changedProjection = storeProjection();

  changedProjection.metadata.trackingUrl =
    "https://track.example/campaign-new";

  assert.equal(
    sameProviderManagedStoreStateV2(
      first,
      providerManagedStoreStateFromProjectionV2(changedProjection),
    ),
    false,
  );
});

test("offer managed state excludes visible presentation and SEO fields", () => {
  const first = offerProjection();
  const second = {
    ...first,
    title: "Manually Curated Coupon Title",
    description: "Manual coupon description",
    seoTitle: "Manual coupon SEO title",
    seoDescription: "Manual coupon SEO description",
    seoCanonicalUrl:
      "https://getyourcodes.com/acme-store-coupons#manual-title",
  };

  assert.equal(
    sameProviderManagedOfferStateV2(
      providerManagedOfferStateFromProjectionV2(first),
      providerManagedOfferStateFromProjectionV2(second),
    ),
    true,
  );
});

test("offer managed comparison detects coupon, date and status changes", () => {
  const first = providerManagedOfferStateFromProjectionV2(offerProjection());

  const changed = offerProjection();
  changed.couponCode = "SAVE25";
  changed.expiryDate = "2027-01-31";
  changed.status = "expired";

  assert.equal(
    sameProviderManagedOfferStateV2(
      first,
      providerManagedOfferStateFromProjectionV2(changed),
    ),
    false,
  );
});

test("offer managed comparison detects terms and provider metadata changes", () => {
  const first = providerManagedOfferStateFromProjectionV2(offerProjection());

  const changed = offerProjection();
  changed.structuredTerms = {
    ...changed.structuredTerms!,
    minimumPurchase: 75,
  };
  changed.metadata = {
    ...changed.metadata,
    dealId: "Deal-B",
  };

  assert.equal(
    sameProviderManagedOfferStateV2(
      first,
      providerManagedOfferStateFromProjectionV2(changed),
    ),
    false,
  );
});

test("managed snapshots are detached from projection metadata objects", () => {
  const projection = offerProjection();
  const snapshot = providerManagedOfferStateFromProjectionV2(projection);

  projection.metadata.dealId = "Later-Mutation";
  if (projection.structuredTerms) {
    projection.structuredTerms.minimumPurchase = 999;
  }

  assert.equal(snapshot.metadata.dealId, "Deal-A");
  assert.equal(snapshot.structuredTerms?.minimumPurchase, 50);
});
