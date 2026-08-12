import assert from "node:assert/strict";
import test from "node:test";
import { RawPromotionDeduplicator } from "../RawPromotionDeduplicator.ts";
import type { RawImpactPromotionV2 } from "../models.ts";
import { overlappingPagePromotions } from "./fixtures/overlapping-pages.ts";

function promotion(input: {
  promotionId: string;
  fetchSequence: number;
  recordIndex: number;
  advertiserId?: string | null;
  advertiserName?: string | null;
  campaignId?: string | null;
  programId?: string | null;
  raw?: Record<string, unknown>;
}): RawImpactPromotionV2 {
  return {
    promotionId: input.promotionId,
    advertiserId: input.advertiserId ?? "advertiser-a",
    advertiserName: input.advertiserName ?? "Advertiser A",
    campaignId: input.campaignId ?? "campaign-a",
    programId: input.programId ?? "program-a",
    raw: input.raw ?? { PromotionIds: input.promotionId },
    provenance: {
      stream: "promotions",
      fetchSequence: input.fetchSequence,
      recordIndex: input.recordIndex,
      sanitizedRequestUrl: `https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=${input.fetchSequence}`,
      sanitizedSourceContinuationUrl: null,
      providerPage: String(input.fetchSequence),
      providerPageSize: "100",
    },
  };
}

test("keeps unique promotions unchanged and removes duplicate PromotionIds", () => {
  const unique = [
    promotion({ promotionId: "A", fetchSequence: 1, recordIndex: 0 }),
    promotion({ promotionId: "B", fetchSequence: 1, recordIndex: 1 }),
  ];
  const uniqueResult = RawPromotionDeduplicator.deduplicate(unique);
  assert.deepEqual(uniqueResult.uniquePromotions, unique);
  assert.deepEqual(uniqueResult.duplicateDiagnostics, []);
  assert.deepEqual(uniqueResult.stats, {
    acceptedInputRecords: 2,
    uniquePromotions: 2,
    duplicateRecordsRemoved: 0,
    duplicatedIdentities: 0,
    identitiesWithConflictingProviderFields: 0,
    duplicateDetailsReturned: 0,
    duplicateDetailsTruncated: false,
  });

  const twoOccurrences = RawPromotionDeduplicator.deduplicate([
    ...unique,
    promotion({ promotionId: "A", fetchSequence: 2, recordIndex: 0 }),
  ]);
  assert.deepEqual(twoOccurrences.uniquePromotions.map((entry) => entry.promotionId), ["A", "B"]);
  assert.equal(twoOccurrences.stats.duplicateRecordsRemoved, 1);
  assert.equal(twoOccurrences.duplicateDiagnostics[0]?.totalOccurrences, 2);

  const threeOccurrences = RawPromotionDeduplicator.deduplicate([
    promotion({ promotionId: "A", fetchSequence: 1, recordIndex: 0 }),
    promotion({ promotionId: "A", fetchSequence: 2, recordIndex: 0 }),
    promotion({ promotionId: "A", fetchSequence: 3, recordIndex: 0 }),
  ]);
  assert.equal(threeOccurrences.uniquePromotions.length, 1);
  assert.equal(threeOccurrences.stats.duplicateRecordsRemoved, 2);
  assert.equal(threeOccurrences.duplicateDiagnostics[0]?.duplicateOccurrenceCount, 2);
});

test("golden overlapping pages retain the first C and permanent provenance for both pages", () => {
  const result = RawPromotionDeduplicator.deduplicate(overlappingPagePromotions);
  assert.deepEqual(result.uniquePromotions.map((entry) => entry.promotionId), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(result.stats, {
    acceptedInputRecords: 6,
    uniquePromotions: 5,
    duplicateRecordsRemoved: 1,
    duplicatedIdentities: 1,
    identitiesWithConflictingProviderFields: 0,
    duplicateDetailsReturned: 1,
    duplicateDetailsTruncated: false,
  });
  assert.deepEqual(result.duplicateDiagnostics, [{
    promotionId: "C",
    retainedOccurrence: overlappingPagePromotions[2]!.provenance,
    occurrences: [overlappingPagePromotions[2]!.provenance, overlappingPagePromotions[3]!.provenance],
    totalOccurrences: 2,
    duplicateOccurrenceCount: 1,
    conflictingProviderFields: [],
  }]);
  assert.equal(result.duplicateDiagnostics[0]?.occurrences[1]?.sanitizedSourceContinuationUrl?.includes("%5BREDACTED%5D"), true);
});

test("sorts a copied provenance view so the first retrieved identity remains retained", () => {
  const first = promotion({
    promotionId: "same", fetchSequence: 1, recordIndex: 9,
    advertiserId: "advertiser-first", campaignId: "campaign-first", programId: "program-first",
  });
  const later = promotion({
    promotionId: "same", fetchSequence: 2, recordIndex: 0,
    advertiserId: "advertiser-later", campaignId: "campaign-later", programId: "program-later",
  });
  const input = [later, first];
  const result = RawPromotionDeduplicator.deduplicate(input);
  assert.equal(result.uniquePromotions[0], first);
  assert.equal(result.uniquePromotions[0]?.advertiserId, "advertiser-first");
  assert.equal(result.uniquePromotions[0]?.campaignId, "campaign-first");
  assert.equal(result.uniquePromotions[0]?.programId, "program-first");
  assert.deepEqual(input, [later, first]);
});

test("reports identity conflicts without merging or repairing the retained record", () => {
  const retained = promotion({
    promotionId: "conflict", fetchSequence: 1, recordIndex: 0,
    advertiserId: "advertiser-first", advertiserName: "First advertiser",
    campaignId: "campaign-first", programId: "program-first",
  });
  const conflicting = promotion({
    promotionId: "conflict", fetchSequence: 2, recordIndex: 0,
    advertiserId: "advertiser-later", advertiserName: "Later advertiser",
    campaignId: "campaign-later", programId: "program-later",
  });
  const result = RawPromotionDeduplicator.deduplicate([conflicting, retained]);
  assert.equal(result.uniquePromotions[0], retained);
  assert.deepEqual(result.duplicateDiagnostics[0]?.conflictingProviderFields, [
    "advertiserId", "advertiserName", "campaignId", "programId",
  ]);
  assert.equal(result.stats.identitiesWithConflictingProviderFields, 1);
  assert.deepEqual(result.uniquePromotions[0], retained);
});

test("bounds returned duplicate details without weakening complete deduplication or exact stats", () => {
  const input = [
    promotion({ promotionId: "A", fetchSequence: 1, recordIndex: 0 }),
    promotion({ promotionId: "A", fetchSequence: 2, recordIndex: 0 }),
    promotion({ promotionId: "B", fetchSequence: 1, recordIndex: 1 }),
    promotion({ promotionId: "B", fetchSequence: 2, recordIndex: 1 }),
    promotion({ promotionId: "C", fetchSequence: 1, recordIndex: 2 }),
  ];
  const result = RawPromotionDeduplicator.deduplicate(input, { diagnosticDetailLimit: 1 });
  assert.deepEqual(result.uniquePromotions.map((entry) => entry.promotionId), ["A", "B", "C"]);
  assert.deepEqual(result.duplicateDiagnostics.map((entry) => entry.promotionId), ["A"]);
  assert.deepEqual(result.stats, {
    acceptedInputRecords: 5,
    uniquePromotions: 3,
    duplicateRecordsRemoved: 2,
    duplicatedIdentities: 2,
    identitiesWithConflictingProviderFields: 0,
    duplicateDetailsReturned: 1,
    duplicateDetailsTruncated: true,
  });
});

test("does not mutate raw provider fields or leak raw secret-bearing fields into diagnostics", () => {
  const first = promotion({
    promotionId: "safe", fetchSequence: 1, recordIndex: 0,
    raw: { PromotionIds: "safe", Authorization: "Basic secret", token: "opaque" },
  });
  const duplicate = promotion({
    promotionId: "safe", fetchSequence: 2, recordIndex: 0,
    raw: { PromotionIds: "safe", Authorization: "Basic other-secret", token: "other-opaque" },
  });
  const input = [first, duplicate];
  const before = structuredClone(input);
  const result = RawPromotionDeduplicator.deduplicate(input);
  assert.deepEqual(input, before);
  const diagnostics = JSON.stringify(result.duplicateDiagnostics);
  assert.equal(diagnostics.includes("secret"), false);
  assert.equal(diagnostics.includes("opaque"), false);
  assert.equal(diagnostics.includes("Authorization"), false);
});
