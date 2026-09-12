import assert from "node:assert/strict";
import test from "node:test";
import {
  couponAnchorSlugV2,
  couponCanonicalV2,
  couponSeoDescriptionV2,
  couponSeoTitleV2,
  evaluationYearV2,
  formatDiscountV2,
  formatStructuredTermsV2,
  generateTermsTextV2,
  isExplicitEvaluationTimestampV2,
  normalizeSiteOriginV2,
  ogDescriptionV2,
  ogTitleV2,
  projectEffectiveDatesV2,
  projectUtcDateV2,
  resolveOfferStatusV2,
  storeCanonicalV2,
  storeSeoDescriptionV2,
  storeSeoTitleV2,
  storeSlugCandidateV2,
  structuredTermsTextV2,
} from "../index.ts";

const EVALUATION_TIMESTAMP = "2026-06-15T12:00:00.000Z";

test("SEO and slug helpers preserve established GetYourCodes output", () => {
  const store = "Acme & Co.";
  const coupon = "Save 20% – Summer";

  assert.equal(storeSlugCandidateV2(store), "acme-and-co");
  assert.equal(couponAnchorSlugV2(coupon), "save-20-summer");
  assert.equal(
    storeSeoTitleV2(store, EVALUATION_TIMESTAMP),
    "Acme & Co. Coupons, Promo Codes & Deals 2026 | GetYourCodes",
  );
  assert.equal(
    storeSeoDescriptionV2(store),
    "Save more with verified Acme & Co. coupons, promo codes and exclusive deals updated regularly on GetYourCodes.",
  );
  assert.equal(
    couponSeoTitleV2(coupon, store, EVALUATION_TIMESTAMP),
    "Save 20% – Summer | Acme & Co. Coupons 2026 | GetYourCodes",
  );
  assert.equal(
    couponSeoDescriptionV2(coupon, store),
    "Save with Acme & Co. using this verified offer: Save 20% – Summer. Updated regularly on GetYourCodes.",
  );
  assert.equal(
    ogTitleV2(couponSeoTitleV2(coupon, store, EVALUATION_TIMESTAMP)),
    "Save 20% – Summer | Acme & Co. Coupons 2026 | GetYourCodes",
  );
  assert.equal(
    ogDescriptionV2(couponSeoDescriptionV2(coupon, store)),
    "Save with Acme & Co. using this verified offer: Save 20% – Summer. Updated regularly on GetYourCodes.",
  );
});

test("store and coupon slugs remain deliberately distinct", () => {
  assert.equal(storeSlugCandidateV2("H&M"), "h-and-m");
  assert.equal(couponAnchorSlugV2("H&M"), "hm");
  assert.equal(storeSlugCandidateV2("Crème_Brûlée"), "creme-brulee");
  assert.equal(couponAnchorSlugV2("Crème_Brûlée"), "creme-brulee");
  assert.equal(storeSlugCandidateV2("***"), "item");
  assert.equal(couponAnchorSlugV2("***"), "");
  assert.equal(storeSlugCandidateV2("a".repeat(100)).length, 80);
  assert.equal(couponAnchorSlugV2("a".repeat(100)).length, 80);
});

test("evaluation timestamp is explicit and its UTC year is deterministic", () => {
  assert.equal(evaluationYearV2("2026-12-31T23:59:59.999Z"), 2026);
  assert.equal(evaluationYearV2("2027-01-01T00:00:00.000Z"), 2027);
  assert.equal(
    evaluationYearV2("2027-01-01T00:30:00+02:00"),
    2026,
  );
  for (const value of ["2026-01-01", "2026-02-30T00:00:00Z", "not-a-date"]) {
    assert.equal(isExplicitEvaluationTimestampV2(value), false);
    assert.throws(() => evaluationYearV2(value), /evaluationTimestamp/);
  }
});

test("SITE_URL normalization and canonical formulas are exact", () => {
  assert.equal(
    normalizeSiteOriginV2(
      " https://getyourcodes.com/admin/path/?x=1#fragment ",
    ),
    "https://getyourcodes.com",
  );
  assert.equal(
    normalizeSiteOriginV2("https://getyourcodes.com:443/"),
    "https://getyourcodes.com",
  );
  for (const value of [null, "", "relative/path", "ftp://getyourcodes.com/"]) {
    assert.equal(normalizeSiteOriginV2(value), null);
  }
  assert.equal(
    storeCanonicalV2("https://getyourcodes.com/path/", "acme-and-co"),
    "https://getyourcodes.com/acme-and-co-coupons",
  );
  assert.equal(
    couponCanonicalV2(
      "https://getyourcodes.com/path/",
      "acme-and-co",
      "Save 20% – Summer",
    ),
    "https://getyourcodes.com/acme-and-co-coupons#save-20-summer",
  );
  assert.throws(
    () => storeCanonicalV2("javascript:alert(1)", "store"),
    /siteOrigin/,
  );
});

test("UTC date projection is strict and honors represented offsets", () => {
  assert.deepEqual(projectUtcDateV2(null), { ok: true, value: null });
  assert.deepEqual(projectUtcDateV2("2024-02-29"), {
    ok: true,
    value: "2024-02-29",
  });
  assert.deepEqual(projectUtcDateV2("2026-01-01T00:30:00+02:00"), {
    ok: true,
    value: "2025-12-31",
  });
  assert.deepEqual(projectUtcDateV2("2026-12-31T23:30:00-02:00"), {
    ok: true,
    value: "2027-01-01",
  });
  for (
    const value of [
      "2023-02-29",
      "2026-02-30T00:00:00Z",
      "2026-01-01T00:00:00",
      " 2026-01-01 ",
      "not-a-date",
    ]
  ) {
    assert.deepEqual(projectUtcDateV2(value), { ok: false, value: null });
  }
});

test("provider Deal dates win and invalid preferred values never fall through", () => {
  assert.deepEqual(
    projectEffectiveDatesV2({
      dealStartDate: "2026-03-01T00:00:00Z",
      startDate: "2026-02-01T00:00:00Z",
      dealEndDate: "2026-11-30T23:59:59Z",
      endDate: "2026-12-31T23:59:59Z",
    }),
    {
      ok: true,
      startDate: "2026-03-01",
      expiryDate: "2026-11-30",
      startSource: "deal_start_date",
      endSource: "deal_end_date",
    },
  );
  assert.deepEqual(
    projectEffectiveDatesV2({
      dealStartDate: null,
      startDate: "2026-02-01",
      dealEndDate: null,
      endDate: "2026-12-31",
    }),
    {
      ok: true,
      startDate: "2026-02-01",
      expiryDate: "2026-12-31",
      startSource: "start_date",
      endSource: "end_date",
    },
  );
  assert.deepEqual(
    projectEffectiveDatesV2({
      dealStartDate: "invalid",
      startDate: "2026-02-01",
      dealEndDate: null,
      endDate: null,
    }),
    { ok: false, reason: "invalid_start_date" },
  );
  assert.deepEqual(
    projectEffectiveDatesV2({
      dealStartDate: null,
      startDate: "2026-12-31",
      dealEndDate: null,
      endDate: "2026-01-01",
    }),
    { ok: false, reason: "invalid_date_range" },
  );
});

test("explicit status helper preserves established lifecycle decisions", () => {
  const cases = [
    { input: {}, expected: "active" },
    { input: { valid: false }, expected: "draft" },
    { input: { publiclyAvailable: false }, expected: "draft" },
    { input: { endDate: "2026-06-14" }, expected: "expired" },
    { input: { endDate: "2026-06-15" }, expected: "active" },
    { input: { startDate: "2026-06-16" }, expected: "draft" },
    { input: { startDate: "2026-06-15" }, expected: "active" },
    { input: { providerStatus: "inactive" }, expected: "draft" },
    { input: { providerStatus: "pending" }, expected: "draft" },
    { input: { providerStatus: "expired" }, expected: "active" },
  ] as const;

  for (const fixture of cases) {
    assert.equal(
      resolveOfferStatusV2({
        ...fixture.input,
        evaluationTimestamp: EVALUATION_TIMESTAMP,
      }),
      fixture.expected,
    );
  }
  assert.equal(
    resolveOfferStatusV2({
      startDate: "invalid",
      evaluationTimestamp: EVALUATION_TIMESTAMP,
    }),
    "draft",
  );
});

test("terms and discount presentation retain established byte-for-byte output", () => {
  const structured = {
    minimumPurchase: 50,
    maximumSavings: 20,
    purchaseLimit: 1,
    scope: "Sitewide",
    currency: "USD",
    text: null,
  };
  const expected =
    "Minimum purchase of $50.00 required. Maximum savings of $20.00. Limited to 1 per customer. Applies to: Sitewide. Offer valid until December 31, 2026. Terms are set by the merchant and may change without notice.";

  assert.deepEqual(formatStructuredTermsV2(structured), [
    { label: "Minimum purchase", value: "$50.00" },
    { label: "Maximum savings", value: "$20.00" },
    { label: "Purchase limit", value: "1 per customer" },
    { label: "Deal scope", value: "Sitewide" },
  ]);
  assert.equal(generateTermsTextV2(structured, "2026-12-31"), expected);

  assert.equal(
    generateTermsTextV2(
      { ...structured, text: "  Provider terms.  " },
      "2026-12-31",
    ),
    "Provider terms.",
  );
  assert.equal(
    structuredTermsTextV2({ text: "  Provider terms.  " }),
    "Provider terms.",
  );
  assert.equal(generateTermsTextV2(null, null), null);

  assert.equal(formatDiscountV2("percentage", 20), "20% off");
  assert.equal(formatDiscountV2("fixed", 15, "USD"), "$15.00 off");
  assert.equal(formatDiscountV2("free_shipping", null), "Free shipping");
  assert.equal(formatDiscountV2("bogo", null), "BOGO");
});
