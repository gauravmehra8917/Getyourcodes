import assert from "node:assert/strict";
import test from "node:test";
import {
  type CanonicalPersistencePlanMaterialV2,
  PERSISTENCE_CONTRACT_VERSION_V2,
  type PersistenceOfferInstructionV2,
  type PersistencePlanCountsV2,
  type PersistencePlanPreconditionV2,
  type PersistencePlanV2,
  type PersistenceStoreInstructionV2,
} from "../../_shared/affiliate-sync-v2/persistence-models.ts";
import {
  persistenceRpcArgs,
  PLAN_FINGERPRINT_ALGORITHM_V2,
  type PreparedPersistenceExecutionV2,
  preparePersistenceExecution,
  sha256Hex,
} from "../persistence-execution.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const TRIGGERED_BY = "22222222-2222-4222-8222-222222222222";
const EVALUATION_TIMESTAMP = "2026-08-20T12:34:56.000Z";
const EXISTING_STORE_ID = "33333333-3333-4333-8333-333333333333";
const EXISTING_OFFER_ID = "44444444-4444-4444-8444-444444444444";

const PRECONDITION_CODES = [
  "provider_is_impact",
  "context_is_consistent",
  "provider_fetches_completed",
  "provider_parse_succeeded",
  "identity_not_collapsed",
  "store_identities_unique",
  "promotion_identities_unique",
  "writable_offers_resolved",
  "writable_parents_unambiguous",
  "writable_parents_qualified",
  "store_projections_valid",
  "offer_projections_valid",
  "existing_store_ids_consistent",
  "existing_offer_ids_consistent",
  "offer_kinds_consistent",
  "slug_candidates_available",
  "nonwritable_actions_preserved",
  "instruction_counts_reconcile",
] as const;

function satisfiedPreconditions(): PersistencePlanPreconditionV2[] {
  return PRECONDITION_CODES.map((code) => ({ code, satisfied: true }));
}

function counts(): PersistencePlanCountsV2 {
  return {
    stores: {
      create: 1,
      noopExisting: 1,
      blockedAmbiguous: 0,
      noopUnmatched: 1,
    },
    offers: {
      create: 1,
      noopExisting: 1,
      noopHeld: 1,
      noopUnresolved: 1,
    },
    writableStores: 1,
    writableOffers: 1,
    writableEntities: 2,
  };
}

function stores(): PersistenceStoreInstructionV2[] {
  return [
    {
      action: "create",
      providerStoreKey: {
        provider: "impact",
        namespace: "campaign",
        id: "campaign-a",
      },
      provider: "impact",
      providerEntityId: "campaign-a",
      expectedExistingStoreId: null,
      qualified: true,
      projection: {
        name: "Alpha Store",
        slugCandidate: "alpha-store",
        description: null,
        affiliateUrl: "https://tracking.invalid/campaign-a",
        destinationUrl: "https://destination.invalid/campaign-a",
        country: null,
        shippingRegions: [],
        logoSourceUrl: null,
        metadata: { advertiserId: "advertiser-a", campaignId: "campaign-a" },
        importOrigin: "provider",
        lifecycleManaged: true,
        lifecycleHidden: false,
        lastQualificationResult: "qualified",
        lastQualifiedAt: EVALUATION_TIMESTAMP,
      },
    },
    {
      action: "noop_existing",
      providerStoreKey: {
        provider: "impact",
        namespace: "campaign",
        id: "campaign-b",
      },
      provider: "impact",
      providerEntityId: "campaign-b",
      expectedExistingStoreId: EXISTING_STORE_ID,
      qualified: true,
      projection: null,
    },
    {
      action: "noop_unmatched",
      providerStoreKey: null,
      provider: "impact",
      providerEntityId: null,
      promotionId: "promotion-unmatched",
      unresolvedReason: "missing_merchant_identity",
      qualified: false,
      projection: null,
    },
  ];
}

function offers(): PersistenceOfferInstructionV2[] {
  return [
    {
      action: "create",
      promotionId: "promotion-a",
      provider: "impact",
      providerEntityId: "promotion-a",
      kind: "coupon",
      existingOfferId: null,
      parentProviderStoreKey: {
        provider: "impact",
        namespace: "campaign",
        id: "campaign-a",
      },
      expectedParentStoreId: null,
      selected: true,
      projection: {
        title: "Ten percent off",
        description: "Fixture coupon",
        couponCode: "SAVE10",
        couponType: "code",
        affiliateUrl: "https://tracking.invalid/promotion-a",
        landingPageUrl: null,
        startDate: "2026-08-01",
        expiryDate: "2026-12-31",
        status: "active",
        terms: "Fixture terms",
        discountType: "percentage",
        discountValue: 10,
        metadata: {
          advertiserId: "advertiser-a",
          campaignId: "campaign-a",
          programId: "program-a",
          resolvedCampaignId: "campaign-a",
        },
      },
    },
    {
      action: "noop_existing",
      promotionId: "promotion-b",
      provider: "impact",
      providerEntityId: "promotion-b",
      kind: "deal",
      existingOfferId: EXISTING_OFFER_ID,
      parentProviderStoreKey: {
        provider: "impact",
        namespace: "campaign",
        id: "campaign-b",
      },
      expectedParentStoreId: EXISTING_STORE_ID,
      selected: true,
      projection: null,
    },
    {
      action: "noop_held",
      promotionId: "promotion-c",
      provider: "impact",
      providerEntityId: "promotion-c",
      kind: "deal",
      existingOfferId: null,
      parentProviderStoreKey: {
        provider: "impact",
        namespace: "campaign",
        id: "campaign-a",
      },
      expectedParentStoreId: null,
      selected: false,
      holdReason: "expired",
      projection: null,
    },
    {
      action: "noop_unresolved",
      promotionId: "promotion-d",
      provider: "impact",
      providerEntityId: "promotion-d",
      kind: "deal",
      existingOfferId: null,
      parentProviderStoreKey: null,
      expectedParentStoreId: null,
      selected: false,
      holdReason: "unresolved_store",
      unresolvedReason: "missing_merchant_identity",
      projection: null,
    },
  ];
}

function finalize(
  material: CanonicalPersistencePlanMaterialV2,
): PersistencePlanV2 {
  return {
    ...material,
    canonicalPlanMaterial: material,
    canonicalPlanMaterialString: JSON.stringify(material),
  };
}

function readyPlan(): PersistencePlanV2 {
  return finalize({
    persistenceContractVersion: PERSISTENCE_CONTRACT_VERSION_V2,
    provider: "impact",
    integrationId: INTEGRATION_ID,
    evaluationTimestamp: EVALUATION_TIMESTAMP,
    status: "ready",
    blockers: [],
    preconditions: satisfiedPreconditions(),
    storeInstructions: stores(),
    offerInstructions: offers(),
    counts: counts(),
  });
}

function planWithStoreProjectionMutation(
  mutate: (projection: Record<string, unknown>) => void,
): PersistencePlanV2 {
  const base = readyPlan();
  const storeInstructions = stores();
  const create = storeInstructions[0];
  if (!create || create.action !== "create" || !create.projection) {
    throw new Error("fixture_invalid");
  }
  mutate(create.projection as unknown as Record<string, unknown>);
  return finalize({
    ...base.canonicalPlanMaterial,
    storeInstructions,
  });
}

function planWithOfferProjectionMutation(
  mutate: (projection: Record<string, unknown>) => void,
): PersistencePlanV2 {
  const base = readyPlan();
  const offerInstructions = offers();
  const create = offerInstructions[0];
  if (!create || create.action !== "create" || !create.projection) {
    throw new Error("fixture_invalid");
  }
  mutate(create.projection as unknown as Record<string, unknown>);
  return finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions,
  });
}

function blockedPlan(): PersistencePlanV2 {
  const ready = readyPlan();
  return finalize({
    ...ready.canonicalPlanMaterial,
    status: "blocked",
    blockers: [{
      reason: "invalid_context",
      entity: "plan",
      providerStoreKey: null,
      promotionId: null,
      internalIds: [],
    }],
  });
}

test("SHA-256 uses Web Crypto and matches required UTF-8 vectors", async () => {
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    await sha256Hex("GetYourCodes — नमस्ते 🌍"),
    "f1c663e30653c0ceee19a31064f4e9a63695c80147688c7cbaf9f791283be420",
  );
});

test("SHA-256 is deterministic, sensitive to canonical material, and lowercase hex", async () => {
  const first = await sha256Hex("canonical-material");
  const again = await sha256Hex("canonical-material");
  const changed = await sha256Hex("canonical-material-changed");
  assert.equal(first, again);
  assert.notEqual(first, changed);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("one plan produces exact coupled RPC fields and full aggregate counts", async () => {
  const plan = readyPlan();
  const prepared = await preparePersistenceExecution(plan, TRIGGERED_BY);
  const args = persistenceRpcArgs(prepared);

  assert.deepEqual(Object.keys(args), [
    "_integration_id",
    "_provider",
    "_persistence_contract_version",
    "_plan_fingerprint_algorithm",
    "_plan_fingerprint",
    "_evaluation_timestamp",
    "_triggered_by",
    "_expected_counts",
    "_store_instructions",
    "_offer_instructions",
  ]);
  assert.equal(args._integration_id, plan.integrationId);
  assert.equal(args._provider, plan.provider);
  assert.equal(
    args._persistence_contract_version,
    plan.persistenceContractVersion,
  );
  assert.equal(
    args._plan_fingerprint_algorithm,
    PLAN_FINGERPRINT_ALGORITHM_V2,
  );
  assert.equal(
    args._plan_fingerprint,
    await sha256Hex(plan.canonicalPlanMaterialString),
  );
  assert.equal(args._evaluation_timestamp, plan.evaluationTimestamp);
  assert.equal(args._triggered_by, TRIGGERED_BY);
  assert.deepEqual(args._expected_counts, plan.counts);
  assert.deepEqual(args._expected_counts, counts());

  assert.deepEqual(
    args._store_instructions.map((entry) => entry.action),
    ["create", "noop_existing"],
  );
  assert.deepEqual(Object.keys(args._store_instructions[0] ?? {}), [
    "instructionOrdinal",
    "action",
    "provider",
    "providerEntityId",
    "expectedExistingStoreId",
    "qualified",
    "projection",
  ]);
  assert.deepEqual(
    args._offer_instructions.map((entry) => entry.action),
    ["create", "noop_existing"],
  );
  assert.deepEqual(Object.keys(args._offer_instructions[0] ?? {}), [
    "instructionOrdinal",
    "action",
    "provider",
    "providerEntityId",
    "kind",
    "existingOfferId",
    "parentProviderEntityId",
    "expectedParentStoreId",
    "projection",
  ]);
  assert.deepEqual(
    args._store_instructions.map((entry) => entry.instructionOrdinal),
    [0, 1],
  );
  assert.deepEqual(
    args._offer_instructions.map((entry) => entry.instructionOrdinal),
    [2, 3],
  );
  assert.equal(
    args._offer_instructions[0]?.parentProviderEntityId,
    "campaign-a",
  );
  assert.equal(
    args._offer_instructions[1]?.parentProviderEntityId,
    "campaign-b",
  );
  assert.equal(
    JSON.stringify(args).includes("providerStoreKey"),
    false,
  );
  const sourceStore = plan.storeInstructions.find((entry) =>
    entry.action === "create"
  );
  const sourceOffer = plan.offerInstructions.find((entry) =>
    entry.action === "create"
  );
  assert.equal(sourceStore?.action, "create");
  assert.equal(sourceOffer?.action, "create");
  if (
    !sourceStore || sourceStore.action !== "create" ||
    !sourceOffer || sourceOffer.action !== "create"
  ) throw new Error("fixture_invalid");
  assert.deepEqual(
    args._store_instructions[0]?.projection,
    sourceStore.projection,
  );
  assert.deepEqual(
    args._offer_instructions[0]?.projection,
    sourceOffer.projection,
  );
  assert.notEqual(
    args._store_instructions[0]?.projection,
    sourceStore.projection,
  );
  assert.notEqual(
    args._offer_instructions[0]?.projection,
    sourceOffer.projection,
  );
  assert.notEqual(
    args._store_instructions[0]?.projection?.metadata,
    sourceStore.projection?.metadata,
  );
  assert.notEqual(
    args._store_instructions[0]?.projection?.shippingRegions,
    sourceStore.projection?.shippingRegions,
  );
  assert.notEqual(
    args._offer_instructions[0]?.projection?.metadata,
    sourceOffer.projection?.metadata,
  );
  assert.deepEqual(
    args._store_instructions[0]?.projection?.shippingRegions,
    [],
  );
});

test("prepared RPC state is snapshotted before the asynchronous digest", async () => {
  const plan = readyPlan();
  const canonicalMaterial = plan.canonicalPlanMaterialString;
  const sourceStore = plan.storeInstructions.find((entry) =>
    entry.action === "create"
  );
  const sourceOffer = plan.offerInstructions.find((entry) =>
    entry.action === "create"
  );
  if (
    !sourceStore || sourceStore.action !== "create" ||
    !sourceStore.projection ||
    !sourceOffer || sourceOffer.action !== "create" || !sourceOffer.projection
  ) throw new Error("fixture_invalid");
  const pending = preparePersistenceExecution(plan, TRIGGERED_BY);

  sourceStore.projection.name = "Mutated after snapshot";
  sourceStore.projection.metadata.campaignId = "mutated-campaign";
  (sourceStore.projection.shippingRegions as unknown[]).push("mutated-region");
  sourceOffer.projection.title = "Mutated after snapshot";
  sourceOffer.projection.metadata.resolvedCampaignId = "mutated-campaign";
  plan.integrationId = "55555555-5555-4555-8555-555555555555";
  plan.evaluationTimestamp = "2030-01-01T00:00:00.000Z";
  plan.counts.stores.create = 99;
  plan.storeInstructions.length = 0;
  plan.offerInstructions.length = 0;

  const args = persistenceRpcArgs(await pending);
  assert.equal(args._integration_id, INTEGRATION_ID);
  assert.equal(args._evaluation_timestamp, EVALUATION_TIMESTAMP);
  assert.equal(args._expected_counts.stores.create, 1);
  assert.equal(args._store_instructions.length, 2);
  assert.equal(args._offer_instructions.length, 2);
  assert.equal(args._store_instructions[0]?.projection?.name, "Alpha Store");
  assert.equal(
    args._store_instructions[0]?.projection?.metadata.campaignId,
    "campaign-a",
  );
  assert.deepEqual(
    args._store_instructions[0]?.projection?.shippingRegions,
    [],
  );
  assert.equal(
    args._offer_instructions[0]?.projection?.title,
    "Ten percent off",
  );
  assert.equal(
    args._offer_instructions[0]?.projection?.metadata.resolvedCampaignId,
    "campaign-a",
  );
  assert.equal(args._plan_fingerprint, await sha256Hex(canonicalMaterial));
});

test("blocked and malformed plans cannot become prepared executions", async () => {
  await assert.rejects(
    preparePersistenceExecution(blockedPlan(), TRIGGERED_BY),
    /persistence_execution_plan_blocked/,
  );

  const malformed = readyPlan();
  malformed.canonicalPlanMaterialString = "{}";
  await assert.rejects(
    preparePersistenceExecution(malformed, TRIGGERED_BY),
    /persistence_plan_material_string_mismatch/,
  );

  const wrongContract = readyPlan();
  (
    wrongContract as unknown as Record<string, unknown>
  ).persistenceContractVersion = "v2-untrusted";
  await assert.rejects(
    preparePersistenceExecution(wrongContract, TRIGGERED_BY),
    /persistence_execution_invalid_contract_version/,
  );
});

test("coercible top-level values are rejected before JSON or string conversion", async () => {
  const cases: Array<{
    name: string;
    code: RegExp;
    represented: (plan: PersistencePlanV2) => string;
    mutate: (
      plan: PersistencePlanV2,
      carrier: Record<PropertyKey, unknown>,
    ) => unknown;
  }> = [
    {
      name: "persistence contract version",
      code: /persistence_execution_invalid_contract_version/,
      represented: () => PERSISTENCE_CONTRACT_VERSION_V2,
      mutate: (plan, carrier) => {
        (plan as unknown as Record<string, unknown>)
          .persistenceContractVersion = carrier;
        return TRIGGERED_BY;
      },
    },
    {
      name: "provider",
      code: /persistence_execution_invalid_provider/,
      represented: () => "impact",
      mutate: (plan, carrier) => {
        (plan as unknown as Record<string, unknown>).provider = carrier;
        return TRIGGERED_BY;
      },
    },
    {
      name: "integration id",
      code: /persistence_execution_invalid_integration_id/,
      represented: () => INTEGRATION_ID,
      mutate: (plan, carrier) => {
        (plan as unknown as Record<string, unknown>).integrationId = carrier;
        return TRIGGERED_BY;
      },
    },
    {
      name: "evaluation timestamp",
      code: /persistence_execution_invalid_evaluation_timestamp/,
      represented: () => EVALUATION_TIMESTAMP,
      mutate: (plan, carrier) => {
        (plan as unknown as Record<string, unknown>).evaluationTimestamp =
          carrier;
        return TRIGGERED_BY;
      },
    },
    {
      name: "canonical material string",
      code: /persistence_execution_invalid_hash_material/,
      represented: (plan) => plan.canonicalPlanMaterialString,
      mutate: (plan, carrier) => {
        (plan as unknown as Record<string, unknown>)
          .canonicalPlanMaterialString = carrier;
        return TRIGGERED_BY;
      },
    },
    {
      name: "triggered by",
      code: /persistence_execution_invalid_triggered_by/,
      represented: () => TRIGGERED_BY,
      mutate: (_plan, carrier) => carrier,
    },
  ];

  for (const entry of cases) {
    let conversions = 0;
    const plan = readyPlan();
    const represented = entry.represented(plan);
    const carrier: Record<PropertyKey, unknown> = {
      toJSON() {
        conversions += 1;
        return represented;
      },
      toString() {
        conversions += 1;
        return represented;
      },
      [Symbol.toPrimitive]() {
        conversions += 1;
        return represented;
      },
    };
    const triggeredBy = entry.mutate(plan, carrier);
    await assert.rejects(
      preparePersistenceExecution(plan, triggeredBy as string),
      entry.code,
      entry.name,
    );
    assert.equal(conversions, 0, `${entry.name} was coerced before rejection`);
  }

  let getterReads = 0;
  const accessorPlan = readyPlan();
  Object.defineProperty(accessorPlan, "integrationId", {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      return INTEGRATION_ID;
    },
  });
  await assert.rejects(
    preparePersistenceExecution(accessorPlan, TRIGGERED_BY),
    /persistence_execution_invalid_integration_id/,
  );
  assert.equal(getterReads, 0, "top-level accessor was invoked");
});

test("a mutable aliased offer identity cannot cross the primitive boundary", async () => {
  let identityValue = "promotion-a";
  const identity = {
    length: identityValue.length,
    trim() {
      return this;
    },
    toJSON() {
      return identityValue;
    },
    [Symbol.toPrimitive]() {
      return identityValue;
    },
  };
  const base = readyPlan();
  const offerInstructions = offers();
  const create = offerInstructions[0];
  if (!create || create.action !== "create") throw new Error("fixture_invalid");
  const runtimeCreate = create as unknown as Record<string, unknown>;
  runtimeCreate.promotionId = identity;
  runtimeCreate.providerEntityId = identity;
  const plan = finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions,
  });

  const pending = preparePersistenceExecution(plan, TRIGGERED_BY);
  identityValue = "promotion-mutated-after-prepare";
  await assert.rejects(
    pending,
    /persistence_execution_invalid_offer_identity/,
  );
});

test("a canonically self-consistent plan still requires an explicit valid timestamp", async () => {
  for (
    const evaluationTimestamp of [
      "not-a-timestamp",
      "2026-02-31T12:34:56.000Z",
      "2026-08-20",
    ]
  ) {
    const base = readyPlan();
    const malformed = finalize({
      ...base.canonicalPlanMaterial,
      evaluationTimestamp,
    });
    await assert.rejects(
      preparePersistenceExecution(malformed, TRIGGERED_BY),
      /persistence_execution_invalid_evaluation_timestamp/,
    );
  }
});

test("a crafted ready plan cannot bypass canonical provider identity", async () => {
  const base = readyPlan();
  const malformedStores = stores();
  const create = malformedStores[0];
  assert.equal(create?.action, "create");
  if (!create || create.action !== "create") throw new Error("fixture_invalid");
  create.providerStoreKey.id = " campaign-a ";
  create.providerEntityId = " campaign-a ";
  if (create.projection) {
    create.projection.metadata.campaignId = " campaign-a ";
  }
  const malformed = finalize({
    ...base.canonicalPlanMaterial,
    storeInstructions: malformedStores,
    offerInstructions: [],
    counts: {
      ...counts(),
      offers: {
        create: 0,
        noopExisting: 0,
        noopHeld: 0,
        noopUnresolved: 0,
      },
      writableOffers: 0,
      writableEntities: 1,
    },
  });

  await assert.rejects(
    preparePersistenceExecution(malformed, TRIGGERED_BY),
    /persistence_execution_invalid_store_identity/,
  );
});

test("malformed executable projections are rejected after core validation", async () => {
  const base = readyPlan();
  const malformedStores = stores();
  const create = malformedStores[0];
  assert.equal(create?.action, "create");
  if (!create || create.action !== "create") throw new Error("fixture_invalid");
  create.projection = null;
  const malformed = finalize({
    ...base.canonicalPlanMaterial,
    storeInstructions: malformedStores,
  });

  await assert.rejects(
    preparePersistenceExecution(malformed, TRIGGERED_BY),
    /persistence_execution_invalid_store_create/,
  );
});

test("store projections are rejected instead of normalized or type-coerced", async () => {
  const cases: Array<{
    name: string;
    mutate: (projection: Record<string, unknown>) => void;
  }> = [
    {
      name: "nonempty shipping regions",
      mutate: (projection) => {
        projection.shippingRegions = ["unexpected"];
      },
    },
    {
      name: "numeric name",
      mutate: (projection) => {
        projection.name = 7;
      },
    },
    {
      name: "malformed metadata",
      mutate: (projection) => {
        projection.metadata = { advertiserId: null, campaignId: 7 };
      },
    },
    {
      name: "extra projection key",
      mutate: (projection) => {
        projection.untrustedExtra = true;
      },
    },
  ];

  for (const entry of cases) {
    await assert.rejects(
      preparePersistenceExecution(
        planWithStoreProjectionMutation(entry.mutate),
        TRIGGERED_BY,
      ),
      /persistence_execution_invalid_store_create/,
      entry.name,
    );
  }
});

test("offer projections require every exact A9C runtime field", async () => {
  const cases: Array<{
    name: string;
    mutate: (projection: Record<string, unknown>) => void;
  }> = [
    {
      name: "numeric title",
      mutate: (projection) => {
        projection.title = 7;
      },
    },
    {
      name: "wrong coupon type",
      mutate: (projection) => {
        projection.couponType = "deal";
      },
    },
    {
      name: "non-finite discount",
      mutate: (projection) => {
        projection.discountValue = Number.POSITIVE_INFINITY;
      },
    },
    {
      name: "malformed nested metadata",
      mutate: (projection) => {
        projection.metadata = {
          advertiserId: null,
          campaignId: "campaign-a",
          programId: null,
          resolvedCampaignId: 7,
        };
      },
    },
    {
      name: "extra metadata key",
      mutate: (projection) => {
        const metadata = projection.metadata as Record<string, unknown>;
        metadata.untrustedExtra = true;
      },
    },
  ];

  for (const entry of cases) {
    await assert.rejects(
      preparePersistenceExecution(
        planWithOfferProjectionMutation(entry.mutate),
        TRIGGERED_BY,
      ),
      /persistence_execution_invalid_offer_create/,
      entry.name,
    );
  }
});

test("deal create projections preserve the settled kind-specific fields", async () => {
  const base = readyPlan();
  const offerInstructions = offers();
  const create = offerInstructions[0];
  if (!create || create.action !== "create" || !create.projection) {
    throw new Error("fixture_invalid");
  }
  create.kind = "deal";
  create.projection.couponCode = null;
  create.projection.couponType = "deal";
  create.projection.terms = null;
  const plan = finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions,
  });
  const args = persistenceRpcArgs(
    await preparePersistenceExecution(plan, TRIGGERED_BY),
  );
  assert.deepEqual(args._offer_instructions[0]?.projection, create.projection);

  const malformedInstructions = offers();
  const malformedCreate = malformedInstructions[0];
  if (
    !malformedCreate || malformedCreate.action !== "create" ||
    !malformedCreate.projection
  ) throw new Error("fixture_invalid");
  malformedCreate.kind = "deal";
  malformedCreate.projection.couponCode = null;
  malformedCreate.projection.couponType = "deal";
  malformedCreate.projection.terms = "not valid for a deal";
  const malformed = finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions: malformedInstructions,
  });
  await assert.rejects(
    preparePersistenceExecution(malformed, TRIGGERED_BY),
    /persistence_execution_invalid_offer_create/,
  );
});

test("executable planner-only identity fields are validated before projection", async () => {
  const base = readyPlan();
  const noopStore = stores()[1];
  if (!noopStore || noopStore.action !== "noop_existing") {
    throw new Error("fixture_invalid");
  }
  noopStore.providerStoreKey.namespace = "advertiser" as "campaign";
  const malformedStorePlan = finalize({
    ...base.canonicalPlanMaterial,
    storeInstructions: [noopStore],
    offerInstructions: [],
    counts: {
      stores: {
        create: 0,
        noopExisting: 1,
        blockedAmbiguous: 0,
        noopUnmatched: 0,
      },
      offers: {
        create: 0,
        noopExisting: 0,
        noopHeld: 0,
        noopUnresolved: 0,
      },
      writableStores: 0,
      writableOffers: 0,
      writableEntities: 0,
    },
  });
  await assert.rejects(
    preparePersistenceExecution(malformedStorePlan, TRIGGERED_BY),
    /persistence_execution_invalid_store_identity/,
  );

  const offerInstructions = offers();
  const createOffer = offerInstructions[0];
  if (!createOffer || createOffer.action !== "create") {
    throw new Error("fixture_invalid");
  }
  (createOffer as unknown as Record<string, unknown>).selected = false;
  const malformedOfferPlan = finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions,
  });
  await assert.rejects(
    preparePersistenceExecution(malformedOfferPlan, TRIGGERED_BY),
    /persistence_execution_invalid_offer_identity/,
  );
});

test("duplicate executable provider identities cannot reach RPC material", async () => {
  const base = readyPlan();
  const duplicateOffers = offers();
  const noopOffer = duplicateOffers[1];
  if (!noopOffer || noopOffer.action !== "noop_existing") {
    throw new Error("fixture_invalid");
  }
  noopOffer.promotionId = "promotion-a";
  noopOffer.providerEntityId = "promotion-a";
  const duplicateOfferPlan = finalize({
    ...base.canonicalPlanMaterial,
    offerInstructions: duplicateOffers,
  });
  await assert.rejects(
    preparePersistenceExecution(duplicateOfferPlan, TRIGGERED_BY),
    /persistence_execution_duplicate_offer_identity/,
  );

  const duplicateStores = stores();
  const noopStore = duplicateStores[1];
  if (!noopStore || noopStore.action !== "noop_existing") {
    throw new Error("fixture_invalid");
  }
  noopStore.providerStoreKey.id = "campaign-a";
  noopStore.providerEntityId = "campaign-a";
  const duplicateStorePlan = finalize({
    ...base.canonicalPlanMaterial,
    storeInstructions: duplicateStores,
  });
  await assert.rejects(
    preparePersistenceExecution(duplicateStorePlan, TRIGGERED_BY),
    /persistence_plan_duplicate_parent|persistence_execution_duplicate_store_identity/,
  );
});

test("prepared capability and all nested RPC material are runtime-readonly", async () => {
  const prepared = await preparePersistenceExecution(readyPlan(), TRIGGERED_BY);
  const args = persistenceRpcArgs(prepared);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(args), true);
  assert.equal(Object.isFrozen(args._expected_counts), true);
  assert.equal(Object.isFrozen(args._expected_counts.stores), true);
  assert.equal(Object.isFrozen(args._store_instructions), true);
  assert.equal(Object.isFrozen(args._store_instructions[0]), true);
  assert.equal(
    Object.isFrozen(args._store_instructions[0]?.projection?.metadata),
    true,
  );
  assert.equal(
    Object.isFrozen(
      args._store_instructions[0]?.projection?.shippingRegions,
    ),
    true,
  );
  assert.equal(Object.isFrozen(args._offer_instructions), true);
  assert.equal(Object.isFrozen(args._offer_instructions[0]), true);
  assert.equal(
    Object.isFrozen(args._offer_instructions[0]?.projection?.metadata),
    true,
  );
});

test("arbitrary objects cannot cross the opaque prepared boundary", () => {
  assert.throws(
    () => persistenceRpcArgs({} as PreparedPersistenceExecutionV2),
    /persistence_execution_not_prepared/,
  );
});
