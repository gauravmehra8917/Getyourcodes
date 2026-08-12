import type { ImpactOfferNormalizationDiagnosticsV2, ImpactRecordProvenanceV2 } from "./diagnostics.ts";
import type { ImpactPromotionAssociationV2 } from "./ImpactMerchantResolver.ts";
import type {
  NormalizedCouponV2,
  NormalizedDealV2,
  NormalizedStoreV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
  StoreOfferAssociationV2,
} from "./models.ts";

export interface ImpactOfferNormalizationResultV2 {
  normalizedStores: NormalizedStoreV2[];
  normalizedCoupons: NormalizedCouponV2[];
  normalizedDeals: NormalizedDealV2[];
  diagnostics: ImpactOfferNormalizationDiagnosticsV2;
}

interface OrderedCampaign {
  campaign: RawImpactCampaignV2;
  inputIndex: number;
}

function compareCampaignProvenance(left: OrderedCampaign, right: OrderedCampaign): number {
  const leftProvenance = left.campaign.provenance;
  const rightProvenance = right.campaign.provenance;
  return (
    leftProvenance.fetchSequence - rightProvenance.fetchSequence ||
    leftProvenance.recordIndex - rightProvenance.recordIndex ||
    left.inputIndex - right.inputIndex
  );
}

function assertPromotion(
  promotion: RawImpactPromotionV2,
): asserts promotion is RawImpactPromotionV2 & { promotionId: string } {
  if (!promotion.promotionId) {
    throw new Error("ImpactOfferNormalizer accepts only deduplicated promotions with PromotionIds");
  }
}

function assertCampaign(
  campaign: RawImpactCampaignV2,
): asserts campaign is RawImpactCampaignV2 & { campaignId: string } {
  if (!campaign.campaignId) {
    throw new Error("ImpactOfferNormalizer accepts only parsed campaigns with CampaignIds");
  }
}

function campaignIndex(campaigns: readonly RawImpactCampaignV2[]): Map<string, RawImpactCampaignV2> {
  const byCampaignId = new Map<string, RawImpactCampaignV2>();
  const ordered = campaigns
    .map((campaign, inputIndex): OrderedCampaign => ({ campaign, inputIndex }))
    .sort(compareCampaignProvenance);
  for (const { campaign } of ordered) {
    assertCampaign(campaign);
    if (!byCampaignId.has(campaign.campaignId)) byCampaignId.set(campaign.campaignId, campaign);
  }
  return byCampaignId;
}

function associationIndex(
  associations: readonly ImpactPromotionAssociationV2[],
  promotions: readonly RawImpactPromotionV2[],
): Map<string, StoreOfferAssociationV2> {
  const promotionIds = new Set<string>();
  for (const promotion of promotions) {
    assertPromotion(promotion);
    if (promotionIds.has(promotion.promotionId)) {
      throw new Error("ImpactOfferNormalizer requires unique deduplicated PromotionIds");
    }
    promotionIds.add(promotion.promotionId);
  }

  const byPromotionId = new Map<string, StoreOfferAssociationV2>();
  for (const entry of associations) {
    if (!entry.promotionId || !promotionIds.has(entry.promotionId)) {
      throw new Error("ImpactOfferNormalizer received an association outside the promotion input");
    }
    if (byPromotionId.has(entry.promotionId)) {
      throw new Error("ImpactOfferNormalizer requires exactly one A4 association per PromotionId");
    }
    byPromotionId.set(entry.promotionId, entry.association);
  }
  if (byPromotionId.size !== promotionIds.size) {
    throw new Error("ImpactOfferNormalizer requires one A4 association for every PromotionId");
  }
  return byPromotionId;
}

function copyAssociation(association: StoreOfferAssociationV2): StoreOfferAssociationV2 {
  if (association.matchMethod === "unmatched") {
    return {
      providerStoreKey: null,
      matchedStoreId: null,
      matchMethod: "unmatched",
      unresolvedReason: association.unresolvedReason,
    };
  }
  return {
    providerStoreKey: { ...association.providerStoreKey },
    matchedStoreId: association.matchedStoreId,
    matchMethod: association.matchMethod,
    unresolvedReason: null,
  };
}

function assertCampaignBackedAssociation(association: StoreOfferAssociationV2): asserts association is Exclude<
  StoreOfferAssociationV2,
  { matchMethod: "unmatched" }
> {
  if (
    association.matchMethod === "unmatched" ||
    association.providerStoreKey.provider !== "impact" ||
    association.providerStoreKey.namespace !== "campaign" ||
    !association.providerStoreKey.id
  ) {
    throw new Error("ImpactOfferNormalizer accepts only campaign-backed resolved associations");
  }
}

function hasRedemptionCode(promotion: RawImpactPromotionV2): promotion is RawImpactPromotionV2 & {
  genericRedemptionCode: string;
} {
  return typeof promotion.genericRedemptionCode === "string" && promotion.genericRedemptionCode.trim().length > 0;
}

function providerProvenance(promotion: RawImpactPromotionV2): ImpactRecordProvenanceV2 {
  return promotion.provenance;
}

/**
 * Converts provider fields already parsed by V2 into offer models. The one
 * classification rule is direct and exclusive: `GenericRedemptionCode` means
 * coupon; its absence means deal.
 */
export class ImpactOfferNormalizer {
  static normalize(
    deduplicatedPromotions: readonly RawImpactPromotionV2[],
    promotionAssociations: readonly ImpactPromotionAssociationV2[],
    validCampaigns: readonly RawImpactCampaignV2[],
  ): ImpactOfferNormalizationResultV2 {
    const associationsByPromotionId = associationIndex(promotionAssociations, deduplicatedPromotions);
    const campaignsById = campaignIndex(validCampaigns);
    const storesByCampaignId = new Map<string, NormalizedStoreV2>();
    const normalizedCoupons: NormalizedCouponV2[] = [];
    const normalizedDeals: NormalizedDealV2[] = [];
    let offersUnresolvedFromA4 = 0;
    let offersWithResolvedProviderStoreKey = 0;

    for (const promotion of deduplicatedPromotions) {
      assertPromotion(promotion);
      const association = copyAssociation(associationsByPromotionId.get(promotion.promotionId)!);
      if (association.matchMethod === "unmatched") {
        offersUnresolvedFromA4 += 1;
      } else {
        assertCampaignBackedAssociation(association);
        offersWithResolvedProviderStoreKey += 1;
        const campaignId = association.providerStoreKey.id;
        const campaign = campaignsById.get(campaignId);
        if (!campaign) {
          throw new Error("ImpactOfferNormalizer cannot create a store without its exact campaign record");
        }
        if (!storesByCampaignId.has(campaignId)) {
          storesByCampaignId.set(campaignId, {
            provider: "impact",
            providerStoreKey: { provider: "impact", namespace: "campaign", id: campaignId },
            campaignId,
            advertiserId: campaign.advertiserId,
            name: campaign.campaignName,
            destinationUrl: campaign.destinationUrl,
            trackingUrl: campaign.trackingUrl,
            raw: campaign,
          });
        }
      }

      const base = {
        provider: "impact" as const,
        promotionId: promotion.promotionId,
        advertiserId: promotion.advertiserId,
        advertiserName: promotion.advertiserName,
        campaignId: promotion.campaignId,
        programId: promotion.programId,
        title: promotion.promotionTitle,
        description: promotion.description,
        trackingUrl: promotion.trackingUrl,
        startDate: promotion.startDate,
        endDate: promotion.endDate,
        status: "unknown" as const,
        association,
        raw: promotion,
        provenance: providerProvenance(promotion),
      };
      if (hasRedemptionCode(promotion)) {
        normalizedCoupons.push({
          ...base,
          kind: "coupon",
          code: promotion.genericRedemptionCode,
          discountType: "unknown",
          discountValue: null,
          terms: null,
        });
      } else {
        normalizedDeals.push({ ...base, kind: "deal" });
      }
    }

    return {
      normalizedStores: [...storesByCampaignId.values()],
      normalizedCoupons,
      normalizedDeals,
      diagnostics: {
        deduplicatedPromotionsEvaluated: deduplicatedPromotions.length,
        couponsNormalized: normalizedCoupons.length,
        dealsNormalized: normalizedDeals.length,
        offersUnresolvedFromA4,
        offersWithResolvedProviderStoreKey,
        storesNormalized: storesByCampaignId.size,
      },
    };
  }
}
