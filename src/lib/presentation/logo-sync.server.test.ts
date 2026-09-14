import assert from "node:assert/strict";
import test from "node:test";

import { deriveImpactCampaignLogoSource } from "./logo-sync.server";

test("derives exact Impact Campaign logo endpoint", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "campaign",
      "15781",
      "IR123456",
      "https://api.impact.com/",
    ),
    "https://api.impact.com/Mediapartners/IR123456/Campaigns/15781/Logo",
  );
});

test("normalizes surrounding whitespace", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      " impact ",
      " campaign ",
      " 15781 ",
      " IR123456 ",
      "https://api.impact.com/",
    ),
    "https://api.impact.com/Mediapartners/IR123456/Campaigns/15781/Logo",
  );
});

test("accepts numeric provider entity identity", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "campaign",
      15781,
      "IR123456",
      "https://api.impact.com/",
    ),
    "https://api.impact.com/Mediapartners/IR123456/Campaigns/15781/Logo",
  );
});

test("does not derive URLs for non-Impact providers", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      "other-provider",
      "campaign",
      "15781",
      "IR123456",
      "https://api.impact.com/",
    ),
    null,
  );
});

test("does not derive URLs for non-Campaign Impact identities", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "legacy",
      "15781",
      "IR123456",
      "https://api.impact.com/",
    ),
    null,
  );
});

test("fails closed when required exact identity material is missing", () => {
  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      null,
      "15781",
      "IR123456",
      "https://api.impact.com/",
    ),
    null,
  );

  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "campaign",
      null,
      "IR123456",
      "https://api.impact.com/",
    ),
    null,
  );

  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "campaign",
      "15781",
      null,
      "https://api.impact.com/",
    ),
    null,
  );

  assert.equal(
    deriveImpactCampaignLogoSource(
      "impact",
      "campaign",
      "15781",
      "IR123456",
      null,
    ),
    null,
  );
});
