import assert from "node:assert/strict";
import test from "node:test";
import {
  PersistencePlannerV2,
  validatePersistencePlanV2,
} from "../PersistencePlannerV2.ts";
import {
  PERSISTENCE_CONTRACT_VERSION_V2,
  type KnownOfferKindV2,
  type KnownStoreSlugV2,
  type PersistencePlanContextV2,
} from "../persistence-models.ts";
import {
  PreviewPlanner,
  type AffiliateSyncPreviewInputV2,
} from "../PreviewPlanner.ts";
import type { ImpactStreamFetchDiagnosticsV2 } from "../diagnostics.ts";
import type {
  AffiliateSyncPreviewV2,
  ExistingCatalogSnapshotV2,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
} from "../models.ts";

const EVALUATION_TIMESTAMP = "2026-06-01T00:00:00Z";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";

interface StoreSpec {
  campaignId: string;
  name?: string | null;
  advertiserId?: string;
  destinationUrl?: string | null;
  trackingUrl?: string | null;
}

interface OfferSpec {
  promotionId: string;
  campaignId: string | null;
  kind: "coupon" | "deal";
  title?: string | null;
  code?: string;
  description?: string | null;
  trackingUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface PreviewSpec {
  stores?: StoreSpec[];
  offers?: OfferSpec[];
  snapshot?: ExistingCatalogSnapshotV2;
  maxCouponsPerStore?: number;
  maxDealsPerStore?: number;
  minimumSelectedCoupons?: number;
  minimumSelectedDeals?: number;
  minimumTotalSelectedOffers?: number;
}

function provenance(
  stream: "promotions" | "campaigns",
  recordIndex: number,
) {
  return {
    stream,
    fetchSequence: 1,
    recordIndex,
    sanitizedRequestUrl: `https://api.example.invalid/${stream}?page=1`,
    sanitizedSourceContinuationUrl: null,
    providerPage: "1",
    providerPageSize: "100",
  };
}

function streamDiagnostics(
  stream: "promotions" | "campaigns",
  acceptedRecordCount: number,
): ImpactStreamFetchDiagnosticsV2 {
  const absentCarrier = {
    missing: acceptedRecordCount,
    null: 0,
    validOpaqueScalar: 0,
    invalidShape: 0,
    distinctValidOpaqueValues: 0,
  };
  return {
    stream,
    pagesFetched: acceptedRecordCount === 0 ? 0 : 1,
    rawRecordCount: acceptedRecordCount,
    acceptedRecordCount,
    quarantinedRecordCount: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_promotion_id: 0,
      missing_campaign_id: 0,
    },
    ...(stream === "promotions"
      ? {
        promotionIdShapeCounts: {
          missing: acceptedRecordCount,
          null: 0,
          nonempty_string: 0,
          empty_or_whitespace_string: 0,
          number: 0,
          array: 0,
          object: 0,
          boolean: 0,
          other: 0,
        },
        promotionIdentifierCarrierDiagnostics: {
          promotionFileId: { ...absentCarrier },
          uri: {
            missing: acceptedRecordCount,
            null: 0,
            nonemptyString: 0,
            invalidShape: 0,
            distinctNonemptyValues: 0,
            promotionRetrievePathShape: 0,
            distinctPromotionRetrieveTerminalSegments: 0,
          },
          promotionIdSingular: {
            missing: 0,
            null: 0,
            validOpaqueScalar: acceptedRecordCount,
            invalidShape: 0,
            distinctValidOpaqueValues: acceptedRecordCount,
          },
          id: { ...absentCarrier },
        },
        promotionIdentityEquivalenceDiagnostics: {
          structurallyValidPromotionRecords: acceptedRecordCount,
          promotionIdAndRetrieveUriPresent: 0,
          exactPromotionIdEqualsUriTerminal: 0,
          promotionIdDiffersFromUriTerminal: 0,
          promotionIdPresentWithoutRetrieveUri: acceptedRecordCount,
          retrieveUriPresentWithoutPromotionId: 0,
          neitherPresent: 0,
          distinctPromotionIds: acceptedRecordCount,
          distinctRetrieveUriTerminalSegments: 0,
          promotionIdsMappingToMultipleUriTerminals: 0,
          uriTerminalsMappingToMultiplePromotionIds: 0,
          duplicatePromotionIdRecords: 0,
        },
      }
      : {}),
    stopReason: "completed",
    parseFailureReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  };
}

function campaign(spec: StoreSpec, recordIndex: number): RawImpactCampaignV2 {
  const advertiserId = spec.advertiserId ?? `advertiser-${spec.campaignId}`;
  return {
    campaignId: spec.campaignId,
    advertiserId,
    campaignName: spec.name === undefined ? `Store ${spec.campaignId}` : spec.name,
    destinationUrl: spec.destinationUrl === undefined
      ? `https://destination.example/${spec.campaignId}`
      : spec.destinationUrl,
    trackingUrl: spec.trackingUrl === undefined
      ? `https://tracking.example/${spec.campaignId}`
      : spec.trackingUrl,
    raw: {
      CampaignId: spec.campaignId,
      secretSentinel: "raw-campaign-must-not-enter-plan",
    },
    provenance: provenance("campaigns", recordIndex),
  };
}

function promotion(
  spec: OfferSpec,
  stores: readonly StoreSpec[],
  recordIndex: number,
): RawImpactPromotionV2 {
  const store = stores.find((entry) => entry.campaignId === spec.campaignId);
  return {
    promotionId: spec.promotionId,
    advertiserId: store
      ? store.advertiserId ?? `advertiser-${store.campaignId}`
      : null,
    advertiserName: store?.name ?? null,
    campaignId: spec.campaignId,
    programId: spec.campaignId ? `program-${spec.campaignId}` : null,
    promotionTitle: spec.title === undefined ? `Offer ${spec.promotionId}` : spec.title,
    description: spec.description === undefined
      ? `Description ${spec.promotionId}`
      : spec.description,
    genericRedemptionCode: spec.kind === "coupon"
      ? spec.code ?? `CODE-${spec.promotionId}`
      : null,
    trackingUrl: spec.trackingUrl === undefined
      ? `https://tracking.example/offers/${spec.promotionId}`
      : spec.trackingUrl,
    startDate: spec.startDate === undefined ? "2026-01-01T00:00:00Z" : spec.startDate,
    endDate: spec.endDate === undefined ? "2026-12-31T23:59:59Z" : spec.endDate,
    raw: {
      PromotionId: spec.promotionId,
      secretSentinel: "raw-offer-must-not-enter-plan",
    },
    provenance: provenance("promotions", recordIndex),
  };
}

function preview(spec: PreviewSpec = {}): AffiliateSyncPreviewV2 {
  const stores = spec.stores ?? [];
  const offers = spec.offers ?? [];
  const campaigns = stores.map(campaign);
  const promotions = offers.map((entry, index) => promotion(entry, stores, index));
  const input: AffiliateSyncPreviewInputV2 = {
    acceptedPromotions: promotions,
    acceptedCampaigns: campaigns,
    fetchDiagnostics: {
      promotions: streamDiagnostics("promotions", promotions.length),
      campaigns: streamDiagnostics("campaigns", campaigns.length),
    },
    quarantinedRecords: [],
    existingCatalogSnapshot: spec.snapshot ?? { stores: [], offers: [] },
    publishingPolicyConfig: {
      maxCouponsPerStore: spec.maxCouponsPerStore ?? 0,
      maxDealsPerStore: spec.maxDealsPerStore ?? 0,
    },
    storeQualificationConfig: {
      minimumSelectedCoupons: spec.minimumSelectedCoupons ?? 0,
      minimumSelectedDeals: spec.minimumSelectedDeals ?? 0,
      minimumTotalSelectedOffers: spec.minimumTotalSelectedOffers ?? 1,
    },
    evaluationTimestamp: EVALUATION_TIMESTAMP,
  };
  return PreviewPlanner.plan(input);
}

function context(input: {
  knownStoreSlugs?: readonly KnownStoreSlugV2[];
  knownOfferKinds?: readonly KnownOfferKindV2[];
  provider?: string;
  evaluationTimestamp?: string;
} = {}): PersistencePlanContextV2 {
  return {
    integrationId: INTEGRATION_ID,
    provider: input.provider ?? "impact",
    evaluationTimestamp: input.evaluationTimestamp ?? EVALUATION_TIMESTAMP,
    knownStoreSlugs: input.knownStoreSlugs ?? [],
    knownOfferKinds: input.knownOfferKinds ?? [],
  };
}

function plan(
  result: AffiliateSyncPreviewV2,
  planningContext: PersistencePlanContextV2 = context(),
) {
  return PersistencePlannerV2.plan({ preview: result, context: planningContext });
}

function simpleStore(): StoreSpec {
  return { campaignId: "campaign-a", name: "Alpha Store" };
}

test("A: an empty complete preview produces a ready zero-write plan", () => {
  const result = plan(preview());
  assert.equal(result.status, "ready");
  assert.deepEqual(result.storeInstructions, []);
  assert.deepEqual(result.offerInstructions, []);
  assert.equal(result.counts.writableEntities, 0);
});

test("B/C: qualified new stores project selected coupons and deals as creates", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [
      { promotionId: "coupon-a", campaignId: "campaign-a", kind: "coupon", code: "SAVE10" },
      { promotionId: "deal-a", campaignId: "campaign-a", kind: "deal" },
    ],
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.counts.stores.create, 1);
  assert.equal(result.counts.offers.create, 2);
  assert.equal(result.counts.writableEntities, 3);
  const coupon = result.offerInstructions.find((entry) => entry.promotionId === "coupon-a");
  const deal = result.offerInstructions.find((entry) => entry.promotionId === "deal-a");
  assert.equal(coupon?.action, "create");
  assert.equal(coupon?.projection?.couponType, "code");
  assert.equal(coupon?.projection?.couponCode, "SAVE10");
  assert.equal(deal?.action, "create");
  assert.equal(deal?.projection?.couponType, "deal");
  assert.equal(deal?.projection?.couponCode, null);
});

test("D: an exact existing store remains a no-op parent for a new offer", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "deal-a", campaignId: "campaign-a", kind: "deal" }],
    snapshot: {
      stores: [{
        id: "store-existing",
        providerStoreKey: { provider: "impact", namespace: "campaign", id: "campaign-a" },
      }],
      offers: [],
    },
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.storeInstructions[0]?.action, "noop_existing");
  assert.equal(result.offerInstructions[0]?.action, "create");
  assert.equal(result.offerInstructions[0]?.expectedParentStoreId, "store-existing");
});

test("E: an exact existing offer is a no-op and never authorizes an update", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "coupon-a", campaignId: "campaign-a", kind: "coupon" }],
    snapshot: {
      stores: [],
      offers: [{ id: "offer-existing", promotionId: "coupon-a" }],
    },
  }), context({
    knownOfferKinds: [{ offerId: "offer-existing", promotionId: "coupon-a", kind: "coupon" }],
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.offerInstructions[0]?.action, "noop_existing");
  assert.equal(result.offerInstructions[0]?.projection, null);
  assert.equal(result.counts.writableOffers, 0);
});

test("F: held offers remain nonwritable", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [
      { promotionId: "deal-a", campaignId: "campaign-a", kind: "deal" },
      { promotionId: "deal-b", campaignId: "campaign-a", kind: "deal" },
    ],
    maxDealsPerStore: 1,
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.counts.offers.create, 1);
  assert.equal(result.counts.offers.noopHeld, 1);
  assert.equal(result.offerInstructions.find((entry) => entry.action === "noop_held")?.selected, false);
});

test("G: unresolved offers and unmatched store reports remain nonwritable", () => {
  const result = plan(preview({
    offers: [{ promotionId: "unresolved-a", campaignId: null, kind: "deal" }],
    minimumTotalSelectedOffers: 0,
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.storeInstructions[0]?.action, "noop_unmatched");
  assert.equal(result.offerInstructions[0]?.action, "noop_unresolved");
  assert.equal(result.counts.writableEntities, 0);
});

test("H: an ambiguous exact store snapshot blocks without choosing a row", () => {
  const storeKey = { provider: "impact" as const, namespace: "campaign" as const, id: "campaign-a" };
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "deal-a", campaignId: "campaign-a", kind: "deal" }],
    snapshot: {
      stores: [
        { id: "store-1", providerStoreKey: storeKey },
        { id: "store-2", providerStoreKey: storeKey },
      ],
      offers: [],
    },
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.storeInstructions[0]?.action, "blocked_ambiguous");
  assert.deepEqual(
    result.storeInstructions[0]?.action === "blocked_ambiguous"
      ? result.storeInstructions[0].expectedExistingStoreIds
      : [],
    ["store-1", "store-2"],
  );
  assert.ok(result.blockers.some((entry) => entry.reason === "ambiguous_store_snapshot"));
});

test("I/L: equal presentation never collapses campaign identity and known slug collisions block", () => {
  const result = plan(preview({
    stores: [
      { campaignId: "campaign-a", name: "Same Store", trackingUrl: "https://same.example" },
      { campaignId: "campaign-b", name: "Same Store", trackingUrl: "https://same.example" },
    ],
    offers: [
      { promotionId: "deal-a", campaignId: "campaign-a", kind: "deal" },
      { promotionId: "deal-b", campaignId: "campaign-b", kind: "deal" },
    ],
  }), context({
    knownStoreSlugs: [{
      storeId: "manual-store",
      slug: "same-store",
      providerStoreKey: null,
    }],
  }));
  const identities = result.storeInstructions.flatMap((entry) =>
    entry.providerStoreKey ? [entry.providerStoreKey.id] : []);
  assert.deepEqual(identities, ["campaign-a", "campaign-b"]);
  assert.equal(new Set(identities).size, 2);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((entry) => entry.reason === "store_slug_collision"));
  assert.equal(result.storeInstructions.some((entry) =>
    entry.action === "noop_existing" && entry.expectedExistingStoreId === "manual-store"), false);
});

test("J: equal offer presentation never replaces canonical PromotionId identity", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [
      {
        promotionId: "promotion-a",
        campaignId: "campaign-a",
        kind: "coupon",
        title: "Same",
        code: "SAME",
        trackingUrl: "https://same.example",
      },
      {
        promotionId: "promotion-b",
        campaignId: "campaign-a",
        kind: "coupon",
        title: "Same",
        code: "SAME",
        trackingUrl: "https://same.example",
      },
    ],
  }));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.offerInstructions.map((entry) => entry.providerEntityId), [
    "promotion-a",
    "promotion-b",
  ]);
  assert.equal(result.counts.offers.create, 2);
});

test("K: an existing offer kind conflict blocks without reclassification", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "coupon" }],
    snapshot: {
      stores: [],
      offers: [{ id: "offer-existing", promotionId: "promotion-a" }],
    },
  }), context({
    knownOfferKinds: [{ offerId: "offer-existing", promotionId: "promotion-a", kind: "deal" }],
  }));
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((entry) => entry.reason === "offer_kind_conflict"));
  assert.equal(result.offerInstructions[0]?.action, "noop_existing");
  assert.equal(result.offerInstructions[0]?.projection, null);
});

test("M/O/P: incidental ordering does not alter instructions or canonical material", () => {
  const forwardPreview = preview({
    stores: [
      { campaignId: "campaign-a", name: "Alpha" },
      { campaignId: "campaign-b", name: "Bravo" },
    ],
    offers: [
      { promotionId: "promotion-a", campaignId: "campaign-a", kind: "coupon" },
      { promotionId: "promotion-b", campaignId: "campaign-b", kind: "deal" },
    ],
  });
  const reversedPreview = structuredClone(forwardPreview);
  reversedPreview.normalizedStores.reverse();
  reversedPreview.normalizedCoupons.reverse();
  reversedPreview.normalizedDeals.reverse();
  reversedPreview.proposedActions.stores.reverse();
  reversedPreview.proposedActions.offers.reverse();
  reversedPreview.publishingPolicy.selectedCoupons.reverse();
  reversedPreview.publishingPolicy.selectedDeals.reverse();
  reversedPreview.storeQualification.reverse();

  const forward = plan(forwardPreview);
  const reversed = plan(reversedPreview);
  const repeated = plan(structuredClone(forwardPreview));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(repeated, forward);
});

test("N: blocker ordering is stable across reversed bounded snapshot input", () => {
  const resultPreview = preview({
    stores: [
      { campaignId: "campaign-a", name: "Same" },
      { campaignId: "campaign-b", name: "Same" },
    ],
    offers: [
      { promotionId: "a", campaignId: "campaign-a", kind: "deal" },
      { promotionId: "b", campaignId: "campaign-b", kind: "deal" },
    ],
  });
  const slugs: KnownStoreSlugV2[] = [
    { storeId: "z", slug: "same", providerStoreKey: null },
    { storeId: "a", slug: "same", providerStoreKey: null },
  ];
  const forward = plan(resultPreview, context({ knownStoreSlugs: slugs }));
  const reversed = plan(resultPreview, context({ knownStoreSlugs: [...slugs].reverse() }));
  assert.deepEqual(reversed.blockers, forward.blockers);
  assert.deepEqual(reversed.canonicalPlanMaterial, forward.canonicalPlanMaterial);
});

test("Q/R/S: canonical material changes with exact identities and contains the fixed version", () => {
  const base = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  }));
  const changedPromotion = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-b", campaignId: "campaign-a", kind: "deal" }],
  }));
  const changedCampaign = plan(preview({
    stores: [{ campaignId: "campaign-b", name: "Alpha Store" }],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-b", kind: "deal" }],
  }));
  assert.notEqual(base.canonicalPlanMaterialString, changedPromotion.canonicalPlanMaterialString);
  assert.notEqual(base.canonicalPlanMaterialString, changedCampaign.canonicalPlanMaterialString);
  assert.equal(base.canonicalPlanMaterial.persistenceContractVersion, PERSISTENCE_CONTRACT_VERSION_V2);
  assert.match(base.canonicalPlanMaterialString, /v2-a9b-1/);
});

test("T: an unsupported provider returns no writable instructions", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  }), context({ provider: "unsupported" }));
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.storeInstructions, []);
  assert.deepEqual(result.offerInstructions, []);
  assert.equal(result.counts.writableEntities, 0);
  assert.deepEqual(result.blockers.map((entry) => entry.reason), ["unsupported_provider"]);
});

test("U: a selected create missing its parent is blocked", () => {
  const broken = preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  });
  broken.proposedActions.stores = [];
  const result = plan(broken);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((entry) => entry.reason === "missing_parent_store"));
});

test("V: a selected create attached to an unqualified parent is blocked", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
    minimumTotalSelectedOffers: 2,
  }));
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((entry) => entry.reason === "unqualified_parent_store"));
});

test("W: zero thresholds preserve a qualified held-only store create", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{
      promotionId: "expired-a",
      campaignId: "campaign-a",
      kind: "deal",
      endDate: "2026-05-31T23:59:59Z",
    }],
    minimumSelectedCoupons: 0,
    minimumSelectedDeals: 0,
    minimumTotalSelectedOffers: 0,
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.storeInstructions[0]?.action, "create");
  assert.equal(result.storeInstructions[0]?.qualified, true);
  assert.equal(result.counts.stores.create, 1);
  assert.equal(result.counts.offers.create, 0);
  assert.equal(result.counts.offers.noopHeld, 1);
});

test("X: planning introduces no generated run or entity identifier", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  }));
  const material = result.canonicalPlanMaterial as unknown as Record<string, unknown>;
  assert.equal("runId" in result, false);
  assert.equal("runId" in material, false);
  assert.equal(result.integrationId, INTEGRATION_ID);
  assert.deepEqual(plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  })), result);
});

test("required store projection gaps block instead of inventing content", () => {
  const result = plan(preview({
    stores: [{ campaignId: "campaign-a", name: null }],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  }));
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((entry) => entry.reason === "invalid_store_projection"));
  assert.equal(result.storeInstructions[0]?.action === "create"
    ? result.storeInstructions[0].projection
    : undefined, null);
});

test("UTC date projection is independent of machine-local calendar boundaries", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{
      promotionId: "promotion-a",
      campaignId: "campaign-a",
      kind: "deal",
      startDate: "2026-01-01T00:30:00+02:00",
      endDate: "2026-12-31T23:30:00-02:00",
    }],
  }));
  const instruction = result.offerInstructions[0];
  assert.equal(instruction?.action, "create");
  assert.equal(instruction?.projection?.startDate, "2025-12-31");
  assert.equal(instruction?.projection?.expiryDate, "2027-01-01");
  assert.equal(instruction?.projection?.status, "active");
});

test("raw provider objects and provenance do not enter plan material", () => {
  const result = plan(preview({
    stores: [simpleStore()],
    offers: [{ promotionId: "promotion-a", campaignId: "campaign-a", kind: "deal" }],
  }));
  assert.equal(result.canonicalPlanMaterialString.includes("raw-campaign-must-not-enter-plan"), false);
  assert.equal(result.canonicalPlanMaterialString.includes("raw-offer-must-not-enter-plan"), false);
  assert.equal(result.canonicalPlanMaterialString.includes("sanitizedRequestUrl"), false);
});

test("live-like synthetic 1/141/33/108 planning reconciles to 34 future inserts", () => {
  const stores = [{ campaignId: "campaign-synthetic", name: "Synthetic Merchant" }];
  const offers: OfferSpec[] = [
    ...Array.from({ length: 15 }, (_, index): OfferSpec => ({
      promotionId: `coupon-${String(index).padStart(3, "0")}`,
      campaignId: "campaign-synthetic",
      kind: "coupon",
    })),
    ...Array.from({ length: 126 }, (_, index): OfferSpec => ({
      promotionId: `deal-${String(index).padStart(3, "0")}`,
      campaignId: "campaign-synthetic",
      kind: "deal",
    })),
  ];
  const result = plan(preview({
    stores,
    offers,
    maxCouponsPerStore: 0,
    maxDealsPerStore: 18,
  }));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.counts.stores, {
    create: 1,
    noopExisting: 0,
    blockedAmbiguous: 0,
    noopUnmatched: 0,
  });
  assert.deepEqual(result.counts.offers, {
    create: 33,
    noopExisting: 0,
    noopHeld: 108,
    noopUnresolved: 0,
  });
  assert.equal(result.counts.writableEntities, 34);
  assert.equal(new Set(result.offerInstructions.map((entry) => entry.promotionId)).size, 141);
});

test("output invariant validation rejects tampered counts", () => {
  const result = plan(preview());
  const tampered = structuredClone(result);
  tampered.counts.writableEntities = 1;
  assert.throws(
    () => validatePersistencePlanV2(tampered),
    /persistence_plan_count_mismatch/,
  );
});
