import assert from "node:assert/strict";
import test from "node:test";
import type { RawImpactCampaignV2 } from "../../_shared/affiliate-sync-v2/models.ts";
import { summarizeStoreCategoryTaxonomyV2 } from "../StoreCategoryTaxonomyAudit.ts";

function campaign(raw: Record<string, unknown>): RawImpactCampaignV2 {
  return {
    campaignId: "campaign-sensitive",
    advertiserId: "advertiser-sensitive",
    campaignName: "Merchant Sensitive",
    destinationUrl: "https://destination.example/private",
    trackingUrl: "https://tracking.example/private",
    raw,
    provenance: {
      stream: "campaigns",
      fetchSequence: 1,
      sanitizedRequestUrl: "https://api.impact.com/private",
      sanitizedSourceContinuationUrl: null,
      providerPage: "1",
      providerPageSize: "100",
      recordIndex: 0,
    },
  };
}

const FIELDS = ["Categories", "Category", "Vertical", "Verticals"] as const;

for (const field of FIELDS) {
  test(`${field} accepts a string with exact field coverage`, () => {
    const result = summarizeStoreCategoryTaxonomyV2([
      campaign({ [field]: " Fashion " }),
    ]);
    assert.equal(result.campaignsWithUsableTaxonomy, 1);
    assert.equal(result.campaignsWithoutTaxonomy, 0);
    assert.equal(result.invalidTaxonomyCampaigns, 0);
    assert.deepEqual(result.labels, [
      { label: "Fashion", key: "fashion", campaignCount: 1 },
    ]);
    for (const name of FIELDS) {
      assert.deepEqual(result.fieldCoverage[name], {
        present: name === field ? 1 : 0,
        validString: name === field ? 1 : 0,
        validArray: 0,
        malformed: 0,
      });
    }
  });

  test(`${field} accepts a string array with exact field coverage`, () => {
    const result = summarizeStoreCategoryTaxonomyV2([
      campaign({ [field]: ["Home", "Fashion"] }),
    ]);
    assert.deepEqual(result.labels, [
      { label: "Fashion", key: "fashion", campaignCount: 1 },
      { label: "Home", key: "home", campaignCount: 1 },
    ]);
    assert.deepEqual(result.fieldCoverage[field], {
      present: 1,
      validString: 0,
      validArray: 1,
      malformed: 0,
    });
  });
}

test("empty input returns a complete, empty summary with all coverage fields", () => {
  assert.deepEqual(summarizeStoreCategoryTaxonomyV2([]), {
    complete: true,
    campaignsEvaluated: 0,
    campaignsWithUsableTaxonomy: 0,
    campaignsWithoutTaxonomy: 0,
    invalidTaxonomyCampaigns: 0,
    distinctLabels: 0,
    labels: [],
    labelsTruncated: false,
    fieldCoverage: Object.fromEntries(FIELDS.map((field) => [field, {
      present: 0,
      validString: 0,
      validArray: 0,
      malformed: 0,
    }])),
  });
});

test("absent, undefined, null and empty strings are ignored", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({}),
    campaign({ Categories: undefined, Category: null, Vertical: "" }),
  ]);
  assert.equal(result.campaignsWithoutTaxonomy, 2);
  assert.equal(result.invalidTaxonomyCampaigns, 0);
  assert.deepEqual(
    result.fieldCoverage,
    summarizeStoreCategoryTaxonomyV2([]).fieldCoverage,
  );
});

test("blank strings and empty arrays are valid shapes without labels", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: " \t\n ", Category: [], Vertical: ["", "  "] }),
  ]);
  assert.equal(result.campaignsWithoutTaxonomy, 1);
  assert.equal(result.invalidTaxonomyCampaigns, 0);
  assert.deepEqual(result.labels, []);
  assert.deepEqual(result.fieldCoverage.Categories, {
    present: 1,
    validString: 1,
    validArray: 0,
    malformed: 0,
  });
  assert.deepEqual(result.fieldCoverage.Category, {
    present: 1,
    validString: 0,
    validArray: 1,
    malformed: 0,
  });
});

test("equivalent labels deduplicate across fields and count once per Campaign", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({
      Categories: ["fashion", " Fashion ", "FASHION", "fashion"],
      Category: "Fashion",
      Vertical: "fashion",
      Verticals: ["FASHION"],
    }),
    campaign({ Categories: ["fashion", "Fashion"] }),
  ]);
  assert.equal(result.campaignsWithUsableTaxonomy, 2);
  assert.equal(result.distinctLabels, 1);
  assert.deepEqual(result.labels, [
    { label: "FASHION", key: "fashion", campaignCount: 2 },
  ]);
});

test("keys collapse repeated whitespace while display labels retain P1C-A1 text", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: "  Home\t &\n  Garden  " }),
    campaign({ Categories: "Home & Garden" }),
  ]);
  assert.deepEqual(result.labels, [
    { label: "Home\t &\n  Garden", key: "home & garden", campaignCount: 2 },
  ]);
});

test("punctuation and separators stay significant without comma splitting", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({
      Categories: ["Home, Garden", "Home/Garden", "Home-Garden", "Home Garden"],
    }),
  ]);
  assert.deepEqual(result.labels.map(({ key }) => key), [
    "home garden",
    "home, garden",
    "home-garden",
    "home/garden",
  ]);
  assert.equal(
    result.labels.some(({ key }) => key === "home" || key === "garden"),
    false,
  );
});

test("Unicode letters and numbers are usable without transliteration or fuzzy matching", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: ["Été", "été", "服装", "१२३", "Cafe", "Café"] }),
  ]);
  assert.deepEqual(result.labels.map(({ key }) => key), [
    "cafe",
    "café",
    "été",
    "१२३",
    "服装",
  ]);
  assert.equal(result.invalidTaxonomyCampaigns, 0);
});

test("mixed arrays invalidate the whole Campaign, including other valid fields", () => {
  for (
    const malformed of [["Fashion", 42], ["Fashion", null], ["Fashion", [
      "Home",
    ]]]
  ) {
    const result = summarizeStoreCategoryTaxonomyV2([
      campaign({ Categories: malformed, Category: "Home" }),
      campaign({ Categories: "Fashion" }),
    ]);
    assert.equal(result.campaignsEvaluated, 2);
    assert.equal(result.invalidTaxonomyCampaigns, 1);
    assert.equal(result.campaignsWithUsableTaxonomy, 1);
    assert.equal(result.campaignsWithoutTaxonomy, 0);
    assert.deepEqual(result.labels, [
      { label: "Fashion", key: "fashion", campaignCount: 1 },
    ]);
    assert.deepEqual(result.fieldCoverage.Categories, {
      present: 2,
      validString: 1,
      validArray: 0,
      malformed: 1,
    });
    assert.deepEqual(result.fieldCoverage.Category, {
      present: 1,
      validString: 1,
      validArray: 0,
      malformed: 0,
    });
  }
});

test("object, number and boolean taxonomy fields are malformed for every field", () => {
  for (const field of FIELDS) {
    for (const malformed of [{ label: "Fashion" }, 1, true, false]) {
      const result = summarizeStoreCategoryTaxonomyV2([
        campaign({ [field]: malformed }),
      ]);
      assert.equal(result.invalidTaxonomyCampaigns, 1);
      assert.deepEqual(result.labels, []);
      assert.deepEqual(result.fieldCoverage[field], {
        present: 1,
        validString: 0,
        validArray: 0,
        malformed: 1,
      });
    }
  }
});

test("one Campaign with several malformed fields contributes one invalid count", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({
      Categories: {},
      Category: 12,
      Vertical: false,
      Verticals: ["Good", {}],
    }),
  ]);
  assert.equal(result.invalidTaxonomyCampaigns, 1);
  for (const field of FIELDS) {
    assert.equal(result.fieldCoverage[field].malformed, 1);
  }
});

test("array length 32 is accepted and length 33 invalidates all evidence", () => {
  const labels = Array.from({ length: 32 }, (_, index) => `Category ${index}`);
  const valid = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: labels }),
  ]);
  assert.equal(valid.distinctLabels, 32);
  const invalid = summarizeStoreCategoryTaxonomyV2([
    campaign({
      Categories: [...labels, "Overflow"],
      Category: "Valid elsewhere",
    }),
  ]);
  assert.equal(invalid.invalidTaxonomyCampaigns, 1);
  assert.deepEqual(invalid.labels, []);
});

test("original length is bounded at 160 before trimming, in strings and arrays", () => {
  const valid = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: "A".repeat(160) }),
  ]);
  assert.equal(valid.campaignsWithUsableTaxonomy, 1);
  for (
    const value of ["A".repeat(161), `${" ".repeat(160)}A`, ["A".repeat(161)]]
  ) {
    const invalid = summarizeStoreCategoryTaxonomyV2([
      campaign({ Categories: value, Category: "Home" }),
    ]);
    assert.equal(invalid.invalidTaxonomyCampaigns, 1);
    assert.deepEqual(invalid.labels, []);
  }
});

test("labels without a Unicode letter or number invalidate the Campaign", () => {
  for (const value of ["---", "&/", "💰", ".,!"]) {
    const result = summarizeStoreCategoryTaxonomyV2([
      campaign({ Categories: value }),
    ]);
    assert.equal(result.invalidTaxonomyCampaigns, 1);
    assert.deepEqual(result.labels, []);
  }
});

test("P1C-A1 disallowed control, bidi and invisible characters are rejected", () => {
  const codes = [
    ...Array.from({ length: 9 }, (_, index) => index),
    ...Array.from({ length: 18 }, (_, index) => index + 14),
    ...Array.from({ length: 33 }, (_, index) => index + 127),
    ...Array.from({ length: 5 }, (_, index) => index + 0x200b),
    ...Array.from({ length: 5 }, (_, index) => index + 0x202a),
    ...Array.from({ length: 16 }, (_, index) => index + 0x2060),
  ];
  for (const code of codes) {
    const result = summarizeStoreCategoryTaxonomyV2([
      campaign({ Categories: `Fa${String.fromCharCode(code)}shion` }),
    ]);
    assert.equal(result.invalidTaxonomyCampaigns, 1, `code ${code}`);
    assert.deepEqual(result.labels, []);
  }
});

test("sort and code-unit representative selection are independent of record and array order", () => {
  const inputs = [
    { Categories: ["zulu", "alpha", "ALPHA", "Alpha"] },
    { Category: "aLPHA", Verticals: ["Beta", "Zulu"] },
  ];
  const forward = summarizeStoreCategoryTaxonomyV2(inputs.map(campaign));
  const reverse = summarizeStoreCategoryTaxonomyV2(
    inputs.toReversed().map((raw) =>
      campaign({
        ...raw,
        ...(raw.Categories ? { Categories: raw.Categories.toReversed() } : {}),
      })
    ),
  );
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.labels, [
    { label: "ALPHA", key: "alpha", campaignCount: 2 },
    { label: "Beta", key: "beta", campaignCount: 1 },
    { label: "Zulu", key: "zulu", campaignCount: 2 },
  ]);
});

test("exactly 100 labels are retained without truncation; 101 retain the full distinct count", () => {
  const campaigns = Array.from(
    { length: 101 },
    (_, index) =>
      campaign({ Categories: `Label ${String(index).padStart(3, "0")}` }),
  );
  const exact = summarizeStoreCategoryTaxonomyV2(campaigns.slice(0, 100));
  assert.equal(exact.labels.length, 100);
  assert.equal(exact.distinctLabels, 100);
  assert.equal(exact.labelsTruncated, false);
  const overflow = summarizeStoreCategoryTaxonomyV2(campaigns.toReversed());
  assert.equal(overflow.campaignsEvaluated, 101);
  assert.equal(overflow.distinctLabels, 101);
  assert.equal(overflow.labels.length, 100);
  assert.equal(overflow.labelsTruncated, true);
  assert.deepEqual(overflow.labels, exact.labels);
});

test("Campaign classifications partition the evaluated records", () => {
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign({ Categories: "Fashion" }),
    campaign({ Category: "Home" }),
    campaign({}),
    campaign({ Vertical: [] }),
    campaign({ Verticals: {} }),
  ]);
  assert.equal(result.campaignsEvaluated, 5);
  assert.equal(result.campaignsWithUsableTaxonomy, 2);
  assert.equal(result.campaignsWithoutTaxonomy, 2);
  assert.equal(result.invalidTaxonomyCampaigns, 1);
});

test("only exact own top-level taxonomy fields are inspected without inference", () => {
  const raw = {
    categories: "Wrong case",
    Details: { Categories: ["Nested"] },
    CampaignName: "Fashion",
    AdvertiserId: "Home",
    DestinationUrl: "https://garden.example",
    raw: { Categories: "Nested raw" },
  };
  Object.defineProperty(raw, "Credentials", {
    get() {
      throw new Error("must not traverse arbitrary fields");
    },
  });
  const inherited = Object.create({ Categories: "Inherited" }) as Record<
    string,
    unknown
  >;
  const result = summarizeStoreCategoryTaxonomyV2([
    campaign(raw),
    campaign(inherited),
  ]);
  assert.equal(result.campaignsWithoutTaxonomy, 2);
  assert.deepEqual(result.labels, []);
});

test("raw records, identities, URLs, credentials and arbitrary secret fields never escape", () => {
  const raw = {
    CampaignId: "campaign-sensitive",
    AdvertiserId: "advertiser-sensitive",
    CampaignName: "Merchant Sensitive",
    Categories: "Fashion",
    DestinationUrl: "https://destination.example/private",
    Credentials: {
      accountSid: "account-sensitive",
      authToken: "token-sensitive",
    },
    Secret: "secret-sensitive",
    Sql: "database-sensitive",
  };
  const record = campaign(raw);
  Object.freeze(raw);
  Object.freeze(record);
  const result = summarizeStoreCategoryTaxonomyV2([record]);
  assert.deepEqual(result.labels, [{
    label: "Fashion",
    key: "fashion",
    campaignCount: 1,
  }]);
  const serialized = JSON.stringify(result);
  for (
    const forbidden of [
      "raw",
      "CampaignId",
      "AdvertiserId",
      "campaign-sensitive",
      "advertiser-sensitive",
      "Merchant Sensitive",
      "http",
      "Credentials",
      "account-sensitive",
      "token-sensitive",
      "secret-sensitive",
      "database-sensitive",
      "provenance",
    ]
  ) assert.equal(serialized.includes(forbidden), false, forbidden);
});
