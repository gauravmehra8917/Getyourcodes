import type { RawImpactPromotionV2 } from "../../models.ts";

function promotion(
  promotionId: string,
  fetchSequence: number,
  recordIndex: number,
): RawImpactPromotionV2 {
  return {
    promotionId,
    advertiserId: `advertiser-${promotionId}`,
    advertiserName: `Advertiser ${promotionId}`,
    campaignId: `campaign-${promotionId}`,
    programId: `program-${promotionId}`,
    promotionTitle: null,
    description: null,
    genericRedemptionCode: null,
    trackingUrl: null,
    startDate: null,
    endDate: null,
    raw: { PromotionIds: promotionId },
    provenance: {
      stream: "promotions",
      fetchSequence,
      recordIndex,
      sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=${fetchSequence}`,
      sanitizedSourceContinuationUrl: fetchSequence === 1
        ? null
        : "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=2&cursor=%5BREDACTED%5D",
      providerPage: String(fetchSequence),
      providerPageSize: "3",
    },
  };
}

/** Parsed accepted Promotions for the golden overlapping-pages V2-A3 case. */
export const overlappingPagePromotions: RawImpactPromotionV2[] = [
  promotion("A", 1, 0),
  promotion("B", 1, 1),
  promotion("C", 1, 2),
  promotion("C", 2, 0),
  promotion("D", 2, 1),
  promotion("E", 2, 2),
];
