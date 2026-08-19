import assert from "node:assert/strict";
import test from "node:test";
import { ImpactPageParser } from "../ImpactPageParser.ts";
import type { ImpactPageProvenanceV2 } from "../diagnostics.ts";

const provenance: ImpactPageProvenanceV2 = {
  stream: "promotions",
  fetchSequence: 4,
  sanitizedRequestUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=2",
  sanitizedSourceContinuationUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=2",
  providerPage: null,
  providerPageSize: null,
};

test("strictly parses Promotions and preserves distinct provider identities", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    "@page": "2",
    "@pagesize": "100",
    "@total": "200",
    "@numpages": "2",
    "@uri": "/Mediapartners/2303074/Promotions?Page=2",
    "@nextpageuri": "/Mediapartners/2303074/Promotions?Page=3&Opaque=exact",
    Promotions: [{
      PromotionIds: "  001-A_B  ",
      AdvertiserId: "Advertiser-01",
      AdvertiserName: "Acme",
      CampaignId: "Campaign-09",
      ProgramId: "Program-0007",
      PromotionTitle: "Save 20%",
      Description: "A direct provider description",
      GenericRedemptionCode: "SAVE20",
      TrackingLink: "https://track.example/promotion",
      StartDate: "2026-01-01T00:00:00Z",
      EndDate: "2026-02-01T00:00:00Z",
    }],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.pagination, {
    page: "2", pageSize: "100", total: "200", numPages: "2",
    uri: "/Mediapartners/2303074/Promotions?Page=2",
  });
  assert.equal(parsed.nextContinuationUri, "/Mediapartners/2303074/Promotions?Page=3&Opaque=exact");
  assert.deepEqual(parsed.records[0], {
    promotionId: "001-A_B",
    advertiserId: "Advertiser-01",
    advertiserName: "Acme",
    campaignId: "Campaign-09",
    programId: "Program-0007",
    promotionTitle: "Save 20%",
    description: "A direct provider description",
    genericRedemptionCode: "SAVE20",
    trackingUrl: "https://track.example/promotion",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-02-01T00:00:00Z",
    raw: {
      PromotionIds: "  001-A_B  ", AdvertiserId: "Advertiser-01", AdvertiserName: "Acme",
      CampaignId: "Campaign-09", ProgramId: "Program-0007", PromotionTitle: "Save 20%",
      Description: "A direct provider description", GenericRedemptionCode: "SAVE20",
      TrackingLink: "https://track.example/promotion", StartDate: "2026-01-01T00:00:00Z",
      EndDate: "2026-02-01T00:00:00Z",
    },
    provenance: { ...provenance, providerPage: "2", providerPageSize: "100", recordIndex: 0 },
  });
});

test("rejects malformed Promotion pages without envelope fallbacks", () => {
  const cases = [
    ["{", "invalid_json", "Impact response is not valid JSON"],
    [JSON.stringify([]), "envelope_not_object", "Impact response envelope is not an object"],
    [JSON.stringify({ Ads: [] }), "missing_collection", "Impact response is missing Promotions"],
    [JSON.stringify({ Promotions: {} }), "collection_not_array", "Impact response Promotions is not an array"],
    [JSON.stringify({ Promotions: [], "@nextpageuri": 2 }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
    [JSON.stringify({ Promotions: [], "@nextpageuri": "" }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
    [JSON.stringify({ Promotions: [], "@nextpageuri": null }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
  ] as const;
  for (const [body, reason, detail] of cases) {
    const parsed = ImpactPageParser.promotions(body, { provenance });
    assert.deepEqual(parsed, { ok: false, code: "malformed_page", reason, detail });
  }
});

test("accepts empty continuations only on metadata-proven terminal pages", () => {
  const cases = [
    [
      ImpactPageParser.promotions,
      { "@page": "4", "@numpages": "4", "@nextpageuri": null, Promotions: [] },
    ],
    [
      ImpactPageParser.campaigns,
      { "@page": "17", "@numpages": "17", "@nextpageuri": "", Campaigns: [] },
    ],
    [
      ImpactPageParser.promotions,
      { "@page": "4", "@numpages": "4", "@nextpageuri": "   \t", Promotions: [] },
    ],
  ] as const;

  for (const [parse, body] of cases) {
    const parsed = parse(JSON.stringify(body), { provenance });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.nextContinuationUri, null);
  }
});

test("rejects empty continuations without valid terminal-page proof", () => {
  const cases = [
    { "@page": "3", "@numpages": "4", "@nextpageuri": null },
    { "@numpages": "4", "@nextpageuri": null },
    { "@page": "4", "@nextpageuri": null },
    { "@page": "not-a-number", "@numpages": "4", "@nextpageuri": null },
    { "@page": "4", "@numpages": "not-a-number", "@nextpageuri": null },
    { "@page": "0", "@numpages": "0", "@nextpageuri": null },
    { "@page": "1.5", "@numpages": "1.5", "@nextpageuri": null },
    { "@page": "5", "@numpages": "4", "@nextpageuri": null },
  ] as const;

  for (const metadata of cases) {
    const parsed = ImpactPageParser.promotions(JSON.stringify({ Promotions: [], ...metadata }), { provenance });
    assert.deepEqual(parsed, {
      ok: false,
      code: "malformed_page",
      reason: "invalid_nextpageuri",
      detail: "Impact response @nextpageuri is not a nonempty string",
    });
  }
});

test("preserves nonempty continuations and absent terminal continuations", () => {
  const exactContinuation = "/Mediapartners/2303074/Promotions?Page=5&Opaque=exact";
  const nonempty = ImpactPageParser.promotions(JSON.stringify({
    "@page": "4",
    "@numpages": "4",
    "@nextpageuri": exactContinuation,
    Promotions: [],
  }), { provenance });
  assert.equal(nonempty.ok, true);
  if (nonempty.ok) assert.equal(nonempty.nextContinuationUri, exactContinuation);

  const absent = ImpactPageParser.promotions(JSON.stringify({ Promotions: [] }), { provenance });
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal(absent.nextContinuationUri, null);
});

test("quarantines malformed and identity-less Promotions", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [null, { PromotionIds: "   " }, { PromotionIds: "valid" }],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.quarantinedRecords.map(({ reason, provenance: item }) => ({ reason, recordIndex: item.recordIndex })), [
    { reason: "malformed_record", recordIndex: 0 },
    { reason: "missing_promotion_id", recordIndex: 1 },
  ]);
});

test("classifies exact raw PromotionIds shapes before identity extraction", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      {},
      { PromotionIds: null },
      { PromotionIds: "  exact-string-id  " },
      { PromotionIds: "" },
      { PromotionIds: "  \t " },
      { PromotionIds: 42.5 },
      { PromotionIds: ["array-value-must-not-leak"] },
      { PromotionIds: { nested: "object-value-must-not-leak" } },
      { PromotionIds: false },
      "malformed-record-value-must-not-leak",
    ],
  }), { provenance });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.promotionIdShapeCounts, {
    missing: 1,
    null: 1,
    nonempty_string: 1,
    empty_or_whitespace_string: 2,
    number: 1,
    array: 1,
    object: 1,
    boolean: 1,
    other: 0,
  });
  assert.deepEqual(parsed.records.map((record) => record.promotionId), ["exact-string-id", "42.5"]);
  assert.deepEqual(
    parsed.quarantinedRecords.reduce<Record<string, number>>((counts, record) => {
      counts[record.reason] = (counts[record.reason] ?? 0) + 1;
      return counts;
    }, {}),
    { missing_promotion_id: 7, malformed_record: 1 },
  );
  assert.equal(
    Object.values(parsed.promotionIdShapeCounts).reduce((total, count) => total + count, 0),
    parsed.rawRecordCount - 1,
  );
});

test("counts an extreme JSON number as raw number shape while preserving finite-only identity", () => {
  const parsed = ImpactPageParser.promotions(
    '{"Promotions":[{"PromotionIds":1e400}]}',
    { provenance },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.promotionIdShapeCounts?.number, 1);
  assert.equal(parsed.records.length, 0);
  assert.deepEqual(parsed.quarantinedRecords.map((record) => record.reason), ["missing_promotion_id"]);
});

test("counts PromotionFileId opaque scalar shapes and exact distinct cardinality only", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      {},
      { PromotionFileId: null },
      { PromotionFileId: " file-repeat " },
      { PromotionFileId: "file-repeat" },
      { PromotionFileId: 17 },
      { PromotionFileId: { private: "file-object-must-not-leak" } },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.promotionIdentifierCarrierDiagnostics?.promotionFileId,
    {
      missing: 1,
      null: 1,
      validOpaqueScalar: 3,
      invalidShape: 1,
      distinctValidOpaqueValues: 2,
    },
  );
  assert.deepEqual(
    parsed.quarantinedRecords.map((record) => record.reason),
    Array.from({ length: 6 }, () => "missing_promotion_id"),
  );
  assert.equal(
    JSON.stringify(parsed.promotionIdentifierCarrierDiagnostics).includes(
      "file-object-must-not-leak",
    ),
    false,
  );

  const unique = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      { PromotionFileId: "file-one" },
      { PromotionFileId: 2 },
      { PromotionFileId: "file-three" },
    ],
  }), { provenance });
  assert.equal(unique.ok, true);
  if (!unique.ok) return;
  const counts = unique.promotionIdentifierCarrierDiagnostics?.promotionFileId;
  assert.equal(counts?.validOpaqueScalar, 3);
  assert.equal(counts?.distinctValidOpaqueValues, 3);
});

test("counts bounded Uri shapes and promotion retrieval path cardinality without values", () => {
  const relative =
    "/Mediapartners/account-private/Promotions/terminal-private?query=private";
  const absolute =
    "https://api.impact.com/prefix/Mediapartners/account-other/Promotions/terminal-private#fragment-private";
  const malformed = "http://[malformed-private";
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      {},
      { Uri: null },
      { Uri: relative },
      { Uri: relative },
      { Uri: absolute },
      { Uri: "https://api.impact.com/Mediapartners/account/Campaigns/not-promotion" },
      { Uri: { private: "uri-object-must-not-leak" } },
      { Uri: "   " },
      { Uri: malformed },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.promotionIdentifierCarrierDiagnostics?.uri, {
    missing: 1,
    null: 1,
    nonemptyString: 5,
    invalidShape: 2,
    distinctNonemptyValues: 4,
    promotionRetrievePathShape: 3,
    distinctPromotionRetrieveTerminalSegments: 1,
  });
  const serialized = JSON.stringify(
    parsed.promotionIdentifierCarrierDiagnostics,
  );
  for (const privateValue of [
    relative,
    absolute,
    malformed,
    "account-private",
    "terminal-private",
    "uri-object-must-not-leak",
  ]) assert.equal(serialized.includes(privateValue), false);
});

test("diagnostic carrier candidates never replace exact PromotionIds identity", () => {
  const candidateOnly = {
    PromotionFileId: "file-candidate-private",
    Uri: "/Mediapartners/account-private/Promotions/terminal-private",
    PromotionId: "singular-candidate-private",
    Id: 41,
  };
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      candidateOnly,
      {
        ...candidateOnly,
        PromotionFileId: "file-accepted-private",
        Uri: "https://api.impact.com/Mediapartners/account-private/Promotions/terminal-accepted-private",
        PromotionId: "singular-accepted-private",
        Id: 42,
        PromotionIds: "canonical-promotion-id",
      },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.quarantinedRecords.map((record) => record.reason),
    ["missing_promotion_id"],
  );
  assert.deepEqual(
    parsed.records.map((record) => record.promotionId),
    ["canonical-promotion-id"],
  );
  assert.deepEqual(
    parsed.promotionIdentifierCarrierDiagnostics?.promotionIdSingular,
    {
      missing: 0,
      null: 0,
      validOpaqueScalar: 2,
      invalidShape: 0,
      distinctValidOpaqueValues: 2,
    },
  );
  assert.deepEqual(parsed.promotionIdentifierCarrierDiagnostics?.id, {
    missing: 0,
    null: 0,
    validOpaqueScalar: 2,
    invalidShape: 0,
    distinctValidOpaqueValues: 2,
  });
});

test("compares singular PromotionId and retrieval Uri terminal without accepting either as identity", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      { PromotionId: "123", Uri: "/Mediapartners/x/Promotions/123" },
      { PromotionId: 123, Uri: "/Mediapartners/x/Promotions/123" },
      { PromotionId: "00123", Uri: "/Mediapartners/x/Promotions/123" },
      { PromotionId: "Case", Uri: "/Mediapartners/x/Promotions/case" },
      { PromotionId: "only-id-private" },
      { Uri: "/Mediapartners/x/Promotions/only-uri-private" },
      {},
      {
        PromotionId: "nonpromotion-id-private",
        Uri: "/Mediapartners/x/Campaigns/not-a-promotion-private",
      },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.promotionIdentityEquivalenceDiagnostics, {
    structurallyValidPromotionRecords: 8,
    promotionIdAndRetrieveUriPresent: 4,
    exactPromotionIdEqualsUriTerminal: 2,
    promotionIdDiffersFromUriTerminal: 2,
    promotionIdPresentWithoutRetrieveUri: 2,
    retrieveUriPresentWithoutPromotionId: 1,
    neitherPresent: 1,
    distinctPromotionIds: 5,
    distinctRetrieveUriTerminalSegments: 3,
    promotionIdsMappingToMultipleUriTerminals: 0,
    uriTerminalsMappingToMultiplePromotionIds: 1,
    duplicatePromotionIdRecords: 1,
  });
  assert.equal(parsed.records.length, 0);
  assert.deepEqual(
    parsed.quarantinedRecords.map((record) => record.reason),
    Array.from({ length: 8 }, () => "missing_promotion_id"),
  );
  const serialized = JSON.stringify(
    parsed.promotionIdentityEquivalenceDiagnostics,
  );
  for (const privateValue of [
    "only-id-private",
    "only-uri-private",
    "nonpromotion-id-private",
    "not-a-promotion-private",
  ]) assert.equal(serialized.includes(privateValue), false);
});

test("uses exact encoded pathname code units without decoding equivalence", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      {
        PromotionId: "encoded/value",
        Uri: "/Mediapartners/x/Promotions/encoded%2Fvalue",
      },
      {
        PromotionId: "encoded%2Fvalue",
        Uri: "/Mediapartners/x/Promotions/encoded%2Fvalue",
      },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(
    parsed.promotionIdentityEquivalenceDiagnostics
      ?.exactPromotionIdEqualsUriTerminal,
    1,
  );
  assert.equal(
    parsed.promotionIdentityEquivalenceDiagnostics
      ?.promotionIdDiffersFromUriTerminal,
    1,
  );
});

test("counts directional mapping conflicts and repeated identical pairs exactly", () => {
  const parsed = ImpactPageParser.promotions(JSON.stringify({
    Promotions: [
      { PromotionId: "fanout-private", Uri: "/Mediapartners/x/Promotions/a-private" },
      { PromotionId: "fanout-private", Uri: "/Mediapartners/x/Promotions/b-private" },
      { PromotionId: "fanout-private", Uri: "/Mediapartners/x/Promotions/a-private" },
      { PromotionId: "left-private", Uri: "/Mediapartners/x/Promotions/shared-private" },
      { PromotionId: "right-private", Uri: "/Mediapartners/x/Promotions/shared-private" },
    ],
  }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.promotionIdentityEquivalenceDiagnostics, {
    structurallyValidPromotionRecords: 5,
    promotionIdAndRetrieveUriPresent: 5,
    exactPromotionIdEqualsUriTerminal: 0,
    promotionIdDiffersFromUriTerminal: 5,
    promotionIdPresentWithoutRetrieveUri: 0,
    retrieveUriPresentWithoutPromotionId: 0,
    neitherPresent: 0,
    distinctPromotionIds: 3,
    distinctRetrieveUriTerminalSegments: 3,
    promotionIdsMappingToMultipleUriTerminals: 1,
    uriTerminalsMappingToMultiplePromotionIds: 1,
    duplicatePromotionIdRecords: 2,
  });
  const serialized = JSON.stringify(
    parsed.promotionIdentityEquivalenceDiagnostics,
  );
  for (const privateValue of [
    "fanout-private",
    "a-private",
    "b-private",
    "left-private",
    "right-private",
    "shared-private",
  ]) assert.equal(serialized.includes(privateValue), false);
});

test("strictly parses Campaigns and keeps supplied advertiser identity separate", () => {
  const parsed = ImpactPageParser.campaigns(JSON.stringify({
    "@page": 1,
    Campaigns: [{
      CampaignId: "Campaign-001",
      AdvertiserId: "Advertiser-002",
      CampaignName: "Merchant A",
      CampaignUrl: "https://merchant.example",
      TrackingLink: "https://track.example/a",
    }],
  }), { provenance: { ...provenance, stream: "campaigns" } });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.promotionIdShapeCounts, null);
  assert.equal(parsed.promotionIdentifierCarrierDiagnostics, null);
  assert.equal(parsed.promotionIdentifierCarrierDistinctValues, null);
  assert.equal(parsed.promotionIdentityEquivalenceDiagnostics, null);
  assert.equal(parsed.promotionIdentityEquivalenceRelations, null);
  assert.deepEqual(parsed.records[0], {
    campaignId: "Campaign-001",
    advertiserId: "Advertiser-002",
    campaignName: "Merchant A",
    destinationUrl: "https://merchant.example",
    trackingUrl: "https://track.example/a",
    raw: {
      CampaignId: "Campaign-001", AdvertiserId: "Advertiser-002", CampaignName: "Merchant A",
      CampaignUrl: "https://merchant.example", TrackingLink: "https://track.example/a",
    },
    provenance: { ...provenance, stream: "campaigns", providerPage: "1", providerPageSize: null, recordIndex: 0 },
  });
});

test("rejects malformed Campaign pages and quarantines missing campaign IDs", () => {
  const cases = [
    ["{", "invalid_json", "Impact response is not valid JSON"],
    [JSON.stringify([]), "envelope_not_object", "Impact response envelope is not an object"],
    [JSON.stringify({ Promotions: [] }), "missing_collection", "Impact response is missing Campaigns"],
    [JSON.stringify({ Campaigns: {} }), "collection_not_array", "Impact response Campaigns is not an array"],
    [JSON.stringify({ Campaigns: [], "@nextpageuri": 2 }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
    [JSON.stringify({ Campaigns: [], "@nextpageuri": "" }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
    [JSON.stringify({ Campaigns: [], "@nextpageuri": null }), "invalid_nextpageuri", "Impact response @nextpageuri is not a nonempty string"],
  ] as const;
  for (const [body, reason, detail] of cases) {
    const malformed = ImpactPageParser.campaigns(body, { provenance });
    assert.deepEqual(malformed, { ok: false, code: "malformed_page", reason, detail });
  }
  const parsed = ImpactPageParser.campaigns(JSON.stringify({ Campaigns: [{ ProgramId: "not-a-campaign" }] }), { provenance });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.quarantinedRecords.map((entry) => entry.reason), ["missing_campaign_id"]);
  assert.equal(parsed.records.length, 0);
});
