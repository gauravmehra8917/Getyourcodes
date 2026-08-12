import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "../../models.ts";

function campaign(campaignId: string, fetchSequence: number): RawImpactCampaignV2 {
  return {
    campaignId,
    advertiserId: "advertiser-ambiguous",
    campaignName: `Campaign ${campaignId}`,
    destinationUrl: `https://merchant.example/${campaignId}`,
    trackingUrl: `https://track.example/${campaignId}`,
    raw: { CampaignId: campaignId, AdvertiserId: "advertiser-ambiguous" },
    provenance: {
      stream: "campaigns",
      fetchSequence,
      recordIndex: 0,
      sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Campaigns?Page=${fetchSequence}`,
      sanitizedSourceContinuationUrl: null,
      providerPage: String(fetchSequence),
      providerPageSize: "100",
    },
  };
}

/** One advertiser intentionally maps to two campaigns and must remain ambiguous. */
export const ambiguousAdvertiserCampaigns: RawImpactCampaignV2[] = [
  campaign("campaign-ambiguous-1", 1),
  campaign("campaign-ambiguous-2", 2),
];

export const ambiguousAdvertiserPromotion: RawImpactPromotionV2 = {
  promotionId: "promotion-ambiguous-advertiser",
  advertiserId: "advertiser-ambiguous",
  advertiserName: "Presentation-only merchant name",
  campaignId: null,
  programId: "program-ambiguous",
  raw: { PromotionIds: "promotion-ambiguous-advertiser", AdvertiserId: "advertiser-ambiguous" },
  provenance: {
    stream: "promotions",
    fetchSequence: 1,
    recordIndex: 0,
    sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=1",
    sanitizedSourceContinuationUrl: null,
    providerPage: "1",
    providerPageSize: "100",
  },
};
