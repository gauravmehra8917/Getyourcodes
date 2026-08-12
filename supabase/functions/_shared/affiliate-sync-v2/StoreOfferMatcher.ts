import type { StoreOfferMatchDiagnosticsV2 } from "./diagnostics.ts";
import type { ImpactOfferNormalizationResultV2 } from "./ImpactOfferNormalizer.ts";
import type {
  ExistingCatalogSnapshotV2,
  NormalizedCouponV2,
  NormalizedDealV2,
  ProviderStoreKey,
  StoreOfferAssociationV2,
} from "./models.ts";

export type ExistingPromotionIdentityStatusV2 = "new" | "existing";

export interface MatchedNormalizedCouponV2 extends NormalizedCouponV2 {
  existingPromotionIdentity: ExistingPromotionIdentityStatusV2;
  existingOfferId: string | null;
}

export interface MatchedNormalizedDealV2 extends NormalizedDealV2 {
  existingPromotionIdentity: ExistingPromotionIdentityStatusV2;
  existingOfferId: string | null;
}

export interface StoreOfferMatchResultV2 {
  normalizedStores: ImpactOfferNormalizationResultV2["normalizedStores"];
  normalizedCoupons: MatchedNormalizedCouponV2[];
  normalizedDeals: MatchedNormalizedDealV2[];
  diagnostics: StoreOfferMatchDiagnosticsV2;
}

interface SnapshotIndexV2 {
  storeIdsByKey: Map<string, Set<string>>;
  existingOfferIdsByPromotionId: Map<string, Set<string>>;
  ambiguousStoreKeyIdentities: Set<string>;
}

function assertSnapshotStoreKey(key: ProviderStoreKey): void {
  if (key.provider !== "impact" || key.namespace !== "campaign" || !key.id) {
    throw new Error("StoreOfferMatcher accepts only exact Impact campaign provider-store keys");
  }
}

function keyIdentity(key: ProviderStoreKey): string {
  assertSnapshotStoreKey(key);
  return JSON.stringify([key.provider, key.namespace, key.id]);
}

function snapshotIndex(snapshot: ExistingCatalogSnapshotV2): SnapshotIndexV2 {
  const storeIdsByKey = new Map<string, Set<string>>();
  for (const store of snapshot.stores) {
    if (!store.id) throw new Error("StoreOfferMatcher snapshot store IDs must be nonempty");
    const identity = keyIdentity(store.providerStoreKey);
    const ids = storeIdsByKey.get(identity);
    if (ids) ids.add(store.id);
    else storeIdsByKey.set(identity, new Set([store.id]));
  }

  const existingOfferIdsByPromotionId = new Map<string, Set<string>>();
  for (const offer of snapshot.offers) {
    if (!offer.id || !offer.promotionId) {
      throw new Error("StoreOfferMatcher snapshot offer IDs and PromotionIds must be nonempty");
    }
    const ids = existingOfferIdsByPromotionId.get(offer.promotionId);
    if (ids) ids.add(offer.id);
    else existingOfferIdsByPromotionId.set(offer.promotionId, new Set([offer.id]));
  }

  return {
    storeIdsByKey,
    existingOfferIdsByPromotionId,
    ambiguousStoreKeyIdentities: new Set(
      [...storeIdsByKey].filter(([, ids]) => ids.size > 1).map(([identity]) => identity),
    ),
  };
}

function unmatchedAssociation(association: StoreOfferAssociationV2): StoreOfferAssociationV2 {
  if (association.matchMethod !== "unmatched") {
    throw new Error("StoreOfferMatcher cannot remove a resolved A4 association");
  }
  return {
    providerStoreKey: null,
    matchedStoreId: null,
    matchMethod: "unmatched",
    unresolvedReason: association.unresolvedReason,
  };
}

function resolvedAssociation(
  association: StoreOfferAssociationV2,
  snapshot: SnapshotIndexV2,
  noExistingStoreKeys: Set<string>,
): { association: StoreOfferAssociationV2; matched: boolean } {
  if (association.matchMethod === "unmatched") {
    throw new Error("StoreOfferMatcher requires a resolved association for snapshot matching");
  }
  const key = association.providerStoreKey;
  const identity = keyIdentity(key);
  const storeIds = snapshot.storeIdsByKey.get(identity);
  const ambiguous = snapshot.ambiguousStoreKeyIdentities.has(identity);
  const matchedStoreId = !ambiguous && storeIds?.size === 1 ? [...storeIds][0]! : null;
  if (!storeIds) noExistingStoreKeys.add(identity);
  return {
    association: {
      providerStoreKey: { ...key },
      matchedStoreId,
      matchMethod: association.matchMethod,
      unresolvedReason: null,
    },
    matched: matchedStoreId !== null,
  };
}

function promotionIdentity(
  promotionId: string,
  snapshot: SnapshotIndexV2,
): { status: ExistingPromotionIdentityStatusV2; existingOfferId: string | null } {
  const ids = snapshot.existingOfferIdsByPromotionId.get(promotionId);
  if (!ids || ids.size === 0) return { status: "new", existingOfferId: null };
  return { status: "existing", existingOfferId: ids.size === 1 ? [...ids][0]! : null };
}

/**
 * Applies only exact snapshot identities. It never inspects presentation
 * fields and it cannot turn an unmatched A4 association into a matched store.
 */
export class StoreOfferMatcher {
  static match(
    normalized: ImpactOfferNormalizationResultV2,
    snapshot: ExistingCatalogSnapshotV2,
  ): StoreOfferMatchResultV2 {
    const index = snapshotIndex(snapshot);
    const noExistingStoreKeys = new Set<string>();
    let offersUnresolvedFromA4 = 0;
    let offersWithResolvedProviderStoreKey = 0;
    let offersMatchedToExistingStore = 0;
    let newPromotionIdentities = 0;
    let existingPromotionIdentities = 0;

    const matchCoupon = (offer: NormalizedCouponV2): MatchedNormalizedCouponV2 => {
      const promotion = promotionIdentity(offer.promotionId, index);
      if (promotion.status === "existing") existingPromotionIdentities += 1;
      else newPromotionIdentities += 1;
      if (offer.association.matchMethod === "unmatched") {
        offersUnresolvedFromA4 += 1;
        return { ...offer, association: unmatchedAssociation(offer.association), existingPromotionIdentity: promotion.status, existingOfferId: promotion.existingOfferId };
      }
      offersWithResolvedProviderStoreKey += 1;
      const matched = resolvedAssociation(offer.association, index, noExistingStoreKeys);
      if (matched.matched) offersMatchedToExistingStore += 1;
      return { ...offer, association: matched.association, existingPromotionIdentity: promotion.status, existingOfferId: promotion.existingOfferId };
    };

    const matchDeal = (offer: NormalizedDealV2): MatchedNormalizedDealV2 => {
      const promotion = promotionIdentity(offer.promotionId, index);
      if (promotion.status === "existing") existingPromotionIdentities += 1;
      else newPromotionIdentities += 1;
      if (offer.association.matchMethod === "unmatched") {
        offersUnresolvedFromA4 += 1;
        return { ...offer, association: unmatchedAssociation(offer.association), existingPromotionIdentity: promotion.status, existingOfferId: promotion.existingOfferId };
      }
      offersWithResolvedProviderStoreKey += 1;
      const matched = resolvedAssociation(offer.association, index, noExistingStoreKeys);
      if (matched.matched) offersMatchedToExistingStore += 1;
      return { ...offer, association: matched.association, existingPromotionIdentity: promotion.status, existingOfferId: promotion.existingOfferId };
    };

    const normalizedCoupons = normalized.normalizedCoupons.map(matchCoupon);
    const normalizedDeals = normalized.normalizedDeals.map(matchDeal);
    return {
      normalizedStores: [...normalized.normalizedStores],
      normalizedCoupons,
      normalizedDeals,
      diagnostics: {
        offersEvaluated: normalizedCoupons.length + normalizedDeals.length,
        offersUnresolvedFromA4,
        offersWithResolvedProviderStoreKey,
        offersMatchedToExistingStore,
        resolvedProviderStoreKeysWithNoExistingStore: noExistingStoreKeys.size,
        ambiguousSnapshotStoreKeys: index.ambiguousStoreKeyIdentities.size,
        newPromotionIdentities,
        existingPromotionIdentities,
      },
    };
  }
}
