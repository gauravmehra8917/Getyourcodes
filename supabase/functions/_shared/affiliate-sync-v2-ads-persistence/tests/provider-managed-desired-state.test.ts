import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsOfferCreateProjectionV2,
  AdsStoreCreateProjectionV2,
} from "../ads-persistence-models.ts";
import {
  providerManagedOfferDesiredStateFromProjectionV2,
  providerManagedStoreDesiredStateFromProjectionV2,
} from "../provider-managed-desired-state.ts";

function storeProjection():
  AdsStoreCreateProjectionV2 {
  return {
    name: "Acme & Co.",
    slugCandidate: "acme-and-co",
    description: "Curated description",
    affiliateUrl:
      "https://acme.example/sale",
    destinationUrl:
      "https://acme.example/sale",
    country: "US",
    shippingRegions: ["US"],
    logoSourceUrl:
      "https://assets.example/logo.png",
    metadata: {
      advertiserId: "Advertiser-A",
      campaignId: "Campaign-A",
      campaignName: "Acme & Co.",
      destinationUrl:
        "https://acme.example/sale",
      trackingUrl:
        "https://track.example/campaign",
    },
    importOrigin: "provider",
    lifecycleManaged: true,
    lifecycleHidden: false,
    lastQualificationResult: "qualified",
    lastQualifiedAt:
      "2026-09-15T00:00:00.000Z",
    seoTitle: "Curated SEO title",
    seoDescription:
      "Curated SEO description",
    seoCanonicalUrl:
      "https://getyourcodes.com/acme-and-co-coupons",
  };
}

function offerProjection():
  AdsOfferCreateProjectionV2 {
  return {
    title: "20% Off Summer",
    description:
      "Visible provider description",
    couponCode: "SAVE-20",
    couponType: "code",
    affiliateUrl:
      "https://track.example/ad",
    landingPageUrl:
      "https://acme.example/coupon",
    startDate: "2026-05-01",
    expiryDate: "2026-12-31",
    status: "active",
    terms: "Minimum purchase applies.",
    discountType: "percentage",
    discountValue: 20,
    structuredTerms: null,
    metadata: {
      adId: "Ad-A",
      campaignId: "Campaign-A",
      advertiserId: "Advertiser-A",
      dealId: "Deal-A",
      campaignName: "Acme & Co.",
      adName: "20% Off Summer",
      dealStartDate:
        "2026-05-01T00:00:00Z",
      dealEndDate:
        "2026-12-31T23:59:59Z",
      startDate:
        "2026-04-30T00:00:00Z",
      endDate:
        "2027-01-01T00:00:00Z",
    },
    seoTitle:
      "Provider presentation title",
    seoDescription:
      "Provider presentation description",
    seoCanonicalUrl:
      "https://getyourcodes.com/acme-and-co-coupons#summer",
  };
}

test(
  "Campaign desired state contains only strict provider-owned fields",
  () => {
    const projection =
      storeProjection();

    const desired =
      providerManagedStoreDesiredStateFromProjectionV2(
        projection,
      );

    assert.deepEqual(
      desired,
      {
        affiliateUrl:
          "https://acme.example/sale",
        metadata: {
          advertiserId:
            "Advertiser-A",
          campaignId:
            "Campaign-A",
          campaignName:
            "Acme & Co.",
          destinationUrl:
            "https://acme.example/sale",
          trackingUrl:
            "https://track.example/campaign",
        },
      },
    );

    assert.deepEqual(
      Object.keys(desired).sort(),
      [
        "affiliateUrl",
        "metadata",
      ],
    );

    assert.equal(
      "name" in desired,
      false,
    );

    assert.equal(
      "slugCandidate" in desired,
      false,
    );

    assert.equal(
      "logoSourceUrl" in desired,
      false,
    );

    assert.equal(
      "seoTitle" in desired,
      false,
    );

    assert.equal(
      "lastQualifiedAt" in desired,
      false,
    );
  },
);

test(
  "Ad desired state contains exact strict identity metadata and no presentation fields",
  () => {
    const projection =
      offerProjection();

    const desired =
      providerManagedOfferDesiredStateFromProjectionV2(
        projection,
      );

    assert.equal(
      desired.metadata.adId,
      "Ad-A",
    );

    assert.equal(
      desired.metadata.campaignId,
      "Campaign-A",
    );

    assert.equal(
      desired.metadata.campaignName,
      "Acme & Co.",
    );

    assert.equal(
      desired.metadata.adName,
      "20% Off Summer",
    );

    assert.equal(
      desired.couponCode,
      "SAVE-20",
    );

    assert.equal(
      desired.status,
      "active",
    );

    assert.equal(
      "title" in desired,
      false,
    );

    assert.equal(
      "description" in desired,
      false,
    );

    assert.equal(
      "couponType" in desired,
      false,
    );

    assert.equal(
      "seoTitle" in desired,
      false,
    );

    assert.equal(
      "seoCanonicalUrl" in desired,
      false,
    );
  },
);

test(
  "desired metadata is detached from the create projection",
  () => {
    const store =
      storeProjection();

    const offer =
      offerProjection();

    const desiredStore =
      providerManagedStoreDesiredStateFromProjectionV2(
        store,
      );

    const desiredOffer =
      providerManagedOfferDesiredStateFromProjectionV2(
        offer,
      );

    store.metadata.campaignName =
      "Changed after conversion";

    offer.metadata.adName =
      "Changed after conversion";

    assert.equal(
      desiredStore.metadata.campaignName,
      "Acme & Co.",
    );

    assert.equal(
      desiredOffer.metadata.adName,
      "20% Off Summer",
    );

    assert.notEqual(
      desiredStore.metadata,
      store.metadata,
    );

    assert.notEqual(
      desiredOffer.metadata,
      offer.metadata,
    );
  },
);
