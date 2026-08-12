import type {
  ExistingCatalogSnapshotV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
} from "../../models.ts";

function provenance(stream: "campaigns" | "promotions", recordIndex: number) {
  return {
    stream,
    fetchSequence: 1,
    recordIndex,
    sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/${stream === "campaigns" ? "Campaigns" : "Promotions"}?Page=1`,
    sanitizedSourceContinuationUrl: null,
    providerPage: "1",
    providerPageSize: "100",
  };
}

function campaign(campaignId: string, advertiserId: string, recordIndex: number): RawImpactCampaignV2 {
  return {
    campaignId,
    advertiserId,
    campaignName: campaignId,
    destinationUrl: `https://${campaignId}.example`,
    trackingUrl: `https://track.example/${campaignId}`,
    raw: { CampaignId: campaignId, AdvertiserId: advertiserId },
    provenance: provenance("campaigns", recordIndex),
  };
}

function promotion(input: {
  promotionId: string;
  campaignId: string | null;
  advertiserId: string | null;
  code?: string;
  startDate?: string | null;
  endDate?: string | null;
  recordIndex: number;
}): RawImpactPromotionV2 {
  return {
    promotionId: input.promotionId,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserId,
    campaignId: input.campaignId,
    programId: input.campaignId === null ? null : `program-${input.campaignId}`,
    promotionTitle: input.promotionId,
    description: `Description for ${input.promotionId}`,
    genericRedemptionCode: input.code ?? null,
    trackingUrl: `https://track.example/${input.promotionId}`,
    startDate: input.startDate === undefined ? "2026-01-01T00:00:00Z" : input.startDate,
    endDate: input.endDate === undefined ? "2026-12-31T23:59:59Z" : input.endDate,
    raw: { PromotionIds: input.promotionId, GenericRedemptionCode: input.code ?? null },
    provenance: provenance("promotions", input.recordIndex),
  };
}

export const policyCampaigns: RawImpactCampaignV2[] = [
  campaign("campaign-a", "advertiser-a", 0),
  campaign("campaign-b", "advertiser-b", 1),
];

/**
 * Two resolved campaign stores plus one unresolved offer. The ordering fields
 * intentionally exercise expiry, freshness, and PromotionId tie-breaking.
 */
export const policyPromotions: RawImpactPromotionV2[] = [
  promotion({
    promotionId: "a-coupon-expiring",
    campaignId: "campaign-a",
    advertiserId: "advertiser-a",
    code: "A-EXPIRING",
    endDate: "2026-06-15T00:00:00Z",
    recordIndex: 0,
  }),
  promotion({
    promotionId: "a-coupon-newer",
    campaignId: "campaign-a",
    advertiserId: "advertiser-a",
    code: "A-NEWER",
    startDate: "2026-05-01T00:00:00Z",
    recordIndex: 1,
  }),
  promotion({
    promotionId: "a-coupon-a",
    campaignId: "campaign-a",
    advertiserId: "advertiser-a",
    code: "A-A",
    recordIndex: 2,
  }),
  promotion({
    promotionId: "a-coupon-b",
    campaignId: "campaign-a",
    advertiserId: "advertiser-a",
    code: "A-B",
    recordIndex: 3,
  }),
  promotion({ promotionId: "a-deal-a", campaignId: "campaign-a", advertiserId: "advertiser-a", recordIndex: 4 }),
  promotion({ promotionId: "a-deal-b", campaignId: "campaign-a", advertiserId: "advertiser-a", recordIndex: 5 }),
  promotion({ promotionId: "b-coupon-a", campaignId: "campaign-b", advertiserId: "advertiser-b", code: "B-A", recordIndex: 6 }),
  promotion({ promotionId: "b-coupon-b", campaignId: "campaign-b", advertiserId: "advertiser-b", code: "B-B", recordIndex: 7 }),
  promotion({ promotionId: "b-deal-a", campaignId: "campaign-b", advertiserId: "advertiser-b", recordIndex: 8 }),
  promotion({ promotionId: "b-deal-b", campaignId: "campaign-b", advertiserId: "advertiser-b", recordIndex: 9 }),
  promotion({ promotionId: "b-deal-c", campaignId: "campaign-b", advertiserId: "advertiser-b", recordIndex: 10 }),
  promotion({ promotionId: "unresolved-deal", campaignId: null, advertiserId: null, recordIndex: 11 }),
];

export const policySnapshot: ExistingCatalogSnapshotV2 = {
  stores: [{
    id: "existing-store-a",
    providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-a" },
  }],
  offers: [],
};
