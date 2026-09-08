import assert from "node:assert/strict";
import test from "node:test";
import { ImpactAdsCampaignPageParser, ImpactAdsPageParser } from "../index.ts";

function parseAds(value: unknown) {
  return ImpactAdsPageParser.parse(JSON.stringify(value), { fetchSequence: 2 });
}

test("Ads parser preserves exact Ad identity and discards both code values", () => {
  const result = parseAds({
    "@page": "2",
    "@pagesize": "100",
    Ads: [{
      Id: " Ad-001_A ",
      CampaignId: 42,
      AdvertiserId: " ADV-9 ",
      DealId: 7,
      Name: " Exact title ",
      Description: " Description ",
      DealDefaultPromoCode: " SECRET-PROMO ",
      Code: "<html>SECRET-CREATIVE</html>",
      TrackingLink: " https://tracking.example/private ",
      LandingPageUrl: " https://landing.example/private ",
      StartDate: " 2026-01-01T00:00:00Z ",
      EndDate: " 2026-12-31T00:00:00Z ",
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records[0], {
    providerOfferKey: { provider: "impact", namespace: "ad", id: "Ad-001_A" },
    campaignId: "42",
    advertiserId: "ADV-9",
    dealId: "7",
    title: "Exact title",
    description: "Description",
    trackingUrl: "https://tracking.example/private",
    landingPageUrl: "https://landing.example/private",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T00:00:00Z",
    codeClass: "code_bearing",
    provenance: {
      fetchSequence: 2,
      recordIndex: 0,
      providerPage: 2,
      providerPageSize: 100,
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SECRET-PROMO"), false);
  assert.equal(serialized.includes("SECRET-CREATIVE"), false);
});

test("Impact Code never upgrades a blank DealDefaultPromoCode", () => {
  const result = parseAds({
    Ads: [{ Id: "Ad-1", DealDefaultPromoCode: " ", Code: "SECRET" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.records[0]?.codeClass, "no_code");
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("presentation fields stay string-only and page metadata is bounded numeric data", () => {
  const privatePageValue = "PRIVATE-PAGE-VALUE";
  const privatePageSizeValue = "https://private.invalid/page-size";
  const result = parseAds({
    "@page": privatePageValue,
    "@pagesize": privatePageSizeValue,
    Ads: [{
      Id: 12,
      CampaignId: 34,
      AdvertiserId: 56,
      DealId: 78,
      Name: 90,
      Description: 91,
      TrackingLink: 92,
      LandingPageUrl: 93,
      StartDate: 94,
      EndDate: 95,
      DealDefaultPromoCode: 96,
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records[0], {
    providerOfferKey: { provider: "impact", namespace: "ad", id: "12" },
    campaignId: "34",
    advertiserId: "56",
    dealId: "78",
    title: null,
    description: null,
    trackingUrl: null,
    landingPageUrl: null,
    startDate: null,
    endDate: null,
    codeClass: "no_code",
    provenance: {
      fetchSequence: 2,
      recordIndex: 0,
      providerPage: null,
      providerPageSize: null,
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(privatePageValue), false);
  assert.equal(serialized.includes(privatePageSizeValue), false);

  const numericMetadata = parseAds({
    "@page": 2,
    "@pagesize": "100",
    Ads: [],
  });
  assert.equal(numericMetadata.ok, true);
  if (numericMetadata.ok) {
    assert.equal(numericMetadata.providerPage, 2);
    assert.equal(numericMetadata.providerPageSize, 100);
  }
});

test("missing AdId is quarantined while missing CampaignId remains accepted", () => {
  const result = parseAds({
    Ads: [null, [], {}, { Id: null }, { Id: {} }, { Id: 12 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawRecordCount, 6);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.providerOfferKey.id, "12");
  assert.equal(result.records[0]?.campaignId, null);
  assert.deepEqual(result.quarantineReasonCounts, {
    malformed_record: 2,
    missing_ad_id: 3,
    missing_campaign_id: 0,
  });
});

test("Ads parser accepts only the exact root collection", () => {
  for (
    const [body, reason] of [
      ["not-json", "invalid_json"],
      [JSON.stringify([]), "envelope_not_object"],
      [JSON.stringify({ ads: [] }), "missing_collection"],
      [JSON.stringify({ Ads: {} }), "collection_not_array"],
    ] as const
  ) {
    assert.deepEqual(ImpactAdsPageParser.parse(body, { fetchSequence: 1 }), {
      ok: false,
      reason,
    });
  }
});

test("continuation stays exact and blank/null requires proven terminal metadata", () => {
  const exact = "https://api.impact.com/next?Cursor=opaque%2Fvalue&Page=2";
  const exactResult = parseAds({ Ads: [], "@nextpageuri": exact });
  assert.equal(exactResult.ok, true);
  if (exactResult.ok) assert.equal(exactResult.nextContinuationUri, exact);

  for (const value of [null, "", "  "]) {
    const terminal = parseAds({
      Ads: [],
      "@page": "4",
      "@numpages": "4",
      "@nextpageuri": value,
    });
    assert.equal(terminal.ok, true);
    if (terminal.ok) assert.equal(terminal.nextContinuationUri, null);
  }
  for (
    const value of [
      { Ads: [], "@page": "3", "@numpages": "4", "@nextpageuri": null },
      { Ads: [], "@numpages": "4", "@nextpageuri": null },
      { Ads: [], "@page": "x", "@numpages": "x", "@nextpageuri": "" },
      { Ads: [], "@page": "5", "@numpages": "4", "@nextpageuri": null },
    ]
  ) {
    assert.deepEqual(parseAds(value), {
      ok: false,
      reason: "invalid_nextpageuri",
    });
  }
  const absent = parseAds({ Ads: [] });
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal(absent.nextContinuationUri, null);
});

test("dedicated Campaign parser accepts exact IDs and quarantines incomplete rows", () => {
  const result = ImpactAdsCampaignPageParser.parse(
    JSON.stringify({
      Campaigns: [
        {
          CampaignId: " Campaign-A ",
          AdvertiserId: 9,
          CampaignName: " Merchant A ",
        },
        {},
        null,
      ],
    }),
    { fetchSequence: 1 },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.records[0]?.campaignId, "Campaign-A");
  assert.equal(result.records[0]?.advertiserId, "9");
  assert.deepEqual(result.quarantineReasonCounts, {
    malformed_record: 1,
    missing_ad_id: 0,
    missing_campaign_id: 1,
  });
});

test("Campaign presentation carriers do not coerce structured or numeric values", () => {
  const result = ImpactAdsCampaignPageParser.parse(
    JSON.stringify({
      Campaigns: [{
        CampaignId: 123,
        AdvertiserId: 456,
        CampaignName: 789,
        Name: { private: "name" },
        CampaignUrl: 10,
        TrackingLink: ["private"],
      }],
    }),
    { fetchSequence: 1 },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records[0], {
    campaignId: "123",
    advertiserId: "456",
    campaignName: null,
    destinationUrl: null,
    trackingUrl: null,
    provenance: {
      fetchSequence: 1,
      recordIndex: 0,
      providerPage: null,
      providerPageSize: null,
    },
  });
});
