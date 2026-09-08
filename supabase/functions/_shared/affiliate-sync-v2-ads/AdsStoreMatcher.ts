import {
  type ExistingAdsCatalogSnapshotV2,
  type ImpactAdStoreMatchResultV2,
  type MatchedImpactAdOfferV2,
  type MatchedImpactAdStoreV2,
  providerStoreKeyIdentityV2,
} from "./ad-models.ts";
import type { ImpactAdStoreMatchDiagnosticsV2 } from "./ads-diagnostics.ts";
import type {
  ImpactAdOfferNormalizationResultV2,
} from "./ImpactAdOfferNormalizer.ts";

export interface AdsStoreMatchResultV2 extends ImpactAdStoreMatchResultV2 {
  diagnostics: ImpactAdStoreMatchDiagnosticsV2;
}

/** Exact CampaignId store matching only; existing Ads offers are not evaluated. */
export class AdsStoreMatcher {
  static match(
    normalized: ImpactAdOfferNormalizationResultV2,
    snapshot: ExistingAdsCatalogSnapshotV2,
  ): AdsStoreMatchResultV2 {
    const idsByKey = new Map<string, Set<string>>();
    for (const store of snapshot.stores) {
      if (!store.id) throw new Error("Snapshot store IDs must be non-empty");
      const identity = providerStoreKeyIdentityV2(store.providerStoreKey);
      const ids = idsByKey.get(identity);
      if (ids) ids.add(store.id);
      else idsByKey.set(identity, new Set([store.id]));
    }
    const ambiguousKeys = new Set(
      [...idsByKey].filter(([, ids]) => ids.size > 1).map(([key]) => key),
    );
    const stores: MatchedImpactAdStoreV2[] = normalized.stores.map((store) => {
      const identity = providerStoreKeyIdentityV2(store.providerStoreKey);
      const ids = idsByKey.get(identity);
      const snapshotStatus = ambiguousKeys.has(identity)
        ? "ambiguous" as const
        : ids?.size === 1
        ? "existing" as const
        : "new_candidate" as const;
      return {
        ...store,
        providerStoreKey: { ...store.providerStoreKey },
        snapshotStatus,
        matchedStoreId: snapshotStatus === "existing" ? [...ids!][0]! : null,
      };
    });
    const storesByKey = new Map(
      stores.map((store) => [
        providerStoreKeyIdentityV2(store.providerStoreKey),
        store,
      ]),
    );
    const offers: MatchedImpactAdOfferV2[] = normalized.offers.map((offer) => {
      if (offer.association.matchMethod === "unmatched") {
        return { ...offer, snapshotStatus: "unresolved", matchedStoreId: null };
      }
      const store = storesByKey.get(
        providerStoreKeyIdentityV2(offer.association.providerStoreKey),
      );
      if (!store) throw new Error("Every resolved offer requires its store");
      return {
        ...offer,
        snapshotStatus: store.snapshotStatus,
        matchedStoreId: store.matchedStoreId,
      };
    });
    return {
      stores,
      offers,
      diagnostics: {
        storesEvaluated: stores.length,
        storesMatchedExisting:
          stores.filter((store) => store.snapshotStatus === "existing").length,
        newStoreCandidates:
          stores.filter((store) => store.snapshotStatus === "new_candidate")
            .length,
        ambiguousStoreSnapshotKeys: ambiguousKeys.size,
        offersMatchedToExistingStore:
          offers.filter((offer) => offer.snapshotStatus === "existing").length,
        offersForNewStoreCandidate:
          offers.filter((offer) => offer.snapshotStatus === "new_candidate")
            .length,
        offersHeldForAmbiguousStore:
          offers.filter((offer) => offer.snapshotStatus === "ambiguous").length,
        unresolvedOffers:
          offers.filter((offer) => offer.snapshotStatus === "unresolved")
            .length,
        existingOfferMatching: "not_evaluated",
      },
    };
  }
}
