import assert from "node:assert/strict";
import test from "node:test";
import { RawPromotionDeduplicator } from "../RawPromotionDeduplicator.ts";
import { overlappingPagePromotions } from "./fixtures/overlapping-pages.ts";

test("raw-promotion deduplication invariants hold for the overlapping-pages fixture", () => {
  const result = RawPromotionDeduplicator.deduplicate(overlappingPagePromotions);
  const inputIds = new Set(overlappingPagePromotions.map((entry) => entry.promotionId));
  const outputIds = result.uniquePromotions.map((entry) => entry.promotionId);
  const duplicateIds = new Set(result.duplicateDiagnostics.map((entry) => entry.promotionId));

  assert.ok(result.uniquePromotions.length <= result.stats.acceptedInputRecords);
  assert.equal(
    result.stats.uniquePromotions + result.stats.duplicateRecordsRemoved,
    result.stats.acceptedInputRecords,
  );
  assert.equal(new Set(outputIds).size, outputIds.length);
  assert.equal(result.stats.uniquePromotions, inputIds.size);
  assert.deepEqual([...duplicateIds], ["C"]);
  assert.ok([...duplicateIds].every((promotionId) => inputIds.has(promotionId)));

  for (const diagnostic of result.duplicateDiagnostics) {
    assert.ok(diagnostic.totalOccurrences > 1);
    const first = overlappingPagePromotions
      .filter((entry) => entry.promotionId === diagnostic.promotionId)
      .sort((left, right) => left.provenance.fetchSequence - right.provenance.fetchSequence || left.provenance.recordIndex - right.provenance.recordIndex)[0];
    const retained = result.uniquePromotions.find((entry) => entry.promotionId === diagnostic.promotionId);
    assert.equal(retained, first);
    assert.deepEqual(diagnostic.retainedOccurrence, first?.provenance);
  }
});
