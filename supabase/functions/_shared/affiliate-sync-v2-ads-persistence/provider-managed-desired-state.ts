import type {
  AdsOfferCreateProjectionV2,
  AdsStoreCreateProjectionV2,
} from "./ads-persistence-models.ts";
import type {
  AdsProviderManagedOfferDesiredStateV2,
  AdsProviderManagedStoreDesiredStateV2,
} from "./ads-persistence-refresh-models.ts";

/**
 * Converts an already-validated Campaign create projection into the
 * stricter provider-managed state permitted inside an Ads-2 UPDATE.
 *
 * This is intentionally explicit instead of casting the historical/current
 * snapshot type. Presentation, SEO, logo, slug and lifecycle presentation
 * fields cannot cross this boundary.
 */
export function providerManagedStoreDesiredStateFromProjectionV2(
  projection: AdsStoreCreateProjectionV2,
): AdsProviderManagedStoreDesiredStateV2 {
  return {
    affiliateUrl: projection.affiliateUrl,
    metadata: {
      advertiserId:
        projection.metadata.advertiserId,
      campaignId:
        projection.metadata.campaignId,
      campaignName:
        projection.metadata.campaignName,
      destinationUrl:
        projection.metadata.destinationUrl,
      trackingUrl:
        projection.metadata.trackingUrl,
    },
  };
}

/**
 * Converts an already-validated Ad create projection into the stricter
 * provider-managed state permitted inside an Ads-2 UPDATE.
 *
 * The projection contract proves the required Ad/Campaign IDs and normalized
 * names are non-null strings. Only provider-owned operational fields are
 * copied; visible presentation and SEO remain outside UPDATE authority.
 */
export function providerManagedOfferDesiredStateFromProjectionV2(
  projection: AdsOfferCreateProjectionV2,
): AdsProviderManagedOfferDesiredStateV2 {
  return {
    couponCode:
      projection.couponCode,
    affiliateUrl:
      projection.affiliateUrl,
    landingPageUrl:
      projection.landingPageUrl,
    startDate:
      projection.startDate,
    expiryDate:
      projection.expiryDate,
    status:
      projection.status,
    terms:
      projection.terms,
    discountType:
      projection.discountType,
    discountValue:
      projection.discountValue,
    structuredTerms:
      projection.structuredTerms === null
        ? null
        : { ...projection.structuredTerms },
    metadata: {
      adId:
        projection.metadata.adId,
      campaignId:
        projection.metadata.campaignId,
      advertiserId:
        projection.metadata.advertiserId,
      dealId:
        projection.metadata.dealId,
      campaignName:
        projection.metadata.campaignName,
      adName:
        projection.metadata.adName,
      dealStartDate:
        projection.metadata.dealStartDate,
      dealEndDate:
        projection.metadata.dealEndDate,
      startDate:
        projection.metadata.startDate,
      endDate:
        projection.metadata.endDate,
    },
  };
}
