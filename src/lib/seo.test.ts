import assert from "node:assert/strict";
import test from "node:test";
import { abs, clip, selfCanonical, seoRobots, seoText } from "./seo.ts";

test("saved SEO text is used only when nonempty", () => {
  assert.equal(seoText(" Custom title ", "Generated title"), "Custom title");
  for (const value of [undefined, null, "", " \n\t "]) {
    assert.equal(seoText(value, "Generated title"), "Generated title");
  }
  assert.equal(clip("  Generated\n description  "), "Generated description");
});

test("robots accepts exactly the four supported directives", () => {
  for (const value of ["index,follow", "noindex,follow", "index,nofollow", "noindex,nofollow"]) {
    assert.equal(seoRobots(value), value);
    assert.equal(seoRobots(` ${value} `), value);
  }
  for (const value of [
    undefined,
    null,
    "",
    "noindex",
    "INDEX,FOLLOW",
    "noindex,follow,nosnippet",
    "index, follow",
  ]) {
    assert.equal(seoRobots(value), "index,follow");
  }
});

for (const path of ["/merchant-coupons", "/beauty-offers"]) {
  test(`canonical accepts only the exact self URL for ${path}`, () => {
    const expected = abs(path);
    for (const configured of [
      expected,
      `${expected}/`,
      path,
      `${path}/`,
      ` https://GETYOURCODES.com${path} `,
    ]) {
      assert.equal(selfCanonical(configured, path), expected);
    }
  });

  test(`canonical rejects stale, external and malformed URLs for ${path}`, () => {
    const expected = abs(path);
    for (const configured of [
      undefined,
      null,
      "",
      " ",
      "https://[invalid",
      "https://evil.example/merchant-coupons",
      `//evil.example${path}`,
      `http://getyourcodes.com${path}`,
      `https://www.getyourcodes.com${path}`,
      `https://getyourcodes.com.evil.example${path}`,
      `https://getyourcodes.com:444${path}`,
      `https://user:secret@getyourcodes.com${path}`,
      `${expected}?other=1`,
      `${expected}#other`,
      "https://getyourcodes.com/merchant",
      "https://getyourcodes.com/category/beauty",
      "https://getyourcodes.com/different-coupons",
      "javascript:alert(1)",
    ])
      assert.equal(selfCanonical(configured, path), expected);
  });
}
