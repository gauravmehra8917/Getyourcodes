import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeImpactDiagnosticUrl,
  validateImpactContinuation,
  type ImpactContinuationPolicy,
} from "../impact-url-safety.ts";

const policy: ImpactContinuationPolicy = {
  approvedBaseUrl: "https://api.impact.com",
  allowedOrigins: ["https://api.impact.com", "https://api-us.impact.com"],
  accountSidPathSegments: ["2303074"],
};

test("accepts an allowed same-origin absolute continuation", () => {
  const result = validateImpactContinuation(
    "https://api.impact.com/Mediapartners/2303074/Promotions?Page=2&Sort=UpdatedDate",
    policy,
  );
  assert.deepEqual(result, {
    ok: true,
    url: "https://api.impact.com/Mediapartners/2303074/Promotions?Page=2&Sort=UpdatedDate",
    sanitizedUrl: "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=2&Sort=UpdatedDate",
    credentialDisposition: "attach_if_same_origin",
    originRelation: "same_origin",
  });
});

test("resolves an allowed relative continuation against the approved base", () => {
  const result = validateImpactContinuation("/Mediapartners/2303074/Promotions?Page=2&PageSize=100", policy);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.url, "https://api.impact.com/Mediapartners/2303074/Promotions?Page=2&PageSize=100");
  assert.equal(result.credentialDisposition, "attach_if_same_origin");
});

test("allows an approved cross-origin continuation only with credential omission", () => {
  const result = validateImpactContinuation("https://api-us.impact.com/Promotions?Page=2", policy);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.originRelation, "allowed_cross_origin");
  assert.equal(result.credentialDisposition, "omit");
});

test("rejects unsafe and unsupported continuations", () => {
  const cases = [
    ["http://api.impact.com/Promotions", "unsupported_scheme"],
    ["http://[invalid", "invalid_url"],
    ["https://user:pass@api.impact.com/Promotions", "userinfo_not_allowed"],
    ["https://example.test/Promotions", "origin_not_allowed"],
  ] as const;
  for (const [url, detail] of cases) {
    const result = validateImpactContinuation(url, policy);
    assert.equal(result.ok, false, url);
    if (!result.ok) assert.equal(result.detail, detail, url);
  }
});

test("sanitizes sensitive diagnostic components while preserving safe structure", () => {
  const sanitized = sanitizeImpactDiagnosticUrl(
    "https://user:pass@api.impact.com/Mediapartners/2303074/Promotions?Page=2&Sort=UpdatedDate&token=secret&cursor=opaque#fragment",
    { accountSidPathSegments: ["2303074"] },
  );
  assert.equal(
    sanitized,
    "https://api.impact.com/Mediapartners/%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23074/Promotions?Page=2&Sort=UpdatedDate&token=%5BREDACTED%5D&cursor=%5BREDACTED%5D",
  );
  assert.equal(sanitized?.includes("secret"), false);
  assert.equal(sanitized?.includes("opaque"), false);
  assert.equal(sanitized?.includes("fragment"), false);
});
