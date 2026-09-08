import type {
  AdsPublishingSelectionResultV2,
  MatchedImpactAdOfferV2,
  MatchedImpactAdStoreV2,
  QualifiedImpactAdOfferV2,
  SelectedImpactAdStoreV2,
} from "./ad-models.ts";
import { providerStoreKeyIdentityV2 } from "./ad-models.ts";
import type { AdsSelectionDiagnosticsV2 } from "./ads-diagnostics.ts";
import type { AdsOfferQualificationOutputV2 } from "./AdsOfferQualification.ts";
import type { AdsStoreMatchResultV2 } from "./AdsStoreMatcher.ts";

export interface AdsPublishingSelectionOutputV2
  extends AdsPublishingSelectionResultV2 {
  diagnostics: AdsSelectionDiagnosticsV2;
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dateRank(value: string | null, missing: number): number {
  if (value === null) return missing;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : missing;
}

/** Earliest end, newest start, then exact AdId. */
function compareOffers(
  left: MatchedImpactAdOfferV2,
  right: MatchedImpactAdOfferV2,
): number {
  const leftEnd = dateRank(left.endDate, Number.POSITIVE_INFINITY);
  const rightEnd = dateRank(right.endDate, Number.POSITIVE_INFINITY);
  if (leftEnd !== rightEnd) return leftEnd < rightEnd ? -1 : 1;
  const leftStart = dateRank(left.startDate, Number.NEGATIVE_INFINITY);
  const rightStart = dateRank(right.startDate, Number.NEGATIVE_INFINITY);
  if (leftStart !== rightStart) return leftStart > rightStart ? -1 : 1;
  return compareOpaque(
    left.providerOfferKey.id,
    right.providerOfferKey.id,
  );
}

/** A11-S3 selection is explicitly source-neutral and uncapped. */
export class AdsPublishingSelection {
  static apply(
    matched: AdsStoreMatchResultV2,
    qualification: AdsOfferQualificationOutputV2,
    input: { sourceNeutralMaxSelectedAdsPerStore: number },
  ): AdsPublishingSelectionOutputV2 {
    if (input.sourceNeutralMaxSelectedAdsPerStore !== 0) {
      throw new Error(
        "A11-S3 sourceNeutralMaxSelectedAdsPerStore must be zero (uncapped)",
      );
    }
    const groups = new Map<string, SelectedImpactAdStoreV2>();
    for (const store of matched.stores) {
      const identity = providerStoreKeyIdentityV2(store.providerStoreKey);
      if (groups.has(identity)) {
        throw new Error("Selection received duplicate normalized stores");
      }
      groups.set(identity, { store, selected: [], held: [] });
    }
    const unresolvedHeld: QualifiedImpactAdOfferV2[] = [];
    const finalIds = new Set<string>();
    for (const entry of qualification.offers) {
      const adId = entry.offer.providerOfferKey.id;
      if (finalIds.has(adId)) {
        throw new Error("Selection requires one disposition per AdId");
      }
      finalIds.add(adId);
      if (entry.offer.association.matchMethod === "unmatched") {
        if (entry.eligible || entry.reason !== "unresolved_store") {
          throw new Error("An unresolved Ad cannot be selected");
        }
        unresolvedHeld.push(entry);
        continue;
      }
      const group = groups.get(
        providerStoreKeyIdentityV2(entry.offer.association.providerStoreKey),
      );
      if (!group) throw new Error("Resolved Ad is missing its store group");
      if (entry.eligible) group.selected.push(entry.offer);
      else group.held.push(entry);
    }
    for (const group of groups.values()) {
      group.selected.sort(compareOffers);
    }
    const stores = [...groups.values()];
    const selected = stores.flatMap((store) => store.selected);
    const held = stores.reduce(
      (total, store) => total + store.held.length,
      unresolvedHeld.length,
    );
    return {
      sourceNeutralMaxSelectedAdsPerStore: 0,
      stores,
      unresolvedHeld,
      diagnostics: {
        sourceNeutralMaxSelectedAdsPerStore: 0,
        selectedAdsTotal: selected.length,
        heldAdsTotal: held,
        codeBearingSelected:
          selected.filter((offer) => offer.codeClass === "code_bearing").length,
        noCodeSelected:
          selected.filter((offer) => offer.codeClass === "no_code").length,
        storesWithSelectedAds:
          stores.filter((store) => store.selected.length > 0).length,
        storesWithoutSelectedAds:
          stores.filter((store) => store.selected.length === 0).length,
      },
    };
  }
}
