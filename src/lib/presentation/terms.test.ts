import assert from "node:assert/strict";
import test from "node:test";
import {
  friendlyScope,
  formatStructuredTerms,
  humanizeProviderTerms,
  structuredTermsText,
  hasDiscountTypeConflict,
} from "./terms.ts";

test("known scope values have customer-friendly copy", () => {
  assert.equal(friendlyScope("CATEGORY"), "Selected product categories (not specified)");
  assert.equal(friendlyScope("PRODUCT"), "Selected products (check merchant eligibility)");
  assert.equal(friendlyScope("ENTIRE_STORE"), "Storewide offer");
  assert.equal(friendlyScope("unexpected"), null);
  assert.equal(friendlyScope({}), null);
  assert.deepEqual(formatStructuredTerms({ scope: "CATEGORY" }), [
    { label: "Offer eligibility", value: "Selected product categories (not specified)" },
  ]);
  assert.deepEqual(formatStructuredTerms({ scope: "UNKNOWN" }), []);
});

test("saved and provider-supplied terms never reveal raw scope enum labels", () => {
  assert.equal(
    humanizeProviderTerms("Applies to: CATEGORY. Terms are set by the merchant."),
    "Offer eligibility: Selected product categories (not specified). Terms are set by the merchant.",
  );
  assert.equal(
    structuredTermsText({ text: "Applies to: PRODUCT. Ask the merchant." }),
    "Offer eligibility: Selected products (check merchant eligibility). Ask the merchant.",
  );
  assert.equal(humanizeProviderTerms("Offer applies at checkout."), "Offer applies at checkout.");
});

test("Loragal SS40: percentage claim conflicts with stored fixed USD amount", () => {
  assert.equal(
    hasDiscountTypeConflict(
      "2026 Spring Deal 40% OFF Code: SS40",
      "ALL 40% OFF with Code: SS40",
      "fixed",
      40,
    ),
    true,
  );
});
test("consistent and ambiguous input does not create false conflict", () => {
  assert.equal(hasDiscountTypeConflict("$40 off with code", null, "fixed", 40), false);
  assert.equal(hasDiscountTypeConflict("40% off", null, "percentage", 40), false);
  assert.equal(hasDiscountTypeConflict("Save $40 off", null, "percentage", 40), true);
  assert.equal(
    hasDiscountTypeConflict("40% discount on $200 minimum order", null, "percentage", 40),
    false,
  );
  assert.equal(hasDiscountTypeConflict("Model 40% polyester", null, "fixed", 40), false);
  assert.equal(hasDiscountTypeConflict(null, null, null, null), false);
});
