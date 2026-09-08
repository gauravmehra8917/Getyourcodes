import type {
  AdMerchantUnresolvedReasonV2,
  AdStoreAssociationV2,
  RawImpactAdV2,
  RawImpactCampaignForAdsV2,
  ResolvedImpactAdV2,
} from "./ad-models.ts";
import type {
  AdsCampaignIndexDiagnosticsV2,
  ImpactAdMerchantDiagnosticsV2,
} from "./ads-diagnostics.ts";

export interface ImpactAdsCampaignIndexEntryV2 {
  retainedCampaign: RawImpactCampaignForAdsV2;
  advertiserIds: ReadonlySet<string>;
  occurrences: number;
}

export interface ImpactAdsCampaignIndexV2 {
  campaignsById: ReadonlyMap<string, ImpactAdsCampaignIndexEntryV2>;
  diagnostics: AdsCampaignIndexDiagnosticsV2;
}

export interface ImpactAdMerchantResolutionResultV2 {
  ads: ResolvedImpactAdV2[];
  campaignIndex: ImpactAdsCampaignIndexV2;
  diagnostics: ImpactAdMerchantDiagnosticsV2;
}

interface MutableCampaignIndexEntryV2 {
  retainedCampaign: RawImpactCampaignForAdsV2;
  advertiserIds: Set<string>;
  occurrences: number;
}

function compareCampaigns(
  left: RawImpactCampaignForAdsV2,
  right: RawImpactCampaignForAdsV2,
): number {
  return left.provenance.fetchSequence - right.provenance.fetchSequence ||
    left.provenance.recordIndex - right.provenance.recordIndex;
}

export function buildCampaignIndexV2(
  campaigns: readonly RawImpactCampaignForAdsV2[],
): ImpactAdsCampaignIndexV2 {
  const ordered = campaigns
    .map((campaign, inputIndex) => ({ campaign, inputIndex }))
    .sort((left, right) =>
      compareCampaigns(left.campaign, right.campaign) ||
      left.inputIndex - right.inputIndex
    );
  const index = new Map<string, MutableCampaignIndexEntryV2>();
  let duplicateCampaignRecords = 0;
  for (const { campaign } of ordered) {
    if (!campaign.campaignId) {
      throw new Error("Campaign index accepts only non-empty CampaignIds");
    }
    const retained = index.get(campaign.campaignId);
    if (!retained) {
      index.set(campaign.campaignId, {
        retainedCampaign: campaign,
        advertiserIds: new Set(
          campaign.advertiserId === null ? [] : [campaign.advertiserId],
        ),
        occurrences: 1,
      });
      continue;
    }
    duplicateCampaignRecords += 1;
    retained.occurrences += 1;
    if (campaign.advertiserId !== null) {
      retained.advertiserIds.add(campaign.advertiserId);
    }
  }
  const entries = [...index.values()];
  return {
    campaignsById: index,
    diagnostics: {
      acceptedCampaignRecords: campaigns.length,
      indexedCampaigns: index.size,
      duplicateCampaignRecords,
      duplicatedCampaignIdentities: entries.filter(
        (entry) => entry.occurrences > 1,
      ).length,
      campaignIdentitiesWithAdvertiserConflicts: entries.filter(
        (entry) => entry.advertiserIds.size > 1,
      ).length,
      campaignsMissingAdvertiserId: entries.filter(
        (entry) => entry.advertiserIds.size === 0,
      ).length,
    },
  };
}

function unresolved(
  reason: AdMerchantUnresolvedReasonV2,
): AdStoreAssociationV2 {
  return {
    providerStoreKey: null,
    matchMethod: "unmatched",
    unresolvedReason: reason,
  };
}

function emptyReasons(): Record<AdMerchantUnresolvedReasonV2, number> {
  return {
    missing_campaign_id: 0,
    unknown_campaign_id: 0,
    campaign_advertiser_conflict: 0,
  };
}

/** Direct CampaignId only. AdvertiserId is an exact cross-check, never fallback. */
export class ImpactAdMerchantResolver {
  static resolve(
    uniqueAds: readonly RawImpactAdV2[],
    campaigns: readonly RawImpactCampaignForAdsV2[],
  ): ImpactAdMerchantResolutionResultV2 {
    const campaignIndex = buildCampaignIndexV2(campaigns);
    const unresolvedReasonCounts = emptyReasons();
    const campaignIds = new Set<string>();
    const advertiserIds = new Set<string>();
    const resolvedKeys = new Set<string>();
    const ads: ResolvedImpactAdV2[] = [];
    let resolvedByCampaignId = 0;
    let advertiserCrossCheckAvailable = 0;
    let advertiserCrossCheckUnavailable = 0;
    let advertiserConflicts = 0;

    for (const ad of uniqueAds) {
      if (ad.campaignId !== null) campaignIds.add(ad.campaignId);
      if (ad.advertiserId !== null) advertiserIds.add(ad.advertiserId);
      let association: AdStoreAssociationV2;
      if (ad.campaignId === null) {
        association = unresolved("missing_campaign_id");
      } else {
        const campaign = campaignIndex.campaignsById.get(ad.campaignId);
        if (!campaign) {
          association = unresolved("unknown_campaign_id");
        } else if (
          ad.advertiserId !== null && campaign.advertiserIds.size > 0 &&
          (campaign.advertiserIds.size !== 1 ||
            !campaign.advertiserIds.has(ad.advertiserId))
        ) {
          advertiserCrossCheckAvailable += 1;
          advertiserConflicts += 1;
          association = unresolved("campaign_advertiser_conflict");
        } else {
          if (
            ad.advertiserId !== null && campaign.advertiserIds.size === 1
          ) advertiserCrossCheckAvailable += 1;
          else advertiserCrossCheckUnavailable += 1;
          resolvedByCampaignId += 1;
          resolvedKeys.add(ad.campaignId);
          association = {
            providerStoreKey: {
              provider: "impact",
              namespace: "campaign",
              id: ad.campaignId,
            },
            matchMethod: "campaign_id",
            unresolvedReason: null,
          };
        }
      }
      if (association.matchMethod === "unmatched") {
        unresolvedReasonCounts[association.unresolvedReason] += 1;
      }
      ads.push({ ad, association });
    }

    const unresolvedTotal = uniqueAds.length - resolvedByCampaignId;
    return {
      ads,
      campaignIndex,
      diagnostics: {
        adsEvaluated: uniqueAds.length,
        resolvedByCampaignId,
        unresolvedTotal,
        unresolvedReasonCounts,
        distinctCampaignIdsReferenced: campaignIds.size,
        distinctAdvertiserIdsReferenced: advertiserIds.size,
        distinctResolvedProviderStoreKeys: resolvedKeys.size,
        advertiserCrossCheckAvailable,
        advertiserCrossCheckUnavailable,
        advertiserConflicts,
      },
    };
  }
}
