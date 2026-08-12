import type {
  ExistingCatalogSnapshotV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
} from "../../models.ts";

function campaign(input: {
  campaignId: string;
  advertiserId: string;
  campaignName: string;
  recordIndex: number;
}): RawImpactCampaignV2 {
  return {
    campaignId: input.campaignId,
    advertiserId: input.advertiserId,
    campaignName: input.campaignName,
    destinationUrl: `https://${input.campaignId}.example`,
    trackingUrl: `https://track.example/${input.campaignId}`,
    raw: { CampaignId: input.campaignId, AdvertiserId: input.advertiserId },
    provenance: {
      stream: "campaigns",
      fetchSequence: 1,
      recordIndex: input.recordIndex,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Campaigns?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

function promotion(input: {
  promotionId: string;
  advertiserId: string;
  advertiserName: string;
  campaignId: string;
  title: string;
  genericRedemptionCode: string | null;
  recordIndex: number;
}): RawImpactPromotionV2 {
  return {
    promotionId: input.promotionId,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    campaignId: input.campaignId,
    programId: `program-${input.campaignId}`,
    promotionTitle: input.title,
    description: `Direct description for ${input.promotionId}`,
    genericRedemptionCode: input.genericRedemptionCode,
    trackingUrl: `https://track.example/${input.promotionId}`,
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T23:59:59Z",
    raw: { PromotionIds: input.promotionId, GenericRedemptionCode: input.genericRedemptionCode },
    provenance: {
      stream: "promotions",
      fetchSequence: 1,
      recordIndex: input.recordIndex,
      sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=1",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
    },
  };
}

/** Two independent campaign-backed brands: one existing store, one new candidate. */
export const healthyMultiBrandCampaigns: RawImpactCampaignV2[] = [
  campaign({ campaignId: "campaign-acme", advertiserId: "advertiser-acme", campaignName: "Acme", recordIndex: 0 }),
  campaign({ campaignId: "campaign-bravo", advertiserId: "advertiser-bravo", campaignName: "Bravo", recordIndex: 1 }),
];

export const healthyMultiBrandPromotions: RawImpactPromotionV2[] = [
  promotion({
    promotionId: "promotion-acme-coupon", advertiserId: "advertiser-acme", advertiserName: "Acme",
    campaignId: "campaign-acme", title: "Acme 10% off", genericRedemptionCode: "ACME10", recordIndex: 0,
  }),
  promotion({
    promotionId: "promotion-bravo-deal", advertiserId: "advertiser-bravo", advertiserName: "Bravo",
    campaignId: "campaign-bravo", title: "Bravo free shipping", genericRedemptionCode: null, recordIndex: 1,
  }),
];

export const healthyMultiBrandSnapshot: ExistingCatalogSnapshotV2 = {
  stores: [{
    id: "store-acme-existing",
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-acme" },
  }],
  offers: [{ id: "offer-acme-existing", promotionId: "promotion-acme-coupon" }],
};
