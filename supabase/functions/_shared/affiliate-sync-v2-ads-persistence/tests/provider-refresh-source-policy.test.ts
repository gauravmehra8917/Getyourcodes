import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdsIneligibilityReasonV2,
  QualifiedImpactAdOfferV2,
} from "../../affiliate-sync-v2-ads/index.ts";

import {
  classifyExistingAdRefreshSourceV2,
} from "../provider-refresh-source-policy.ts";

const STORE_ID =
  "11111111-1111-4111-8111-111111111111";

function qualified(input: {
  reason?: AdsIneligibilityReasonV2 | null;
  eligible?: boolean;
  codeClass?: "code_bearing" | "no_code";
  association?:
    | "resolved"
    | "missing_campaign"
    | "unknown_campaign"
    | "advertiser_conflict";
} = {}): QualifiedImpactAdOfferV2 {
  const reason = input.reason ?? null;
  const codeClass = input.codeClass ?? "code_bearing";
  const associationKind = input.association ?? "resolved";

  const association = associationKind === "resolved"
    ? {
      providerStoreKey: {
        provider: "impact" as const,
        namespace: "campaign" as const,
        id: "Campaign-A",
      },
      matchMethod: "campaign_id" as const,
      unresolvedReason: null,
    }
    : {
      providerStoreKey: null,
      matchMethod: "unmatched" as const,
      unresolvedReason:
        associationKind === "advertiser_conflict"
          ? "campaign_advertiser_conflict" as const
          : associationKind === "missing_campaign"
          ? "missing_campaign_id" as const
          : "unknown_campaign_id" as const,
    };

  const common = {
    providerOfferKey: {
      provider: "impact" as const,
      namespace: "ad" as const,
      id: "Ad-A",
    },
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    dealId: "Deal-A",
    dealState: "ACTIVE",
    title: "Provider Ad",
    description: "Provider description",
    trackingUrl: "https://track.example/ad",
    landingPageUrl: "https://destination.example/ad",
    providerDealStartDate: "2026-05-01T00:00:00Z",
    providerDealEndDate: "2026-12-31T23:59:59Z",
    providerStartDate: "2026-01-01",
    providerEndDate: "2027-01-31",
    startDate: "2026-05-01T00:00:00Z",
    endDate: "2026-12-31T23:59:59Z",
    dateFieldsValid: true,
    discountType: "percentage" as const,
    discountValue: 20,
    structuredTerms: null,
    association,
    provenance: {
      fetchSequence: 1,
      recordIndex: 0,
      providerPage: 1,
      providerPageSize: 100,
    },
    snapshotStatus:
      associationKind === "resolved"
        ? "existing" as const
        : "unresolved" as const,
    matchedStoreId:
      associationKind === "resolved"
        ? STORE_ID
        : null,
  };

  const offer = codeClass === "code_bearing"
    ? {
      ...common,
      codeClass: "code_bearing" as const,
      validatedCouponCode: "SAVE20",
    }
    : {
      ...common,
      codeClass: "no_code" as const,
      validatedCouponCode: null,
    };

  return {
    offer,
    eligible: input.eligible ?? reason === null,
    reason,
  };
}

test("absent provider Ad means no refresh action", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(null),
    {
      action: "no_action",
      lifecycleReason: null,
      blockReason: null,
      reason: "absent_from_feed",
    },
  );
});

test("active valid existing Ad source is refreshable", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified(),
    ),
    {
      action: "refreshable",
      lifecycleReason: null,
      blockReason: null,
    },
  );
});

test("future and expired existing Ad source remain refreshable", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "not_started",
        eligible: false,
      }),
    ),
    {
      action: "refreshable",
      lifecycleReason: "not_started",
      blockReason: null,
    },
  );

  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "expired",
        eligible: false,
      }),
    ),
    {
      action: "refreshable",
      lifecycleReason: "expired",
      blockReason: null,
    },
  );
});

test("missing provider coupon code blocks refresh", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        codeClass: "no_code",
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "missing_coupon_code",
    },
  );
});

test("invalid source dates block refresh without destructive fallback", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "invalid_date",
        eligible: false,
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "invalid_date",
    },
  );

  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "invalid_date_range",
        eligible: false,
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "invalid_date_range",
    },
  );
});

test("missing provider title blocks refresh", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "missing_title",
        eligible: false,
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "missing_title",
    },
  );
});

test("unresolved Campaign blocks refresh and advertiser conflict stays distinct", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "unresolved_store",
        eligible: false,
        association: "unknown_campaign",
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "unresolved_store",
    },
  );

  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "unresolved_store",
        eligible: false,
        association: "advertiser_conflict",
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "identity_conflict",
    },
  );
});

test("inconsistent qualification evidence fails closed", () => {
  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: null,
        eligible: false,
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "qualification_inconsistent",
    },
  );

  assert.deepEqual(
    classifyExistingAdRefreshSourceV2(
      qualified({
        reason: "expired",
        eligible: true,
      }),
    ),
    {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "qualification_inconsistent",
    },
  );
});
