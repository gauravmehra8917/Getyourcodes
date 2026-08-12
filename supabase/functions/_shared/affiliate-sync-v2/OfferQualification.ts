import type {
  MatchedNormalizedCouponV2,
  MatchedNormalizedDealV2,
  StoreOfferMatchResultV2,
} from "./StoreOfferMatcher.ts";

export type OfferIneligibilityReasonV2 =
  | "unresolved_store"
  | "not_started"
  | "expired"
  | "invalid_date"
  | "invalid_date_range"
  | "missing_title";

export interface OfferEligibilityConfigV2 {
  /** Required ISO-compatible reference time; business logic never reads the clock. */
  evaluationTimestamp: string;
}

export interface IneligibleOfferV2<TOffer> {
  offer: TOffer;
  reason: OfferIneligibilityReasonV2;
}

export interface OfferQualificationResultV2 {
  evaluationTimestamp: string;
  eligibleCoupons: MatchedNormalizedCouponV2[];
  eligibleDeals: MatchedNormalizedDealV2[];
  ineligibleCoupons: IneligibleOfferV2<MatchedNormalizedCouponV2>[];
  ineligibleDeals: IneligibleOfferV2<MatchedNormalizedDealV2>[];
  diagnostics: {
    offersEvaluated: number;
    eligibleOffers: number;
    ineligibleOffers: number;
    ineligibleReasonCounts: Record<OfferIneligibilityReasonV2, number>;
  };
}

type PolicyOfferV2 = MatchedNormalizedCouponV2 | MatchedNormalizedDealV2;

function parsedTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} must be a valid date-time string`);
  return timestamp;
}

function ineligibilityReason(
  offer: PolicyOfferV2,
  evaluationTime: number,
): OfferIneligibilityReasonV2 | null {
  if (offer.association.matchMethod === "unmatched") return "unresolved_store";
  if (offer.title === null || !offer.title.trim()) return "missing_title";

  const start = offer.startDate === null ? null : Date.parse(offer.startDate);
  const end = offer.endDate === null ? null : Date.parse(offer.endDate);
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) {
    return "invalid_date";
  }
  if (start !== null && end !== null && start > end) return "invalid_date_range";
  if (start !== null && evaluationTime < start) return "not_started";
  if (end !== null && evaluationTime > end) return "expired";
  return null;
}

function emptyReasonCounts(): Record<OfferIneligibilityReasonV2, number> {
  return {
    unresolved_store: 0,
    not_started: 0,
    expired: 0,
    invalid_date: 0,
    invalid_date_range: 0,
    missing_title: 0,
  };
}

/**
 * Applies only content eligibility to A5 offers. It neither groups stores nor
 * applies publishing caps, and it never rewrites association identity.
 */
export class OfferQualification {
  static evaluate(
    matched: StoreOfferMatchResultV2,
    config: OfferEligibilityConfigV2,
  ): OfferQualificationResultV2 {
    const evaluationTime = parsedTimestamp(config.evaluationTimestamp, "evaluationTimestamp");
    const eligibleCoupons: MatchedNormalizedCouponV2[] = [];
    const eligibleDeals: MatchedNormalizedDealV2[] = [];
    const ineligibleCoupons: IneligibleOfferV2<MatchedNormalizedCouponV2>[] = [];
    const ineligibleDeals: IneligibleOfferV2<MatchedNormalizedDealV2>[] = [];
    const reasonCounts = emptyReasonCounts();
    const seenPromotionIds = new Set<string>();

    const evaluate = <TOffer extends PolicyOfferV2>(
      offer: TOffer,
      eligible: TOffer[],
      ineligible: IneligibleOfferV2<TOffer>[],
    ): void => {
      if (!offer.promotionId || seenPromotionIds.has(offer.promotionId)) {
        throw new Error("OfferQualification requires unique non-empty PromotionIds");
      }
      seenPromotionIds.add(offer.promotionId);
      const reason = ineligibilityReason(offer, evaluationTime);
      if (reason === null) eligible.push(offer);
      else {
        reasonCounts[reason] += 1;
        ineligible.push({ offer, reason });
      }
    };

    for (const offer of matched.normalizedCoupons) evaluate(offer, eligibleCoupons, ineligibleCoupons);
    for (const offer of matched.normalizedDeals) evaluate(offer, eligibleDeals, ineligibleDeals);
    const offersEvaluated = seenPromotionIds.size;
    const eligibleOffers = eligibleCoupons.length + eligibleDeals.length;
    const ineligibleOffers = ineligibleCoupons.length + ineligibleDeals.length;

    return {
      evaluationTimestamp: config.evaluationTimestamp,
      eligibleCoupons,
      eligibleDeals,
      ineligibleCoupons,
      ineligibleDeals,
      diagnostics: {
        offersEvaluated,
        eligibleOffers,
        ineligibleOffers,
        ineligibleReasonCounts: reasonCounts,
      },
    };
  }
}
