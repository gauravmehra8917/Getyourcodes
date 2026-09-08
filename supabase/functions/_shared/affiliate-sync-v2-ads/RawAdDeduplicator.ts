import type { RawImpactAdV2 } from "./ad-models.ts";
import type { RawAdDeduplicationDiagnosticsV2 } from "./ads-diagnostics.ts";

export interface RawAdDeduplicationResultV2 {
  uniqueAds: RawImpactAdV2[];
  diagnostics: RawAdDeduplicationDiagnosticsV2;
}

interface RetainedAdV2 {
  ad: RawImpactAdV2;
  occurrences: number;
  conflicting: boolean;
}

function compareAds(left: RawImpactAdV2, right: RawImpactAdV2): number {
  return left.provenance.fetchSequence - right.provenance.fetchSequence ||
    left.provenance.recordIndex - right.provenance.recordIndex;
}

function providerFieldsConflict(
  retained: RawImpactAdV2,
  duplicate: RawImpactAdV2,
): boolean {
  return retained.campaignId !== duplicate.campaignId ||
    retained.advertiserId !== duplicate.advertiserId ||
    retained.dealId !== duplicate.dealId ||
    retained.codeClass !== duplicate.codeClass;
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
    const uniqueAds: RawImpactAdV2[] = [];
    let duplicateRecordsRemoved = 0;

    for (const { ad } of ordered) {
      const key = ad.providerOfferKey;
      if (
        key.provider !== "impact" || key.namespace !== "ad" || !key.id
      ) throw new Error("RawAdDeduplicator requires exact non-empty AdIds");
      const retained = retainedByAdId.get(key.id);
      if (!retained) {
        retainedByAdId.set(key.id, {
          ad,
          occurrences: 1,
          conflicting: false,
        });
        uniqueAds.push(ad);
        continue;
      }
      duplicateRecordsRemoved += 1;
      retained.occurrences += 1;
      retained.conflicting ||= providerFieldsConflict(retained.ad, ad);
    }

    const duplicated = [...retainedByAdId.values()].filter(
      (entry) => entry.occurrences > 1,
    );
    return {
      uniqueAds,
      diagnostics: {
        acceptedInputRecords: acceptedAds.length,
        uniqueAds: uniqueAds.length,
        duplicateRecordsRemoved,
        duplicatedAdIdentities: duplicated.length,
        identitiesWithConflictingProviderFields: duplicated.filter(
          (entry) => entry.conflicting,
        ).length,
      },
    };
  }
}
