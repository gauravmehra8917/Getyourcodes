import type {
  DuplicatePromotionConflictFieldV2,
  DuplicatePromotionProvenanceV2,
  ImpactRecordProvenanceV2,
} from "./diagnostics.ts";
import type { RawImpactPromotionV2 } from "./models.ts";

export interface RawPromotionDeduplicatorOptionsV2 {
  /**
   * Maximum duplicate identity details returned for display/reporting. The
   * deduplication result and every aggregate counter always cover all inputs.
   */
  diagnosticDetailLimit?: number;
}

export interface RawPromotionDeduplicationStatsV2 {
  acceptedInputRecords: number;
  uniquePromotions: number;
  duplicateRecordsRemoved: number;
  duplicatedIdentities: number;
  identitiesWithConflictingProviderFields: number;
  duplicateDetailsReturned: number;
  duplicateDetailsTruncated: boolean;
}

export interface RawPromotionDeduplicationResultV2 {
  uniquePromotions: RawImpactPromotionV2[];
  duplicateDiagnostics: DuplicatePromotionProvenanceV2[];
  stats: RawPromotionDeduplicationStatsV2;
}

const DEFAULT_DIAGNOSTIC_DETAIL_LIMIT = 100;
const CONFLICT_FIELDS: DuplicatePromotionConflictFieldV2[] = [
  "advertiserId",
  "advertiserName",
  "campaignId",
  "programId",
];

interface RetainedEntry {
  promotion: RawImpactPromotionV2;
  occurrences: ImpactRecordProvenanceV2[];
  conflicts: Set<DuplicatePromotionConflictFieldV2>;
}

interface OrderedPromotion {
  promotion: RawImpactPromotionV2;
  inputIndex: number;
}

function compareProvenance(left: OrderedPromotion, right: OrderedPromotion): number {
  const leftProvenance = left.promotion.provenance;
  const rightProvenance = right.promotion.provenance;
  return (
    leftProvenance.fetchSequence - rightProvenance.fetchSequence ||
    leftProvenance.recordIndex - rightProvenance.recordIndex ||
    left.inputIndex - right.inputIndex
  );
}

function detailLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DIAGNOSTIC_DETAIL_LIMIT;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("diagnosticDetailLimit must be a non-negative integer");
  }
  return value;
}

function assertAcceptedPromotion(promotion: RawImpactPromotionV2): asserts promotion is RawImpactPromotionV2 & { promotionId: string } {
  if (!promotion.promotionId) {
    throw new Error("RawPromotionDeduplicator accepts only parsed promotions with PromotionIds");
  }
}

function conflictsBetween(
  retained: RawImpactPromotionV2,
  duplicate: RawImpactPromotionV2,
): DuplicatePromotionConflictFieldV2[] {
  return CONFLICT_FIELDS.filter((field) => retained[field] !== duplicate[field]);
}

function diagnosticOf(promotionId: string, entry: RetainedEntry): DuplicatePromotionProvenanceV2 {
  return {
    promotionId,
    retainedOccurrence: entry.occurrences[0]!,
    occurrences: [...entry.occurrences],
    totalOccurrences: entry.occurrences.length,
    duplicateOccurrenceCount: entry.occurrences.length - 1,
    conflictingProviderFields: [...entry.conflicts],
  };
}

/**
 * Deduplicates parser-accepted Impact promotions by exact immutable
 * `PromotionIds`. A copied provenance-sorted view establishes the retention
 * order; input records and their raw payloads are never changed.
 */
export class RawPromotionDeduplicator {
  static deduplicate(
    promotions: readonly RawImpactPromotionV2[],
    options: RawPromotionDeduplicatorOptionsV2 = {},
  ): RawPromotionDeduplicationResultV2 {
    const ordered = promotions
      .map((promotion, inputIndex): OrderedPromotion => ({ promotion, inputIndex }))
      .sort(compareProvenance);
    const retainedByPromotionId = new Map<string, RetainedEntry>();
    const uniquePromotions: RawImpactPromotionV2[] = [];
    /** First-duplicate discovery order in the explicit provenance-sorted walk. */
    const duplicatePromotionIds: string[] = [];
    let duplicateRecordsRemoved = 0;

    for (const { promotion } of ordered) {
      assertAcceptedPromotion(promotion);
      const retained = retainedByPromotionId.get(promotion.promotionId);
      if (!retained) {
        retainedByPromotionId.set(promotion.promotionId, {
          promotion,
          occurrences: [promotion.provenance],
          conflicts: new Set(),
        });
        uniquePromotions.push(promotion);
        continue;
      }

      duplicateRecordsRemoved += 1;
      if (retained.occurrences.length === 1) duplicatePromotionIds.push(promotion.promotionId);
      retained.occurrences.push(promotion.provenance);
      for (const field of conflictsBetween(retained.promotion, promotion)) retained.conflicts.add(field);
    }

    const allDuplicateDiagnostics = duplicatePromotionIds.map((promotionId) =>
      diagnosticOf(promotionId, retainedByPromotionId.get(promotionId)!),
    );
    const limit = detailLimit(options.diagnosticDetailLimit);
    const duplicateDiagnostics = allDuplicateDiagnostics.slice(0, limit);

    return {
      uniquePromotions,
      duplicateDiagnostics,
      stats: {
        acceptedInputRecords: promotions.length,
        uniquePromotions: uniquePromotions.length,
        duplicateRecordsRemoved,
        duplicatedIdentities: allDuplicateDiagnostics.length,
        identitiesWithConflictingProviderFields: allDuplicateDiagnostics.filter(
          (entry) => entry.conflictingProviderFields.length > 0,
        ).length,
        duplicateDetailsReturned: duplicateDiagnostics.length,
        duplicateDetailsTruncated: duplicateDiagnostics.length < allDuplicateDiagnostics.length,
      },
    };
  }
}
