import type {
  AdCodeClassV2,
  ProviderAdOfferKey,
  RawImpactAdV2,
} from "./ad-models.ts";
import type { RawAdDeduplicationDiagnosticsV2 } from "./ads-diagnostics.ts";

export interface RawAdDeduplicationResultV2 {
  uniqueAds: RawImpactAdV2[];
  /** Trusted internal identities for exact canary conflict disposition. */
  conflictedProviderOfferKeys: ProviderAdOfferKey[];
  diagnostics: RawAdDeduplicationDiagnosticsV2;
}

interface RetainedAdV2 {
  ad: RawImpactAdV2;
  occurrences: number;
  campaignIds: Set<string | null>;
  advertiserIds: Set<string | null>;
  suppliedDealIds: Set<string>;
  codeClasses: Set<AdCodeClassV2>;
  validatedCouponCodes: Set<string>;
}

function compareAds(left: RawImpactAdV2, right: RawImpactAdV2): number {
  return left.provenance.fetchSequence - right.provenance.fetchSequence ||
    left.provenance.recordIndex - right.provenance.recordIndex;
}

function retainedAd(ad: RawImpactAdV2): RetainedAdV2 {
  return {
    ad,
    occurrences: 1,
    campaignIds: new Set([ad.campaignId]),
    advertiserIds: new Set([ad.advertiserId]),
    suppliedDealIds: new Set(ad.dealId === null ? [] : [ad.dealId]),
    codeClasses: new Set([ad.codeClass]),
    validatedCouponCodes: new Set(
      ad.validatedCouponCode === null ? [] : [ad.validatedCouponCode],
    ),
  };
}

function addOccurrence(retained: RetainedAdV2, ad: RawImpactAdV2): void {
  retained.occurrences += 1;
  retained.campaignIds.add(ad.campaignId);
  retained.advertiserIds.add(ad.advertiserId);
  if (ad.dealId !== null) retained.suppliedDealIds.add(ad.dealId);
  retained.codeClasses.add(ad.codeClass);
  if (ad.validatedCouponCode !== null) {
    retained.validatedCouponCodes.add(ad.validatedCouponCode);
  }
}

function providerFieldsConflict(
  retained: RetainedAdV2,
): boolean {
  return retained.campaignIds.size > 1 ||
    retained.advertiserIds.size > 1 ||
    retained.suppliedDealIds.size > 1 ||
    retained.codeClasses.size > 1 ||
    retained.validatedCouponCodes.size > 1;
}

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Deduplicates only by exact immutable AdId; DealId is never identity. */
export class RawAdDeduplicator {
  static deduplicate(
    acceptedAds: readonly RawImpactAdV2[],
  ): RawAdDeduplicationResultV2 {
    const ordered = acceptedAds
      .map((ad, inputIndex) => ({ ad, inputIndex }))
      .sort((left, right) =>
        compareAds(left.ad, right.ad) || left.inputIndex - right.inputIndex
      );
    const retainedByAdId = new Map<string, RetainedAdV2>();
    let duplicateRecordsRemoved = 0;

    for (const { ad } of ordered) {
      const key = ad.providerOfferKey;
      if (
        key.provider !== "impact" || key.namespace !== "ad" || !key.id
      ) throw new Error("RawAdDeduplicator requires exact non-empty AdIds");
      const retained = retainedByAdId.get(key.id);
      if (!retained) {
        retainedByAdId.set(key.id, retainedAd(ad));
        continue;
      }
      duplicateRecordsRemoved += 1;
      addOccurrence(retained, ad);
    }

    const duplicated = [...retainedByAdId.values()].filter(
      (entry) => entry.occurrences > 1,
    );
    const conflictedAdIdentitiesExcluded = duplicated.filter(
      providerFieldsConflict,
    ).length;
    const uniqueAds = [...retainedByAdId.values()]
      .filter((entry) => !providerFieldsConflict(entry))
      .map((entry) =>
        entry.ad.dealId === null && entry.suppliedDealIds.size === 1
          ? { ...entry.ad, dealId: [...entry.suppliedDealIds][0]! }
          : entry.ad
      );
    const conflictedProviderOfferKeys = [...retainedByAdId.values()]
      .filter(providerFieldsConflict)
      .map((entry) => ({ ...entry.ad.providerOfferKey }))
      .sort((left, right) => compareCodeUnit(left.id, right.id));
    return {
      uniqueAds,
      conflictedProviderOfferKeys,
      diagnostics: {
        acceptedInputRecords: acceptedAds.length,
        uniqueUsableAds: uniqueAds.length,
        duplicateRecordsRemoved,
        duplicatedAdIdentities: duplicated.length,
        identitiesWithConflictingProviderFields: conflictedAdIdentitiesExcluded,
        conflictedAdIdentitiesExcluded,
      },
    };
  }
}
