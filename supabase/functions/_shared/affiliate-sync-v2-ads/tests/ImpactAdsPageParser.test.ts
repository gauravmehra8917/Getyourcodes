import assert from "node:assert/strict";
import test from "node:test";
import { ImpactAdsCampaignPageParser, ImpactAdsPageParser } from "../index.ts";

function parseAds(value: unknown) {
  return ImpactAdsPageParser.parse(JSON.stringify(value), { fetchSequence: 2 });
}

function parseCampaigns(value: unknown) {
  return ImpactAdsCampaignPageParser.parse(JSON.stringify(value), {
    fetchSequence: 2,
  });
}

test("Ads parser preserves exact Ad identity and validates only DealDefaultPromoCode", () => {
  const result = parseAds({
    "@page": "2",
    "@pagesize": "100",
    Ads: [{
      Id: " Ad-001_A ",
      CampaignId: 42,
      AdvertiserId: " ADV-9 ",
      DealId: 7,
      DealState: " ACTIVE ",
      Name: " Exact title ",
      Description: " Description ",
      DealDefaultPromoCode: " SECRET-PROMO ",
      Code: "<html>SECRET-CREATIVE</html>",
      TrackingLink: " https://tracking.example/private ",
      LandingPageUrl: " https://landing.example/private ",
      DealStartDate: " 2026-02-01T00:00:00Z ",
      DealEndDate: " 2026-11-30T00:00:00Z ",
      StartDate: " 2026-01-01T00:00:00Z ",
      EndDate: " 2026-12-31T00:00:00Z ",
      MinimumPurchaseAmount: "25.50",
      MinimumPurchaseAmountCurrency: " usd ",
      MaximumSavingsAmount: 50,
      MaximumSavingsCurrency: "USD",
      PurchaseLimitQuantity: "2",
      DealScope: " ENTIRE_STORE ",
      Terms: " Provider terms ",
      DiscountPercent: "20",
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records[0], {
    providerOfferKey: { provider: "impact", namespace: "ad", id: "Ad-001_A" },
    campaignId: "42",
    advertiserId: "ADV-9",
    dealId: "7",
    dealState: "ACTIVE",
    title: "Exact title",
    description: "Description",
    trackingUrl: "https://tracking.example/private",
    landingPageUrl: "https://landing.example/private",
    dealStartDate: "2026-02-01T00:00:00Z",
    dealEndDate: "2026-11-30T00:00:00Z",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T00:00:00Z",
    dateFieldsValid: true,
    discountType: "percentage",
    discountValue: 20,
    structuredTerms: {
      minimumPurchase: 25.5,
      maximumSavings: 50,
      purchaseLimit: 2,
      scope: "ENTIRE_STORE",
      currency: "USD",
      text: "Provider terms",
    },
    codeClass: "code_bearing",
    validatedCouponCode: "SECRET-PROMO",
    provenance: {
      fetchSequence: 2,
      recordIndex: 0,
      providerPage: 2,
      providerPageSize: 100,
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SECRET-PROMO"), true);
  assert.equal(serialized.includes("SECRET-CREATIVE"), false);
});

test("Impact Code never upgrades a blank DealDefaultPromoCode", () => {
  const result = parseAds({
    Ads: [{ Id: "Ad-1", DealDefaultPromoCode: " ", Code: "SECRET" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.records[0]?.codeClass, "no_code");
    assert.equal(result.records[0]?.validatedCouponCode, null);
  }
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("DealDefaultPromoCode validation is exact, trimmed, and placeholder-safe", () => {
  const cases = [
    ["SAVE20", "SAVE20"],
    [" SAVE20 ", "SAVE20"],
    ["Summer 20", "Summer 20"],
    ["SAVE-20!", "SAVE-20!"],
    ["Save20", "Save20"],
    ["", null],
    ["   ", null],
    ["n/a", null],
    ["N/A", null],
    ["none", null],
    ["NO CODE", null],
    ["null", null],
    ["undefined", null],
    [null, null],
    [undefined, null],
    [42, null],
    [{ value: "SAVE20" }, null],
  ] as const;
  const result = parseAds({
    Ads: cases.map(([value], index) => ({
      Id: `Ad-${index}`,
      DealDefaultPromoCode: value,
      Code: `IGNORED-${index}`,
    })),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.records.map((record) => record.validatedCouponCode),
    cases.map(([, expected]) => expected),
  );
  assert.deepEqual(
    result.records.map((record) => record.codeClass),
    cases.map(([, expected]) => expected === null ? "no_code" : "code_bearing"),
  );
  assert.equal(JSON.stringify(result).includes("IGNORED-"), false);
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
      DealStartDate: {},
      DealEndDate: [],
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
    dealState: null,
    title: null,
    description: null,
    trackingUrl: null,
    landingPageUrl: null,
    dealStartDate: null,
    dealEndDate: null,
    startDate: null,
    endDate: null,
    dateFieldsValid: false,
    discountType: "unknown",
    discountValue: null,
    structuredTerms: null,
    codeClass: "no_code",
    validatedCouponCode: null,
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

test("all provider date carriers are retained with strict explicit-timezone validity", () => {
  const result = parseAds({
    Ads: [
      {
        Id: "valid",
        DealStartDate: "2026-02-01",
        DealEndDate: "2026-11-30T23:59:59+05:30",
        StartDate: "2026-01-01T00:00:00Z",
        EndDate: null,
      },
      {
        Id: "timezone-less",
        DealStartDate: "2026-02-01T00:00:00",
        StartDate: "2026-01-01T00:00:00Z",
      },
      { Id: "impossible", StartDate: "2026-02-30" },
      {
        Id: "impossible-zoned",
        DealStartDate: "2026-02-30T00:00:00Z",
        StartDate: "2026-01-01T00:00:00Z",
      },
      { Id: "invalid-shape", EndDate: { private: "date" } },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.records.map((record) => ({
      dealStartDate: record.dealStartDate,
      dealEndDate: record.dealEndDate,
      startDate: record.startDate,
      endDate: record.endDate,
      valid: record.dateFieldsValid,
    })),
    [
      {
        dealStartDate: "2026-02-01",
        dealEndDate: "2026-11-30T23:59:59+05:30",
        startDate: "2026-01-01T00:00:00Z",
        endDate: null,
        valid: true,
      },
      {
        dealStartDate: "2026-02-01T00:00:00",
        dealEndDate: null,
        startDate: "2026-01-01T00:00:00Z",
        endDate: null,
        valid: false,
      },
      {
        dealStartDate: null,
        dealEndDate: null,
        startDate: "2026-02-30",
        endDate: null,
        valid: false,
      },
      {
        dealStartDate: "2026-02-30T00:00:00Z",
        dealEndDate: null,
        startDate: "2026-01-01T00:00:00Z",
        endDate: null,
        valid: false,
      },
      {
        dealStartDate: null,
        dealEndDate: null,
        startDate: null,
        endDate: null,
        valid: false,
      },
    ],
  );
});

test("bounded structured provider fields use strict primitive parsing only", () => {
  const result = parseAds({
    Ads: [
      {
        Id: "fixed",
        DealState: " ACTIVE ",
        DiscountAmount: "12.50",
        MinimumPurchaseAmount: "100",
        MaximumSavingsAmount: 25,
        PurchaseLimitQuantity: "3",
        DealScope: " SELECT_ITEMS ",
        Currency: "usd",
        Terms: " Exact provider terms ",
      },
      {
        Id: "invalid",
        DealState: { value: "ACTIVE" },
        DiscountPercent: "20 percent",
        DiscountAmount: [20],
        MinimumPurchaseAmount: "$100",
        MaximumSavingsAmount: { value: 25 },
        PurchaseLimitQuantity: 0,
        DealScope: ["SITEWIDE"],
        Currency: "US dollars",
        Terms: { text: "private" },
      },
      {
        Id: "currency-conflict",
        MinimumPurchaseAmount: 1,
        MinimumPurchaseAmountCurrency: "USD",
        MaximumSavingsCurrency: "EUR",
      },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.records.map((record) => ({
      dealState: record.dealState,
      discountType: record.discountType,
      discountValue: record.discountValue,
      structuredTerms: record.structuredTerms,
    })),
    [
      {
        dealState: "ACTIVE",
        discountType: "fixed",
        discountValue: 12.5,
        structuredTerms: {
          minimumPurchase: 100,
          maximumSavings: 25,
          purchaseLimit: 3,
          scope: "SELECT_ITEMS",
          currency: "USD",
          text: "Exact provider terms",
        },
      },
      {
        dealState: null,
        discountType: "unknown",
        discountValue: null,
        structuredTerms: null,
      },
      {
        dealState: null,
        discountType: "unknown",
        discountValue: null,
        structuredTerms: {
          minimumPurchase: 1,
          maximumSavings: null,
          purchaseLimit: null,
          scope: null,
          currency: null,
          text: null,
        },
      },
    ],
  );
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

test("continuation stays exact and rejects impossible positive page metadata", () => {
  const exact = "https://api.impact.com/next?Cursor=opaque%2Fvalue&Page=2";
  const exactResult = parseAds({ Ads: [], "@nextpageuri": exact });
  assert.equal(exactResult.ok, true);
  if (exactResult.ok) assert.equal(exactResult.nextContinuationUri, exact);

  const terminalWithContinuation = parseAds({
    Ads: [],
    "@page": "8",
    "@numpages": "8",
    "@nextpageuri": exact,
  });
  assert.equal(terminalWithContinuation.ok, true);
  if (terminalWithContinuation.ok) {
    assert.equal(terminalWithContinuation.nextContinuationUri, exact);
  }

  assert.deepEqual(
    parseAds({
      Ads: [],
      "@page": "9",
      "@numpages": "8",
      "@nextpageuri": exact,
    }),
    { ok: false, reason: "invalid_nextpageuri" },
  );
});

test("Ads and Campaigns require continuation when valid page metadata proves pages remain", () => {
  const streams = [
    {
      name: "Ads",
      parse: (metadata: Record<string, unknown>) =>
        parseAds({ Ads: [], ...metadata }),
    },
    {
      name: "Campaigns",
      parse: (metadata: Record<string, unknown>) =>
        parseCampaigns({ Campaigns: [], ...metadata }),
    },
  ];

  for (const stream of streams) {
    for (const next of [undefined, null, "", "  "]) {
      const metadata: Record<string, unknown> = {
        "@page": "8",
        "@numpages": "8",
      };
      if (next !== undefined) metadata["@nextpageuri"] = next;
      const result = stream.parse(metadata);
      assert.equal(result.ok, true, `${stream.name}: terminal ${String(next)}`);
      if (result.ok) assert.equal(result.nextContinuationUri, null);
    }

    for (const next of [undefined, null, "", "  "]) {
      const metadata: Record<string, unknown> = {
        "@page": "1",
        "@numpages": "8",
      };
      if (next !== undefined) metadata["@nextpageuri"] = next;
      assert.deepEqual(stream.parse(metadata), {
        ok: false,
        reason: "invalid_nextpageuri",
      }, `${stream.name}: nonterminal ${String(next)}`);
    }

    assert.deepEqual(
      stream.parse({
        "@page": "9",
        "@numpages": "8",
      }),
      {
        ok: false,
        reason: "invalid_nextpageuri",
      },
      `${stream.name}: impossible page metadata`,
    );

    const unavailable = stream.parse({});
    assert.equal(unavailable.ok, true, `${stream.name}: metadata unavailable`);
    if (unavailable.ok) assert.equal(unavailable.nextContinuationUri, null);
  }
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
