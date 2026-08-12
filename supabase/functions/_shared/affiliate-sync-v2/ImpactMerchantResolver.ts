import type {
  CampaignAdvertiserConflictDiagnosticV2,
  CampaignIndexDiagnosticsV2,
  DuplicateCampaignConflictFieldV2,
  DuplicateCampaignIdentityDiagnosticV2,
  ImpactRecordProvenanceV2,
  MerchantIdentityDiagnosticsV2,
} from "./diagnostics.ts";
import type {
  MerchantUnresolvedReasonV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
  StoreOfferAssociationV2,
} from "./models.ts";

export interface ImpactMerchantResolverOptionsV2 {
  /**
   * Maximum campaign-duplicate and campaign-advertiser-conflict rows returned
   * for display. Every identity is still indexed and included in the counts.
   */
  diagnosticDetailLimit?: number;
}

/** One association per supplied, deduplicated promotion, in input order. */
export interface ImpactPromotionAssociationV2 {
  promotionId: string;
  association: StoreOfferAssociationV2;
}

export interface ImpactMerchantResolutionResultV2 {
  promotionAssociations: ImpactPromotionAssociationV2[];
  campaignIndexDiagnostics: CampaignIndexDiagnosticsV2;
  merchantIdentityDiagnostics: MerchantIdentityDiagnosticsV2;
}

interface OrderedCampaign {
  campaign: RawImpactCampaignV2;
  inputIndex: number;
}

interface RetainedCampaign {
  campaign: RawImpactCampaignV2;
  occurrences: ImpactRecordProvenanceV2[];
  conflicts: Set<DuplicateCampaignConflictFieldV2>;
}

interface CampaignIndexV2 {
  campaignsById: Map<string, RawImpactCampaignV2>;
  campaignsByAdvertiserId: Map<string, RawImpactCampaignV2[]>;
  diagnostics: CampaignIndexDiagnosticsV2;
}

const DEFAULT_DIAGNOSTIC_DETAIL_LIMIT = 100;
const CAMPAIGN_CONFLICT_FIELDS: DuplicateCampaignConflictFieldV2[] = [
  "advertiserId",
  "campaignName",
  "destinationUrl",
  "trackingUrl",
];

function compareCampaignProvenance(left: OrderedCampaign, right: OrderedCampaign): number {
  const leftProvenance = left.campaign.provenance;
  const rightProvenance = right.campaign.provenance;
  return (
    leftProvenance.fetchSequence - rightProvenance.fetchSequence ||
    leftProvenance.recordIndex - rightProvenance.recordIndex ||
    left.inputIndex - right.inputIndex
  );
}

function copyProvenance(provenance: ImpactRecordProvenanceV2): ImpactRecordProvenanceV2 {
  return { ...provenance };
}

function diagnosticDetailLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DIAGNOSTIC_DETAIL_LIMIT;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("diagnosticDetailLimit must be a non-negative integer");
  }
  return value;
}

function assertAcceptedCampaign(
  campaign: RawImpactCampaignV2,
): asserts campaign is RawImpactCampaignV2 & { campaignId: string } {
  if (!campaign.campaignId) {
    throw new Error("ImpactMerchantResolver accepts only parsed campaigns with CampaignIds");
  }
}

function assertDeduplicatedPromotion(
  promotion: RawImpactPromotionV2,
): asserts promotion is RawImpactPromotionV2 & { promotionId: string } {
  if (!promotion.promotionId) {
    throw new Error("ImpactMerchantResolver accepts only deduplicated promotions with PromotionIds");
  }
}

function campaignConflicts(
  retained: RawImpactCampaignV2,
  duplicate: RawImpactCampaignV2,
): DuplicateCampaignConflictFieldV2[] {
  return CAMPAIGN_CONFLICT_FIELDS.filter((field) => retained[field] !== duplicate[field]);
}

function duplicateCampaignDiagnostic(
  campaignId: string,
  retained: RetainedCampaign,
): DuplicateCampaignIdentityDiagnosticV2 {
  return {
    campaignId,
    retainedOccurrence: copyProvenance(retained.occurrences[0]!),
    occurrences: retained.occurrences.map(copyProvenance),
    totalOccurrences: retained.occurrences.length,
    duplicateOccurrenceCount: retained.occurrences.length - 1,
    conflictingIdentityFields: [...retained.conflicts],
  };
}

/**
 * Builds the only two V2-A4 lookup indexes. A copied, provenance-sorted view
 * establishes duplicate campaign retention before either index is populated.
 */
function indexCampaigns(
  campaigns: readonly RawImpactCampaignV2[],
  detailLimit: number,
): CampaignIndexV2 {
  const ordered = campaigns
    .map((campaign, inputIndex): OrderedCampaign => ({ campaign, inputIndex }))
    .sort(compareCampaignProvenance);
  const retainedByCampaignId = new Map<string, RetainedCampaign>();
  const duplicateCampaignIds: string[] = [];
  const uniqueCampaigns: RawImpactCampaignV2[] = [];
  let duplicateCampaignRecords = 0;

  for (const { campaign } of ordered) {
    assertAcceptedCampaign(campaign);
    const retained = retainedByCampaignId.get(campaign.campaignId);
    if (!retained) {
      retainedByCampaignId.set(campaign.campaignId, {
        campaign,
        occurrences: [copyProvenance(campaign.provenance)],
        conflicts: new Set(),
      });
      uniqueCampaigns.push(campaign);
      continue;
    }

    duplicateCampaignRecords += 1;
    if (retained.occurrences.length === 1) duplicateCampaignIds.push(campaign.campaignId);
    retained.occurrences.push(copyProvenance(campaign.provenance));
    for (const field of campaignConflicts(retained.campaign, campaign)) retained.conflicts.add(field);
  }

  const allDuplicateDiagnostics = duplicateCampaignIds.map((campaignId) =>
    duplicateCampaignDiagnostic(campaignId, retainedByCampaignId.get(campaignId)!),
  );
  const campaignsById = new Map<string, RawImpactCampaignV2>();
  const campaignsByAdvertiserId = new Map<string, RawImpactCampaignV2[]>();
  for (const campaign of uniqueCampaigns) {
    assertAcceptedCampaign(campaign);
    campaignsById.set(campaign.campaignId, campaign);
    if (!campaign.advertiserId) continue;
    const matches = campaignsByAdvertiserId.get(campaign.advertiserId);
    if (matches) matches.push(campaign);
    else campaignsByAdvertiserId.set(campaign.advertiserId, [campaign]);
  }

  let advertisersMappingToExactlyOneCampaign = 0;
  let advertisersMappingToMultipleCampaigns = 0;
  for (const matches of campaignsByAdvertiserId.values()) {
    if (matches.length === 1) advertisersMappingToExactlyOneCampaign += 1;
    else advertisersMappingToMultipleCampaigns += 1;
  }
  const duplicateCampaignDetails = allDuplicateDiagnostics.slice(0, detailLimit);

  return {
    campaignsById,
    campaignsByAdvertiserId,
    diagnostics: {
      acceptedCampaignRecords: campaigns.length,
      indexedCampaigns: uniqueCampaigns.length,
      duplicateCampaignRecords,
      duplicatedCampaignIdentities: allDuplicateDiagnostics.length,
      campaignIdentitiesWithConflictingFields: allDuplicateDiagnostics.filter(
        (diagnostic) => diagnostic.conflictingIdentityFields.length > 0,
      ).length,
      duplicateCampaignDetails,
      duplicateCampaignDetailsReturned: duplicateCampaignDetails.length,
      duplicateCampaignDetailsTruncated: duplicateCampaignDetails.length < allDuplicateDiagnostics.length,
      advertisersMappingToExactlyOneCampaign,
      advertisersMappingToMultipleCampaigns,
      campaignsMissingAdvertiserId: uniqueCampaigns.filter((campaign) => !campaign.advertiserId).length,
    },
  };
}

function unresolvedAssociation(reason: MerchantUnresolvedReasonV2): StoreOfferAssociationV2 {
  return {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: reason,
  };
}

function resolvedAssociation(
  campaign: RawImpactCampaignV2,
  matchMethod: "campaign_id" | "advertiser_id",
): StoreOfferAssociationV2 {
  assertAcceptedCampaign(campaign);
  return {
    providerStoreKey: { provider: "impact", namespace: "campaign", id: campaign.campaignId },
    matchedStoreId: null,
    matchMethod,
    unresolvedReason: null,
  };
}

function emptyUnresolvedReasonCounts(): Record<MerchantUnresolvedReasonV2, number> {
  return {
    unknown_campaign_id: 0,
    campaign_advertiser_conflict: 0,
    unknown_advertiser_id: 0,
    ambiguous_advertiser_id: 0,
    missing_merchant_identity: 0,
  };
}

/**
 * Resolves only exact Impact campaign and advertiser identities. Promotion
 * order is intentionally the caller's A3 deduplicated output order; this
 * method never reorders it and never alters provider identity fields.
 */
export class ImpactMerchantResolver {
  static resolve(
    deduplicatedPromotions: readonly RawImpactPromotionV2[],
    validCampaigns: readonly RawImpactCampaignV2[],
    options: ImpactMerchantResolverOptionsV2 = {},
  ): ImpactMerchantResolutionResultV2 {
    const detailLimit = diagnosticDetailLimit(options.diagnosticDetailLimit);
    const index = indexCampaigns(validCampaigns, detailLimit);
    const matchMethodCounts = {
      campaign_id: 0,
      advertiser_id: 0,
      explicit_provider_relation: 0,
      unmatched: 0,
    };
    const unresolvedReasonCounts = emptyUnresolvedReasonCounts();
    const campaignIdsReferenced = new Set<string>();
    const advertiserIdsReferenced = new Set<string>();
    const resolvedCampaignIds = new Set<string>();
    const allCampaignAdvertiserConflicts: CampaignAdvertiserConflictDiagnosticV2[] = [];
    const promotionAssociations: ImpactPromotionAssociationV2[] = [];
    let advertiserCrossCheckUnavailableCount = 0;

    for (const promotion of deduplicatedPromotions) {
      assertDeduplicatedPromotion(promotion);
      if (promotion.campaignId) campaignIdsReferenced.add(promotion.campaignId);
      if (promotion.advertiserId) advertiserIdsReferenced.add(promotion.advertiserId);

      let association: StoreOfferAssociationV2;
      if (promotion.campaignId) {
        const campaign = index.campaignsById.get(promotion.campaignId);
        if (!campaign) {
          association = unresolvedAssociation("unknown_campaign_id");
        } else if (promotion.advertiserId && campaign.advertiserId && promotion.advertiserId !== campaign.advertiserId) {
          association = unresolvedAssociation("campaign_advertiser_conflict");
          allCampaignAdvertiserConflicts.push({
            promotionId: promotion.promotionId,
            promotionAdvertiserId: promotion.advertiserId,
            campaignId: campaign.campaignId!,
            campaignAdvertiserId: campaign.advertiserId,
            promotionProvenance: copyProvenance(promotion.provenance),
            campaignProvenance: copyProvenance(campaign.provenance),
          });
        } else {
          if (!promotion.advertiserId || !campaign.advertiserId) {
            advertiserCrossCheckUnavailableCount += 1;
          }
          association = resolvedAssociation(campaign, "campaign_id");
        }
      } else if (promotion.advertiserId) {
        const campaigns = index.campaignsByAdvertiserId.get(promotion.advertiserId) ?? [];
        if (campaigns.length === 0) {
          association = unresolvedAssociation("unknown_advertiser_id");
        } else if (campaigns.length === 1) {
          association = resolvedAssociation(campaigns[0]!, "advertiser_id");
        } else {
          association = unresolvedAssociation("ambiguous_advertiser_id");
        }
      } else {
        association = unresolvedAssociation("missing_merchant_identity");
      }

      matchMethodCounts[association.matchMethod] += 1;
      if (association.matchMethod === "unmatched") {
        unresolvedReasonCounts[association.unresolvedReason] += 1;
      } else {
        resolvedCampaignIds.add(association.providerStoreKey.id);
      }
      promotionAssociations.push({ promotionId: promotion.promotionId, association });
    }

    const campaignAdvertiserConflicts = allCampaignAdvertiserConflicts.slice(0, detailLimit);
    const unresolvedTotal = matchMethodCounts.unmatched;
    return {
      promotionAssociations,
      campaignIndexDiagnostics: index.diagnostics,
      merchantIdentityDiagnostics: {
        advertiserCount: advertiserIdsReferenced.size,
        campaignCount: index.diagnostics.indexedCampaigns,
        unresolvedAssociationCount: unresolvedTotal,
        matchMethodCounts,
        unresolvedReasonCounts,
        promotionsEvaluated: deduplicatedPromotions.length,
        resolvedByCampaignId: matchMethodCounts.campaign_id,
        resolvedByAdvertiserId: matchMethodCounts.advertiser_id,
        unmatchedTotal: unresolvedTotal,
        distinctCampaignIdsReferencedByPromotions: campaignIdsReferenced.size,
        distinctAdvertiserIdsReferencedByPromotions: advertiserIdsReferenced.size,
        distinctResolvedProviderStoreKeys: resolvedCampaignIds.size,
        advertiserCrossCheckUnavailableCount,
        campaignAdvertiserConflicts,
        campaignAdvertiserConflictDetailsReturned: campaignAdvertiserConflicts.length,
        campaignAdvertiserConflictDetailsTruncated:
          campaignAdvertiserConflicts.length < allCampaignAdvertiserConflicts.length,
        campaignIndex: index.diagnostics,
      },
    };
  }
}
