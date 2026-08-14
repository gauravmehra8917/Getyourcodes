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
