import assert from "node:assert/strict";
import test from "node:test";
import { ImpactAdsPageParser } from "../ImpactAdsPageParser.ts";

function parse(value: unknown) {
  return ImpactAdsPageParser.parse(JSON.stringify(value));
}

test("strict Ads parsing preserves opaque IDs and retains no code values", () => {
  const result = parse({
    Ads: [{
      Id: "  Ad-001_A  ",
      CampaignId: 42,
      CampaignName: " Campaign ",
      AdvertiserId: " Advertiser-9 ",
      AdvertiserName: " Merchant ",
      DealId: 7,
      DealState: " ACTIVE ",
      DealDefaultPromoCode: " SECRET-DEFAULT ",
      Code: " <html>SECRET-CREATIVE</html> ",
      TrackingLink: " https://tracking.example/private ",
      LandingPageUrl: " https://merchant.example/private ",
      StartDate: " 2026-01-01T00:00:00Z ",
      EndDate: " 2026-12-31T23:59:59Z ",
      Uri: " /Mediapartners/private/Ads/Ad-001_A ",
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.quarantineCounts, {
    malformed_record: 0,
    missing_ad_id: 0,
  });
  assert.deepEqual(result.records, [{
    adId: "Ad-001_A",
    campaignId: "42",
    campaignName: "Campaign",
    advertiserId: "Advertiser-9",
    advertiserName: "Merchant",
    dealId: "7",
    dealState: "ACTIVE",
    dealDefaultPromoCodeShape: "nonemptyString",
    codeShape: "nonemptyString",
    trackingLink: "https://tracking.example/private",
    landingPageUrl: "https://merchant.example/private",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T23:59:59Z",
  }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SECRET-DEFAULT"), false);
  assert.equal(serialized.includes("SECRET-CREATIVE"), false);
  assert.equal(serialized.includes("/Mediapartners/private"), false);
});

test("malformed records and invalid or missing Ad Ids are quarantined exactly", () => {
  const result = parse({
    Ads: [null, [], "row", {}, { Id: null }, { Id: {} }, { Id: 12 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawRecordCount, 7);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.adId, "12");
  assert.deepEqual(result.quarantineCounts, {
    malformed_record: 3,
    missing_ad_id: 3,
  });
  assert.equal(
    result.records.length + result.quarantineCounts.malformed_record +
      result.quarantineCounts.missing_ad_id,
    result.rawRecordCount,
  );
});

test("Code fields use exhaustive value-shape classifications", () => {
  const values = [
    { Id: "missing" },
    { Id: "null", Code: null, DealDefaultPromoCode: null },
    { Id: "empty", Code: "  ", DealDefaultPromoCode: "" },
    { Id: "text", Code: "VALUE", DealDefaultPromoCode: "VALUE" },
    { Id: "other", Code: { private: "value" }, DealDefaultPromoCode: 42 },
  ];
  const result = parse({ Ads: values });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records.map((record) => record.codeShape), [
    "missing",
    "null",
    "emptyOrWhitespaceString",
    "nonemptyString",
    "otherShape",
  ]);
  assert.deepEqual(
    result.records.map((record) => record.dealDefaultPromoCodeShape),
    [
      "missing",
      "null",
      "emptyOrWhitespaceString",
      "nonemptyString",
      "otherShape",
    ],
  );
});

test("only a root object with the exact Ads array is accepted", () => {
  for (
    const [body, reason] of [
      ["not-json", "invalid_json"],
      [JSON.stringify([]), "envelope_not_object"],
      [JSON.stringify({ ads: [] }), "missing_collection"],
      [JSON.stringify({ Ads: {} }), "collection_not_array"],
    ] as const
  ) {
    const result = ImpactAdsPageParser.parse(body);
    assert.deepEqual(result, { ok: false, reason });
  }
});

test("continuation accepts only an exact nonempty value or proven terminal blank/null", () => {
  const exact = "https://api.impact.com/next?Page=2&Cursor=opaque";
  for (
    const [next, expected] of [
      [null, null],
      ["", null],
      ["   ", null],
    ] as const
  ) {
    const result = parse({
      "@page": "4",
      "@numpages": "4",
      "@nextpageuri": next,
      Ads: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.nextContinuationUri, expected);
  }
  const withExact = parse({
    "@page": "4",
    "@numpages": "4",
    "@nextpageuri": exact,
    Ads: [],
  });
  assert.equal(withExact.ok, true);
  if (withExact.ok) assert.equal(withExact.nextContinuationUri, exact);

  for (
    const envelope of [
      { "@page": "3", "@numpages": "4", "@nextpageuri": null, Ads: [] },
      { "@numpages": "4", "@nextpageuri": null, Ads: [] },
      { "@page": "4", "@nextpageuri": null, Ads: [] },
      { "@page": "x", "@numpages": "x", "@nextpageuri": "", Ads: [] },
      { "@page": "5", "@numpages": "4", "@nextpageuri": null, Ads: [] },
    ]
  ) {
    assert.deepEqual(parse(envelope), {
      ok: false,
      reason: "invalid_nextpageuri",
    });
  }
  const absent = parse({ Ads: [] });
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal(absent.nextContinuationUri, null);
});
