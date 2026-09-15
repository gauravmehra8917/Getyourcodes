import type {
  AdsOfferCreateProjectionV2,
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
  AdsStoreCreateProjectionV2,
} from "./ads-persistence-models.ts";

export type {
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "./ads-persistence-models.ts";

function copyStructuredTerms(
  value: ImpactAdStructuredTermsV2 | null,
): ImpactAdStructuredTermsV2 | null {
  return value === null ? null : { ...value };
}

export function providerManagedStoreStateFromProjectionV2(
  projection: AdsStoreCreateProjectionV2,
): AdsProviderManagedStoreStateV2 {
  return {
    affiliateUrl: projection.affiliateUrl,
    metadata: {
      advertiserId: projection.metadata.advertiserId,
      campaignId: projection.metadata.campaignId,
      campaignName: projection.metadata.campaignName,
      destinationUrl: projection.metadata.destinationUrl,
      trackingUrl: projection.metadata.trackingUrl,
    },
  };
}

export function providerManagedOfferStateFromProjectionV2(
  projection: AdsOfferCreateProjectionV2,
): AdsProviderManagedOfferStateV2 {
  return {
    couponCode: projection.couponCode,
    affiliateUrl: projection.affiliateUrl,
    landingPageUrl: projection.landingPageUrl,
    startDate: projection.startDate,
    expiryDate: projection.expiryDate,
    status: projection.status,
    terms: projection.terms,
    discountType: projection.discountType,
    discountValue: projection.discountValue,
    structuredTerms: copyStructuredTerms(projection.structuredTerms),
    metadata: {
      adId: projection.metadata.adId,
      campaignId: projection.metadata.campaignId,
      advertiserId: projection.metadata.advertiserId,
      dealId: projection.metadata.dealId,
      campaignName: projection.metadata.campaignName,
      adName: projection.metadata.adName,
      dealStartDate: projection.metadata.dealStartDate,
      dealEndDate: projection.metadata.dealEndDate,
      startDate: projection.metadata.startDate,
      endDate: projection.metadata.endDate,
    },
  };
}

function sameStructuredTerms(
  left: ImpactAdStructuredTermsV2 | null,
  right: ImpactAdStructuredTermsV2 | null,
): boolean {
  if (left === null || right === null) return left === right;

  return left.minimumPurchase === right.minimumPurchase &&
    left.maximumSavings === right.maximumSavings &&
    left.purchaseLimit === right.purchaseLimit &&
    left.scope === right.scope &&
    left.currency === right.currency &&
    left.text === right.text;
}

export function sameProviderManagedStoreStateV2(
  left: AdsProviderManagedStoreStateV2,
  right: AdsProviderManagedStoreStateV2,
): boolean {
  return left.affiliateUrl === right.affiliateUrl &&
    left.metadata.advertiserId === right.metadata.advertiserId &&
    left.metadata.campaignId === right.metadata.campaignId &&
    left.metadata.campaignName === right.metadata.campaignName &&
    left.metadata.destinationUrl === right.metadata.destinationUrl &&
    left.metadata.trackingUrl === right.metadata.trackingUrl;
}

export function sameProviderManagedOfferStateV2(
  left: AdsProviderManagedOfferStateV2,
  right: AdsProviderManagedOfferStateV2,
): boolean {
  return left.couponCode === right.couponCode &&
    left.affiliateUrl === right.affiliateUrl &&
    left.landingPageUrl === right.landingPageUrl &&
    left.startDate === right.startDate &&
    left.expiryDate === right.expiryDate &&
    left.status === right.status &&
    left.terms === right.terms &&
    left.discountType === right.discountType &&
    left.discountValue === right.discountValue &&
    sameStructuredTerms(left.structuredTerms, right.structuredTerms) &&
    left.metadata.adId === right.metadata.adId &&
    left.metadata.campaignId === right.metadata.campaignId &&
    left.metadata.advertiserId === right.metadata.advertiserId &&
    left.metadata.dealId === right.metadata.dealId &&
    left.metadata.campaignName === right.metadata.campaignName &&
    left.metadata.adName === right.metadata.adName &&
    left.metadata.dealStartDate === right.metadata.dealStartDate &&
    left.metadata.dealEndDate === right.metadata.dealEndDate &&
    left.metadata.startDate === right.metadata.startDate &&
    left.metadata.endDate === right.metadata.endDate;
}
