import type {
  IneligibleOfferV2,
  OfferIneligibilityReasonV2,
  OfferQualificationResultV2,
} from "./OfferQualification.ts";
import type { ProviderStoreKey, StoreOfferAssociationV2 } from "./models.ts";
import type {
  MatchedNormalizedCouponV2,
  MatchedNormalizedDealV2,
} from "./StoreOfferMatcher.ts";

export type PublishingHoldReasonV2 =
  | OfferIneligibilityReasonV2
  | "over_coupon_limit"
  | "over_deal_limit";

export interface PublishingPolicyConfigV2 {
  /** Zero means uncapped. */
  maxCouponsPerStore: number;
  /** Zero means uncapped. */
  maxDealsPerStore: number;
}

/** Inherited from V1's explicit fallback policy; zero means publish all eligible offers. */
export const DEFAULT_PUBLISHING_POLICY_CONFIG_V2: Readonly<PublishingPolicyConfigV2> = Object.freeze({
  maxCouponsPerStore: 0,
  maxDealsPerStore: 0,
});

export interface HeldOfferV2<TOffer> {
  offer: TOffer;
  reason: PublishingHoldReasonV2;
}

export interface StorePublishingResultV2 {
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  eligibleCoupons: MatchedNormalizedCouponV2[];
  eligibleDeals: MatchedNormalizedDealV2[];
  selectedCoupons: MatchedNormalizedCouponV2[];
  selectedDeals: MatchedNormalizedDealV2[];
  heldCoupons: HeldOfferV2<MatchedNormalizedCouponV2>[];
  heldDeals: HeldOfferV2<MatchedNormalizedDealV2>[];
}

export interface PublishingPolicyResultV2 {
  stores: StorePublishingResultV2[];
  unresolvedHeldCoupons: HeldOfferV2<MatchedNormalizedCouponV2>[];
  unresolvedHeldDeals: HeldOfferV2<MatchedNormalizedDealV2>[];
  selectedCoupons: MatchedNormalizedCouponV2[];
  selectedDeals: MatchedNormalizedDealV2[];
  heldCoupons: HeldOfferV2<MatchedNormalizedCouponV2>[];
  heldDeals: HeldOfferV2<MatchedNormalizedDealV2>[];
  diagnostics: {
    offersEvaluated: number;
    eligibleOffers: number;
    ineligibleOffers: number;
    selectedOffers: number;
    heldOffers: number;
    couponsSelected: number;
    couponsHeld: number;
    dealsSelected: number;
    dealsHeld: number;
    storesCovered: number;
    holdReasonCounts: Record<PublishingHoldReasonV2, number>;
  };
}

export interface StoreQualificationConfigV2 {
  minimumSelectedCoupons: number;
  minimumSelectedDeals: number;
  minimumTotalSelectedOffers: number;
}

export type StoreQualificationReasonV2 =
  | "qualified"
  | "insufficient_coupons"
  | "insufficient_deals"
  | "insufficient_total_offers";

export interface StoreQualificationResultV2 {
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  selectedCouponCount: number;
  selectedDealCount: number;
  selectedTotal: number;
  qualified: boolean;
  reasons: StoreQualificationReasonV2[];
}

interface MutableStoreGroup {
  providerStoreKey: ProviderStoreKey;
  matchedStoreId: string | null;
  eligibleCoupons: MatchedNormalizedCouponV2[];
  eligibleDeals: MatchedNormalizedDealV2[];
  ineligibleCoupons: IneligibleOfferV2<MatchedNormalizedCouponV2>[];
  ineligibleDeals: IneligibleOfferV2<MatchedNormalizedDealV2>[];
}

type ResolvedAssociationV2 = Exclude<StoreOfferAssociationV2, { matchMethod: "unmatched" }>;
type RankedOfferV2 = MatchedNormalizedCouponV2 | MatchedNormalizedDealV2;

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function keyIdentity(key: ProviderStoreKey): string {
  if (key.provider !== "impact" || key.namespace !== "campaign" || !key.id) {
    throw new Error("PublishingPolicy accepts only Impact campaign provider-store keys");
  }
  return JSON.stringify([key.provider, key.namespace, key.id]);
}

function resolvedAssociation(offer: RankedOfferV2): ResolvedAssociationV2 {
  if (offer.association.matchMethod === "unmatched") {
    throw new Error("PublishingPolicy cannot group an unresolved offer");
  }
  keyIdentity(offer.association.providerStoreKey);
  return offer.association;
}

function compareOpaqueId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Earliest expiry, then newest start, then immutable PromotionId. */
function compareOffers(left: RankedOfferV2, right: RankedOfferV2): number {
  const leftEnd = left.endDate === null ? Number.POSITIVE_INFINITY : Date.parse(left.endDate);
  const rightEnd = right.endDate === null ? Number.POSITIVE_INFINITY : Date.parse(right.endDate);
  if (leftEnd !== rightEnd) return leftEnd - rightEnd;
  const leftStart = left.startDate === null ? Number.NEGATIVE_INFINITY : Date.parse(left.startDate);
  const rightStart = right.startDate === null ? Number.NEGATIVE_INFINITY : Date.parse(right.startDate);
  if (leftStart !== rightStart) return rightStart - leftStart;
  return compareOpaqueId(left.promotionId, right.promotionId);
}

function emptyHoldReasonCounts(): Record<PublishingHoldReasonV2, number> {
  return {
    unresolved_store: 0,
    not_started: 0,
    expired: 0,
    invalid_date: 0,
    invalid_date_range: 0,
    missing_title: 0,
    over_coupon_limit: 0,
    over_deal_limit: 0,
  };
}

function selection<TOffer extends RankedOfferV2>(
  offers: readonly TOffer[],
  maximum: number,
  reason: "over_coupon_limit" | "over_deal_limit",
): { selected: TOffer[]; held: HeldOfferV2<TOffer>[] } {
  const ordered = [...offers].sort(compareOffers);
  const selectedCount = maximum === 0 ? ordered.length : Math.min(maximum, ordered.length);
  return {
    selected: ordered.slice(0, selectedCount),
    held: ordered.slice(selectedCount).map((offer) => ({ offer, reason })),
  };
}

function groupFor(
  groups: Map<string, MutableStoreGroup>,
  offer: RankedOfferV2,
): MutableStoreGroup {
  const association = resolvedAssociation(offer);
  const identity = keyIdentity(association.providerStoreKey);
  const existing = groups.get(identity);
  if (existing) {
    if (existing.matchedStoreId !== association.matchedStoreId) {
      throw new Error("PublishingPolicy received conflicting matchedStoreIds for one ProviderStoreKey");
    }
    return existing;
  }
  const group: MutableStoreGroup = {
    providerStoreKey: { ...association.providerStoreKey },
    matchedStoreId: association.matchedStoreId,
    eligibleCoupons: [],
    eligibleDeals: [],
    ineligibleCoupons: [],
    ineligibleDeals: [],
  };
  groups.set(identity, group);
  return group;
}

/** Applies deterministic per-campaign caps to the separate eligibility result. */
export class PublishingPolicy {
  static apply(
    qualification: OfferQualificationResultV2,
    config: PublishingPolicyConfigV2 = DEFAULT_PUBLISHING_POLICY_CONFIG_V2,
  ): PublishingPolicyResultV2 {
    const maxCoupons = nonNegativeInteger(config.maxCouponsPerStore, "maxCouponsPerStore");
    const maxDeals = nonNegativeInteger(config.maxDealsPerStore, "maxDealsPerStore");
    const groups = new Map<string, MutableStoreGroup>();
    const unresolvedHeldCoupons: HeldOfferV2<MatchedNormalizedCouponV2>[] = [];
    const unresolvedHeldDeals: HeldOfferV2<MatchedNormalizedDealV2>[] = [];

    for (const offer of qualification.eligibleCoupons) groupFor(groups, offer).eligibleCoupons.push(offer);
    for (const offer of qualification.eligibleDeals) groupFor(groups, offer).eligibleDeals.push(offer);
    for (const entry of qualification.ineligibleCoupons) {
      if (entry.offer.association.matchMethod === "unmatched") unresolvedHeldCoupons.push(entry);
      else groupFor(groups, entry.offer).ineligibleCoupons.push(entry);
    }
    for (const entry of qualification.ineligibleDeals) {
      if (entry.offer.association.matchMethod === "unmatched") unresolvedHeldDeals.push(entry);
      else groupFor(groups, entry.offer).ineligibleDeals.push(entry);
    }

    const stores: StorePublishingResultV2[] = [];
    for (const group of [...groups.values()].sort((left, right) =>
      compareOpaqueId(left.providerStoreKey.id, right.providerStoreKey.id))) {
      const coupons = selection(group.eligibleCoupons, maxCoupons, "over_coupon_limit");
      const deals = selection(group.eligibleDeals, maxDeals, "over_deal_limit");
      stores.push({
        providerStoreKey: { ...group.providerStoreKey },
        matchedStoreId: group.matchedStoreId,
        eligibleCoupons: [...coupons.selected, ...coupons.held.map((entry) => entry.offer)],
        eligibleDeals: [...deals.selected, ...deals.held.map((entry) => entry.offer)],
        selectedCoupons: coupons.selected,
        selectedDeals: deals.selected,
        heldCoupons: [...group.ineligibleCoupons, ...coupons.held],
        heldDeals: [...group.ineligibleDeals, ...deals.held],
      });
    }

    const selectedCoupons = stores.flatMap((store) => store.selectedCoupons);
    const selectedDeals = stores.flatMap((store) => store.selectedDeals);
    const heldCoupons = [...unresolvedHeldCoupons, ...stores.flatMap((store) => store.heldCoupons)];
    const heldDeals = [...unresolvedHeldDeals, ...stores.flatMap((store) => store.heldDeals)];
    const holdReasonCounts = emptyHoldReasonCounts();
    for (const entry of [...heldCoupons, ...heldDeals]) holdReasonCounts[entry.reason] += 1;

    return {
      stores,
      unresolvedHeldCoupons,
      unresolvedHeldDeals,
      selectedCoupons,
      selectedDeals,
      heldCoupons,
      heldDeals,
      diagnostics: {
        offersEvaluated: qualification.diagnostics.offersEvaluated,
        eligibleOffers: qualification.diagnostics.eligibleOffers,
        ineligibleOffers: qualification.diagnostics.ineligibleOffers,
        selectedOffers: selectedCoupons.length + selectedDeals.length,
        heldOffers: heldCoupons.length + heldDeals.length,
        couponsSelected: selectedCoupons.length,
        couponsHeld: heldCoupons.length,
        dealsSelected: selectedDeals.length,
        dealsHeld: heldDeals.length,
        storesCovered: stores.length,
        holdReasonCounts,
      },
    };
  }
}

/** Evaluates selected coverage only; matchedStoreId never affects qualification. */
export class StoreQualification {
  static evaluate(
    policy: PublishingPolicyResultV2,
    config: StoreQualificationConfigV2,
  ): StoreQualificationResultV2[] {
    const minimumCoupons = nonNegativeInteger(config.minimumSelectedCoupons, "minimumSelectedCoupons");
    const minimumDeals = nonNegativeInteger(config.minimumSelectedDeals, "minimumSelectedDeals");
    const minimumTotal = nonNegativeInteger(config.minimumTotalSelectedOffers, "minimumTotalSelectedOffers");

    return policy.stores.map((store) => {
      const selectedCouponCount = store.selectedCoupons.length;
      const selectedDealCount = store.selectedDeals.length;
      const selectedTotal = selectedCouponCount + selectedDealCount;
      const reasons: StoreQualificationReasonV2[] = [];
      if (selectedCouponCount < minimumCoupons) reasons.push("insufficient_coupons");
      if (selectedDealCount < minimumDeals) reasons.push("insufficient_deals");
      if (selectedTotal < minimumTotal) reasons.push("insufficient_total_offers");
      if (reasons.length === 0) reasons.push("qualified");
      return {
        providerStoreKey: { ...store.providerStoreKey },
        matchedStoreId: store.matchedStoreId,
        selectedCouponCount,
        selectedDealCount,
        selectedTotal,
        qualified: reasons[0] === "qualified",
        reasons,
      };
    });
  }
}
