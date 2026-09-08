import type {
  ImpactAdNormalizationResultV2,
  NormalizedImpactAdOfferV2,
  NormalizedImpactAdStoreV2,
} from "./ad-models.ts";
import type { ImpactAdNormalizationDiagnosticsV2 } from "./ads-diagnostics.ts";
import type {
  ImpactAdMerchantResolutionResultV2,
} from "./ImpactAdMerchantResolver.ts";

export interface ImpactAdOfferNormalizationResultV2
  extends ImpactAdNormalizationResultV2 {
  diagnostics: ImpactAdNormalizationDiagnosticsV2;
}

/** Preserves Ad and Campaign identities; makes no coupon/deal classification. */
export class ImpactAdOfferNormalizer {
  static normalize(
    resolution: ImpactAdMerchantResolutionResultV2,
  ): ImpactAdOfferNormalizationResultV2 {
    const storesByCampaignId = new Map<string, NormalizedImpactAdStoreV2>();
    const offers: NormalizedImpactAdOfferV2[] = [];
    let codeBearing = 0;
    let noCode = 0;

    for (const entry of resolution.ads) {
      const { ad, association } = entry;
      if (ad.codeClass === "code_bearing") codeBearing += 1;
      else noCode += 1;
      if (association.matchMethod !== "unmatched") {
        const campaignId = association.providerStoreKey.id;
        const campaign = resolution.campaignIndex.campaignsById.get(campaignId);
        if (!campaign) {
          throw new Error(
            "Normalizer cannot create a store without its exact Campaign",
          );
        }
        if (!storesByCampaignId.has(campaignId)) {
          const retained = campaign.retainedCampaign;
          storesByCampaignId.set(campaignId, {
            providerStoreKey: { ...association.providerStoreKey },
            campaignId,
            advertiserId: retained.advertiserId,
            name: retained.campaignName,
            destinationUrl: retained.destinationUrl,
            trackingUrl: retained.trackingUrl,
          });
        }
      }
      offers.push({
        providerOfferKey: { ...ad.providerOfferKey },
        campaignId: ad.campaignId,
        advertiserId: ad.advertiserId,
        dealId: ad.dealId,
        title: ad.title,
        description: ad.description,
        trackingUrl: ad.trackingUrl,
        landingPageUrl: ad.landingPageUrl,
        startDate: ad.startDate,
        endDate: ad.endDate,
        codeClass: ad.codeClass,
        association: association.matchMethod === "unmatched"
          ? { ...association }
          : {
            providerStoreKey: { ...association.providerStoreKey },
            matchMethod: "campaign_id",
            unresolvedReason: null,
          },
        provenance: { ...ad.provenance },
      });
    }
    return {
      stores: [...storesByCampaignId.values()],
      offers,
      diagnostics: {
        uniqueAdsEvaluated: resolution.ads.length,
        normalizedOffers: offers.length,
        normalizedStores: storesByCampaignId.size,
        codeClassCounts: {
          code_bearing: codeBearing,
          no_code: noCode,
        },
      },
    };
  }
}
