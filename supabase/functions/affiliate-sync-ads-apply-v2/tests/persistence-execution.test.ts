import assert from "node:assert/strict";
import test from "node:test";
import {
  type AdsRecordProvenanceV2,
  type ImpactAdsFetchDiagnosticsV2,
  type RawImpactAdV2,
  type RawImpactCampaignForAdsV2,
} from "../../_shared/affiliate-sync-v2-ads/index.ts";
import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  AdsPersistencePlannerV2,
  type AdsPersistencePlanV2,
} from "../../_shared/affiliate-sync-v2-ads-persistence/index.ts";
import {
  ADS_PLAN_FINGERPRINT_ALGORITHM_V2,
  adsPersistenceRpcArgsV2,
  prepareAdsPersistenceExecutionV2,
  sha256AdsPlanHexV2,
} from "../persistence-execution.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const EVALUATION = "2026-06-01T00:00:00.000Z";
const PROVENANCE: AdsRecordProvenanceV2 = {
  fetchSequence: 1,
  recordIndex: 0,
  providerPage: 1,
  providerPageSize: 100,
};

function diagnostics(stream: "campaigns" | "ads"): ImpactAdsFetchDiagnosticsV2 {
  return {
    stream,
    complete: true,
    stopReason: "completed",
    parseFailureReason: null,
    pagesFetched: 1,
    physicalRequests: 1,
    retryCount: 0,
    rawRecords: 1,
    acceptedRecords: 1,
    quarantinedRecords: 0,
    recordsDiscardedByLimit: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    },
    pages: [],
    rate: { limit: null, remaining: null, reset: null },
  };
}

function readyPlan(): AdsPersistencePlanV2 {
  const campaign: RawImpactCampaignForAdsV2 = {
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    campaignName: "Acme & Co.",
    destinationUrl: "https://acme.example/sale",
    trackingUrl: "https://track.example/campaign",
    provenance: PROVENANCE,
  };
  const ad: RawImpactAdV2 = {
    providerOfferKey: { provider: "impact", namespace: "ad", id: "Ad-A" },
    campaignId: "Campaign-A",
    advertiserId: "Advertiser-A",
    dealId: "Deal-A",
    dealState: "ACTIVE",
    codeClass: "code_bearing",
    validatedCouponCode: "Save 20!",
    title: "Save 20% – Summer",
    description: "Twenty percent off selected products.",
    trackingUrl: "https://track.example/ad",
    landingPageUrl: "https://acme.example/coupon",
    dealStartDate: "2026-05-01T00:00:00Z",
    dealEndDate: "2026-12-31T23:59:59Z",
    startDate: "2026-01-01",
    endDate: "2027-01-31",
    dateFieldsValid: true,
    discountType: "percentage",
    discountValue: 20,
    structuredTerms: {
      minimumPurchase: 50,
      maximumSavings: 20,
      purchaseLimit: 1,
      scope: "Sitewide",
      currency: "USD",
      text: null,
    },
    provenance: PROVENANCE,
  };
  return AdsPersistencePlannerV2.plan({
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION,
    siteUrl: "https://getyourcodes.com/admin",
    mode: "full",
    canaryAdId: null,
    campaignFetch: {
      records: [campaign],
      diagnostics: diagnostics("campaigns"),
    },
    adsFetch: { records: [ad], diagnostics: diagnostics("ads") },
    catalog: { stores: [], offers: [] },
  });
}

function rematerialize(plan: AdsPersistencePlanV2): AdsPersistencePlanV2 {
  const copy = structuredClone(plan);
  const material = {
    persistenceContractVersion: copy.persistenceContractVersion,
    provider: copy.provider,
    integrationId: copy.integrationId,
    evaluationTimestamp: copy.evaluationTimestamp,
    mode: copy.mode,
    canaryAdId: copy.canaryAdId,
    status: copy.status,
    blockers: copy.blockers,
    preconditions: copy.preconditions,
    storeInstructions: copy.storeInstructions,
    offerInstructions: copy.offerInstructions,
    counts: copy.counts,
  };
  copy.canonicalPlanMaterial = structuredClone(material);
  copy.canonicalPlanMaterialString = JSON.stringify(material);
  return copy;
}

test("prepared capability exposes only the closed Ads RPC contract", async () => {
  const plan = readyPlan();
  assert.equal(plan.status, "ready");
  const prepared = await prepareAdsPersistenceExecutionV2(plan, ADMIN_ID);
  const args = adsPersistenceRpcArgsV2(prepared);
  assert.equal(args._provider, "impact");
  assert.equal(
    args._persistence_contract_version,
    ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  );
  assert.equal(
    args._plan_fingerprint_algorithm,
    ADS_PLAN_FINGERPRINT_ALGORITHM_V2,
  );
  assert.match(args._plan_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(args._store_instructions.length, 1);
  assert.equal(args._offer_instructions.length, 1);
  assert.deepEqual(Object.keys(args).sort(), [
    "_evaluation_timestamp",
    "_expected_counts",
    "_integration_id",
    "_offer_instructions",
    "_persistence_contract_version",
    "_plan_fingerprint",
    "_plan_fingerprint_algorithm",
    "_provider",
    "_store_instructions",
    "_triggered_by",
  ]);
  assert.deepEqual(Object.keys(args._store_instructions[0]!).sort(), [
    "action",
    "expectedExistingStoreId",
    "instructionOrdinal",
    "projection",
    "provider",
    "providerEntityId",
    "providerEntityNamespace",
    "qualified",
  ]);
  assert.deepEqual(Object.keys(args._offer_instructions[0]!).sort(), [
    "action",
    "existingOfferId",
    "expectedParentStoreId",
    "instructionOrdinal",
    "kind",
    "parentProviderEntityId",
    "parentProviderEntityNamespace",
    "projection",
    "provider",
    "providerEntityId",
    "providerEntityNamespace",
  ]);
  assert.equal(
    args._store_instructions[0]?.providerEntityNamespace,
    "campaign",
  );
  assert.equal(args._offer_instructions[0]?.providerEntityNamespace, "ad");
  assert.equal(
    args._offer_instructions[0]?.parentProviderEntityNamespace,
    "campaign",
  );
  assert.equal(args._offer_instructions[0]?.projection?.couponCode, "Save 20!");
  assert.equal(Object.isFrozen(args), true);
  assert.equal(Object.isFrozen(args._store_instructions), true);
  assert.equal(Object.isFrozen(args._offer_instructions), true);
  assert.throws(() => adsPersistenceRpcArgsV2({} as never));
});

test("fingerprint is deterministic SHA-256 of exact UTF-8 canonical bytes", async () => {
  assert.equal(
    await sha256AdsPlanHexV2("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const one = adsPersistenceRpcArgsV2(
    await prepareAdsPersistenceExecutionV2(readyPlan(), ADMIN_ID),
  );
  const two = adsPersistenceRpcArgsV2(
    await prepareAdsPersistenceExecutionV2(readyPlan(), ADMIN_ID),
  );
  assert.equal(one._plan_fingerprint, two._plan_fingerprint);
});

test("blocked plans and malformed server-owned material never become RPC capabilities", async () => {
  const blocked = rematerialize(readyPlan());
  blocked.status = "blocked";
  blocked.blockers.push({
    reason: "invalid_context",
    entity: "plan",
    providerEntityNamespace: null,
    providerEntityId: null,
  });
  assert.rejects(() =>
    prepareAdsPersistenceExecutionV2(rematerialize(blocked), ADMIN_ID)
  );

  const extra = rematerialize(readyPlan()) as AdsPersistencePlanV2 & {
    injected?: string;
  };
  extra.injected = "browser-material";
  assert.rejects(() => prepareAdsPersistenceExecutionV2(extra, ADMIN_ID));
});

test("projection hardening rejects invalid code, impossible dates, incoherent discount and terms", async () => {
  const mutateOffer = async (
    mutate: (projection: Record<string, unknown>) => void,
  ) => {
    const plan = rematerialize(readyPlan());
    const offer = plan.offerInstructions[0];
    assert.equal(offer?.action, "create");
    if (offer?.action !== "create") throw new Error("fixture_invalid");
    mutate(offer.projection as unknown as Record<string, unknown>);
    await assert.rejects(() =>
      prepareAdsPersistenceExecutionV2(rematerialize(plan), ADMIN_ID)
    );
  };

  await mutateOffer((projection) => {
    projection.couponCode = "N/A";
  });
  await mutateOffer((projection) => {
    const metadata = projection.metadata as Record<string, unknown>;
    metadata.dealStartDate = "2026-02-30T00:00:00Z";
  });
  await mutateOffer((projection) => {
    projection.discountType = null;
    projection.discountValue = 10;
  });
  await mutateOffer((projection) => {
    const terms = projection.structuredTerms as Record<string, unknown>;
    terms.purchaseLimit = 0;
  });
});

test("store projection hardening preserves fixed fields and exact destination relationships", async () => {
  const mutateStore = async (
    mutate: (projection: Record<string, unknown>) => void,
  ) => {
    const plan = rematerialize(readyPlan());
    const store = plan.storeInstructions[0];
    assert.equal(store?.action, "create");
    if (store?.action !== "create") throw new Error("fixture_invalid");
    mutate(store.projection as unknown as Record<string, unknown>);
    await assert.rejects(() =>
      prepareAdsPersistenceExecutionV2(rematerialize(plan), ADMIN_ID)
    );
  };

  await mutateStore((projection) => {
    projection.description = "injected";
  });
  await mutateStore((projection) => {
    projection.country = "US";
  });
  await mutateStore((projection) => {
    projection.shippingRegions = ["US"];
  });
  await mutateStore((projection) => {
    projection.logoSourceUrl = "https://acme.example/logo.png";
  });
  await mutateStore((projection) => {
    projection.affiliateUrl = "https://acme.example/alternate";
  });
  await mutateStore((projection) => {
    const metadata = projection.metadata as Record<string, unknown>;
    metadata.destinationUrl = "https://acme.example/alternate";
  });

  const independentTracking = rematerialize(readyPlan());
  const store = independentTracking.storeInstructions[0];
  assert.equal(store?.action, "create");
  if (store?.action !== "create") throw new Error("fixture_invalid");
  store.projection.metadata.trackingUrl = null;
  await assert.doesNotReject(() =>
    prepareAdsPersistenceExecutionV2(
      rematerialize(independentTracking),
      ADMIN_ID,
    )
  );
});
