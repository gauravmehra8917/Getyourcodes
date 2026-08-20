import { validatePersistencePlanV2 } from "../_shared/affiliate-sync-v2/PersistencePlannerV2.ts";
import {
  type OfferCreateProjectionV2,
  PERSISTENCE_CONTRACT_VERSION_V2,
  type PersistenceOfferInstructionV2,
  type PersistencePlanCountsV2,
  type PersistencePlanV2,
  type PersistenceStoreInstructionV2,
  type StoreCreateProjectionV2,
} from "../_shared/affiliate-sync-v2/persistence-models.ts";

export const PLAN_FINGERPRINT_ALGORITHM_V2 =
  "sha256-canonical-plan-v1" as const;

type ExecutableStoreInstructionV2 = Extract<
  PersistenceStoreInstructionV2,
  { action: "create" | "noop_existing" }
>;

type ExecutableOfferInstructionV2 = Extract<
  PersistenceOfferInstructionV2,
  { action: "create" | "noop_existing" }
>;

export interface PersistenceRpcExpectedCountsV2 {
  readonly stores: {
    readonly create: number;
    readonly noopExisting: number;
    readonly blockedAmbiguous: number;
    readonly noopUnmatched: number;
  };
  readonly offers: {
    readonly create: number;
    readonly noopExisting: number;
    readonly noopHeld: number;
    readonly noopUnresolved: number;
  };
  readonly writableStores: number;
  readonly writableOffers: number;
  readonly writableEntities: number;
}

interface PersistenceRpcStoreCreateProjectionV2 {
  readonly name: string;
  readonly slugCandidate: string;
  readonly description: null;
  readonly affiliateUrl: string | null;
  readonly destinationUrl: string | null;
  readonly country: null;
  readonly shippingRegions: readonly [];
  readonly logoSourceUrl: null;
  readonly metadata: {
    readonly advertiserId: string | null;
    readonly campaignId: string;
  };
  readonly importOrigin: "provider";
  readonly lifecycleManaged: true;
  readonly lifecycleHidden: false;
  readonly lastQualificationResult: "qualified";
  readonly lastQualifiedAt: string;
}

interface PersistenceRpcOfferCreateProjectionV2 {
  readonly title: string;
  readonly description: string | null;
  readonly couponCode: string | null;
  readonly couponType: "code" | "deal";
  readonly affiliateUrl: string | null;
  readonly landingPageUrl: null;
  readonly startDate: string | null;
  readonly expiryDate: string | null;
  readonly status: "active";
  readonly terms: string | null;
  readonly discountType: string | null;
  readonly discountValue: number | null;
  readonly metadata: {
    readonly advertiserId: string | null;
    readonly campaignId: string | null;
    readonly programId: string | null;
    readonly resolvedCampaignId: string;
  };
}

export interface PersistenceRpcStoreInstructionV2 {
  readonly instructionOrdinal: number;
  readonly action: "create" | "noop_existing";
  readonly provider: "impact";
  readonly providerEntityId: string;
  readonly expectedExistingStoreId: string | null;
  readonly qualified: boolean;
  readonly projection: PersistenceRpcStoreCreateProjectionV2 | null;
}

export interface PersistenceRpcOfferInstructionV2 {
  readonly instructionOrdinal: number;
  readonly action: "create" | "noop_existing";
  readonly provider: "impact";
  readonly providerEntityId: string;
  readonly kind: "coupon" | "deal";
  readonly existingOfferId: string | null;
  readonly parentProviderEntityId: string;
  readonly expectedParentStoreId: string | null;
  readonly projection: PersistenceRpcOfferCreateProjectionV2 | null;
}

export interface ApplyAffiliatePersistencePlanV2ArgsV2 {
  readonly _integration_id: string;
  readonly _provider: "impact";
  readonly _persistence_contract_version:
    typeof PERSISTENCE_CONTRACT_VERSION_V2;
  readonly _plan_fingerprint_algorithm: typeof PLAN_FINGERPRINT_ALGORITHM_V2;
  readonly _plan_fingerprint: string;
  readonly _evaluation_timestamp: string;
  readonly _triggered_by: string;
  readonly _expected_counts: PersistenceRpcExpectedCountsV2;
  readonly _store_instructions: readonly PersistenceRpcStoreInstructionV2[];
  readonly _offer_instructions: readonly PersistenceRpcOfferInstructionV2[];
}

const preparedExecutionBrand: unique symbol = Symbol(
  "affiliate-sync-v2-prepared-execution",
);
const preparedExecutionRpcArgs: unique symbol = Symbol(
  "affiliate-sync-v2-prepared-execution-rpc-args",
);

/** Opaque host-only capability coupling one validated plan to one fingerprint. */
export interface PreparedPersistenceExecutionV2 {
  readonly [preparedExecutionBrand]: true;
  readonly [preparedExecutionRpcArgs]: ApplyAffiliatePersistencePlanV2ArgsV2;
}

interface PersistenceExecutionSnapshotV2 {
  readonly integrationId: string;
  readonly provider: "impact";
  readonly persistenceContractVersion: typeof PERSISTENCE_CONTRACT_VERSION_V2;
  readonly planFingerprintAlgorithm: typeof PLAN_FINGERPRINT_ALGORITHM_V2;
  readonly evaluationTimestamp: string;
  readonly triggeredBy: string;
  readonly expectedCounts: PersistenceRpcExpectedCountsV2;
  readonly storeInstructions: readonly PersistenceRpcStoreInstructionV2[];
  readonly offerInstructions: readonly PersistenceRpcOfferInstructionV2[];
  readonly canonicalPlanMaterialString: string;
}

interface PersistenceExecutionPrimitiveInputsV2 {
  readonly integrationId: string;
  readonly provider: "impact";
  readonly persistenceContractVersion: typeof PERSISTENCE_CONTRACT_VERSION_V2;
  readonly evaluationTimestamp: string;
  readonly triggeredBy: string;
  readonly canonicalPlanMaterialString: string;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const EXPLICIT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function assertion(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function ownDataProperty(
  value: object,
  key: string,
  code: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  assertion(descriptor !== undefined && "value" in descriptor, code);
  return descriptor.value;
}

function capturePrimitiveExecutionInputs(
  plan: PersistencePlanV2,
  triggeredBy: string,
): PersistenceExecutionPrimitiveInputsV2 {
  const persistenceContractVersion = ownDataProperty(
    plan,
    "persistenceContractVersion",
    "persistence_execution_invalid_contract_version",
  );
  const provider = ownDataProperty(
    plan,
    "provider",
    "persistence_execution_invalid_provider",
  );
  const integrationId = ownDataProperty(
    plan,
    "integrationId",
    "persistence_execution_invalid_integration_id",
  );
  const evaluationTimestamp = ownDataProperty(
    plan,
    "evaluationTimestamp",
    "persistence_execution_invalid_evaluation_timestamp",
  );
  const canonicalPlanMaterialString = ownDataProperty(
    plan,
    "canonicalPlanMaterialString",
    "persistence_execution_invalid_hash_material",
  );
  assertion(
    typeof persistenceContractVersion === "string" &&
      persistenceContractVersion === PERSISTENCE_CONTRACT_VERSION_V2,
    "persistence_execution_invalid_contract_version",
  );
  assertion(
    typeof provider === "string" && provider === "impact",
    "persistence_execution_invalid_provider",
  );
  assertion(
    typeof integrationId === "string" && UUID_PATTERN.test(integrationId),
    "persistence_execution_invalid_integration_id",
  );
  assertion(
    typeof evaluationTimestamp === "string" &&
      validEvaluationTimestamp(evaluationTimestamp),
    "persistence_execution_invalid_evaluation_timestamp",
  );
  assertion(
    typeof canonicalPlanMaterialString === "string",
    "persistence_execution_invalid_hash_material",
  );
  assertion(
    typeof triggeredBy === "string" && UUID_PATTERN.test(triggeredBy),
    "persistence_execution_invalid_triggered_by",
  );
  return Object.freeze({
    integrationId,
    provider,
    persistenceContractVersion,
    evaluationTimestamp,
    triggeredBy,
    canonicalPlanMaterialString,
  });
}

function validEvaluationTimestamp(value: string): boolean {
  const match = EXPLICIT_TIMESTAMP_PATTERN.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function canonicalProviderId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value === value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function canonicalNullableString(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && canonicalProviderId(value));
}

function validCampaignProviderStoreKey(
  value: unknown,
): value is {
  provider: "impact";
  namespace: "campaign";
  id: string;
} {
  return isRecord(value) &&
    hasExactKeys(value, ["provider", "namespace", "id"]) &&
    value.provider === "impact" && value.namespace === "campaign" &&
    typeof value.id === "string" && canonicalProviderId(value.id);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function sameInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function validStoreCreateProjection(
  value: unknown,
  providerEntityId: string,
  evaluationTimestamp: string,
): value is StoreCreateProjectionV2 {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "name",
      "slugCandidate",
      "description",
      "affiliateUrl",
      "destinationUrl",
      "country",
      "shippingRegions",
      "logoSourceUrl",
      "metadata",
      "importOrigin",
      "lifecycleManaged",
      "lifecycleHidden",
      "lastQualificationResult",
      "lastQualifiedAt",
    ]) || !isRecord(value.metadata) ||
    !hasExactKeys(value.metadata, ["advertiserId", "campaignId"])
  ) return false;

  return typeof value.name === "string" && canonicalProviderId(value.name) &&
    typeof value.slugCandidate === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slugCandidate) &&
    value.slugCandidate.length <= 80 && value.description === null &&
    canonicalNullableString(value.affiliateUrl) &&
    canonicalNullableString(value.destinationUrl) && value.country === null &&
    Array.isArray(value.shippingRegions) &&
    value.shippingRegions.length === 0 &&
    value.logoSourceUrl === null &&
    canonicalNullableString(value.metadata.advertiserId) &&
    value.metadata.campaignId === providerEntityId &&
    value.importOrigin === "provider" && value.lifecycleManaged === true &&
    value.lifecycleHidden === false &&
    value.lastQualificationResult === "qualified" &&
    typeof value.lastQualifiedAt === "string" &&
    validEvaluationTimestamp(value.lastQualifiedAt) &&
    sameInstant(value.lastQualifiedAt, evaluationTimestamp);
}

function validOfferCreateProjection(
  value: unknown,
  kind: "coupon" | "deal",
  parentProviderEntityId: string,
): value is OfferCreateProjectionV2 {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "title",
      "description",
      "couponCode",
      "couponType",
      "affiliateUrl",
      "landingPageUrl",
      "startDate",
      "expiryDate",
      "status",
      "terms",
      "discountType",
      "discountValue",
      "metadata",
    ]) || !isRecord(value.metadata) ||
    !hasExactKeys(value.metadata, [
      "advertiserId",
      "campaignId",
      "programId",
      "resolvedCampaignId",
    ])
  ) return false;

  const couponFieldsValid = kind === "coupon"
    ? typeof value.couponCode === "string" &&
      canonicalProviderId(value.couponCode) && value.couponType === "code"
    : value.couponCode === null && value.couponType === "deal" &&
      value.terms === null;
  return typeof value.title === "string" && canonicalProviderId(value.title) &&
    canonicalNullableString(value.description) && couponFieldsValid &&
    canonicalNullableString(value.affiliateUrl) &&
    value.landingPageUrl === null &&
    (value.startDate === null || validIsoDate(value.startDate)) &&
    (value.expiryDate === null || validIsoDate(value.expiryDate)) &&
    value.status === "active" && canonicalNullableString(value.terms) &&
    canonicalNullableString(value.discountType) &&
    (value.discountValue === null ||
      (typeof value.discountValue === "number" &&
        Number.isFinite(value.discountValue))) &&
    canonicalNullableString(value.metadata.advertiserId) &&
    canonicalNullableString(value.metadata.campaignId) &&
    canonicalNullableString(value.metadata.programId) &&
    value.metadata.resolvedCampaignId === parentProviderEntityId;
}

function copyCounts(
  counts: PersistencePlanCountsV2,
): PersistenceRpcExpectedCountsV2 {
  const stores = Object.freeze({
    create: counts.stores.create,
    noopExisting: counts.stores.noopExisting,
    blockedAmbiguous: counts.stores.blockedAmbiguous,
    noopUnmatched: counts.stores.noopUnmatched,
  });
  const offers = Object.freeze({
    create: counts.offers.create,
    noopExisting: counts.offers.noopExisting,
    noopHeld: counts.offers.noopHeld,
    noopUnresolved: counts.offers.noopUnresolved,
  });
  return Object.freeze({
    stores,
    offers,
    writableStores: counts.writableStores,
    writableOffers: counts.writableOffers,
    writableEntities: counts.writableEntities,
  });
}

function copyStoreProjection(
  projection: StoreCreateProjectionV2,
): PersistenceRpcStoreCreateProjectionV2 {
  // Runtime validation proves this spread has exact tuple length zero.
  const shippingRegions = [...projection.shippingRegions] as [];
  return Object.freeze({
    name: projection.name,
    slugCandidate: projection.slugCandidate,
    description: projection.description,
    affiliateUrl: projection.affiliateUrl,
    destinationUrl: projection.destinationUrl,
    country: projection.country,
    shippingRegions: Object.freeze(shippingRegions),
    logoSourceUrl: projection.logoSourceUrl,
    metadata: Object.freeze({
      advertiserId: projection.metadata.advertiserId,
      campaignId: projection.metadata.campaignId,
    }),
    importOrigin: projection.importOrigin,
    lifecycleManaged: projection.lifecycleManaged,
    lifecycleHidden: projection.lifecycleHidden,
    lastQualificationResult: projection.lastQualificationResult,
    lastQualifiedAt: projection.lastQualifiedAt,
  });
}

function copyOfferProjection(
  projection: OfferCreateProjectionV2,
): PersistenceRpcOfferCreateProjectionV2 {
  return Object.freeze({
    title: projection.title,
    description: projection.description,
    couponCode: projection.couponCode,
    couponType: projection.couponType,
    affiliateUrl: projection.affiliateUrl,
    landingPageUrl: projection.landingPageUrl,
    startDate: projection.startDate,
    expiryDate: projection.expiryDate,
    status: projection.status,
    terms: projection.terms,
    discountType: projection.discountType,
    discountValue: projection.discountValue,
    metadata: Object.freeze({
      advertiserId: projection.metadata.advertiserId,
      campaignId: projection.metadata.campaignId,
      programId: projection.metadata.programId,
      resolvedCampaignId: projection.metadata.resolvedCampaignId,
    }),
  });
}

function projectStoreInstruction(
  instruction: ExecutableStoreInstructionV2,
  instructionOrdinal: number,
  evaluationTimestamp: string,
): PersistenceRpcStoreInstructionV2 {
  assertion(
    isRecord(instruction) &&
      hasExactKeys(instruction, [
        "action",
        "providerStoreKey",
        "provider",
        "providerEntityId",
        "expectedExistingStoreId",
        "qualified",
        "projection",
      ]) &&
      validCampaignProviderStoreKey(instruction.providerStoreKey) &&
      instruction.provider === "impact" &&
      instruction.providerEntityId === instruction.providerStoreKey.id &&
      canonicalProviderId(instruction.providerEntityId) &&
      typeof instruction.qualified === "boolean",
    "persistence_execution_invalid_store_identity",
  );
  if (instruction.action === "create") {
    assertion(
      instruction.expectedExistingStoreId === null &&
        instruction.qualified === true &&
        validStoreCreateProjection(
          instruction.projection,
          instruction.providerEntityId,
          evaluationTimestamp,
        ),
      "persistence_execution_invalid_store_create",
    );
    return Object.freeze({
      instructionOrdinal,
      action: instruction.action,
      provider: instruction.provider,
      providerEntityId: instruction.providerEntityId,
      expectedExistingStoreId: instruction.expectedExistingStoreId,
      qualified: instruction.qualified,
      projection: copyStoreProjection(instruction.projection),
    });
  }
  assertion(
    typeof instruction.expectedExistingStoreId === "string" &&
      UUID_PATTERN.test(instruction.expectedExistingStoreId) &&
      instruction.projection === null,
    "persistence_execution_invalid_existing_store",
  );
  return Object.freeze({
    instructionOrdinal,
    action: instruction.action,
    provider: instruction.provider,
    providerEntityId: instruction.providerEntityId,
    expectedExistingStoreId: instruction.expectedExistingStoreId,
    qualified: instruction.qualified,
    projection: null,
  });
}

function projectOfferInstruction(
  instruction: ExecutableOfferInstructionV2,
  instructionOrdinal: number,
  parent: ExecutableStoreInstructionV2 | undefined,
): PersistenceRpcOfferInstructionV2 {
  assertion(
    isRecord(instruction) &&
      hasExactKeys(instruction, [
        "action",
        "promotionId",
        "provider",
        "providerEntityId",
        "kind",
        "existingOfferId",
        "parentProviderStoreKey",
        "expectedParentStoreId",
        "selected",
        "projection",
      ]) &&
      instruction.provider === "impact" &&
      typeof instruction.providerEntityId === "string" &&
      typeof instruction.promotionId === "string" &&
      instruction.providerEntityId === instruction.promotionId &&
      canonicalProviderId(instruction.providerEntityId) &&
      validCampaignProviderStoreKey(instruction.parentProviderStoreKey) &&
      (instruction.kind === "coupon" || instruction.kind === "deal") &&
      instruction.selected === true,
    "persistence_execution_invalid_offer_identity",
  );
  assertion(
    parent !== undefined && parent.qualified === true &&
      (parent.action === "create"
        ? instruction.expectedParentStoreId === null
        : instruction.expectedParentStoreId === parent.expectedExistingStoreId),
    "persistence_execution_invalid_offer_parent",
  );
  if (instruction.action === "create") {
    assertion(
      instruction.existingOfferId === null &&
        validOfferCreateProjection(
          instruction.projection,
          instruction.kind,
          instruction.parentProviderStoreKey.id,
        ),
      "persistence_execution_invalid_offer_create",
    );
    return Object.freeze({
      instructionOrdinal,
      action: instruction.action,
      provider: instruction.provider,
      providerEntityId: instruction.providerEntityId,
      kind: instruction.kind,
      existingOfferId: instruction.existingOfferId,
      parentProviderEntityId: instruction.parentProviderStoreKey.id,
      expectedParentStoreId: instruction.expectedParentStoreId,
      projection: copyOfferProjection(instruction.projection),
    });
  }
  assertion(
    typeof instruction.existingOfferId === "string" &&
      UUID_PATTERN.test(instruction.existingOfferId) &&
      instruction.projection === null,
    "persistence_execution_invalid_existing_offer",
  );
  return Object.freeze({
    instructionOrdinal,
    action: instruction.action,
    provider: instruction.provider,
    providerEntityId: instruction.providerEntityId,
    kind: instruction.kind,
    existingOfferId: instruction.existingOfferId,
    parentProviderEntityId: instruction.parentProviderStoreKey.id,
    expectedParentStoreId: instruction.expectedParentStoreId,
    projection: null,
  });
}

/** Edge-native SHA-256 over the exact UTF-8 bytes of the supplied material. */
export async function sha256Hex(material: string): Promise<string> {
  assertion(
    typeof material === "string",
    "persistence_execution_invalid_hash_material",
  );
  assertion(
    globalThis.crypto?.subtle !== undefined,
    "persistence_execution_web_crypto_unavailable",
  );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function snapshotExecution(
  plan: PersistencePlanV2,
  primitives: PersistenceExecutionPrimitiveInputsV2,
): PersistenceExecutionSnapshotV2 {
  assertion(plan.status === "ready", "persistence_execution_plan_blocked");

  const executableStores = plan.storeInstructions.filter(
    (instruction): instruction is ExecutableStoreInstructionV2 =>
      instruction.action === "create" || instruction.action === "noop_existing",
  );
  const storeInstructions = Object.freeze(
    executableStores.map((instruction, index) =>
      projectStoreInstruction(
        instruction,
        index,
        primitives.evaluationTimestamp,
      )
    ),
  );
  assertion(
    plan.counts.stores.blockedAmbiguous === 0 &&
      storeInstructions.length ===
        plan.counts.stores.create + plan.counts.stores.noopExisting,
    "persistence_execution_invalid_store_counts",
  );
  assertion(
    new Set(
      storeInstructions.map((instruction) => instruction.providerEntityId),
    ).size === storeInstructions.length,
    "persistence_execution_duplicate_store_identity",
  );
  const executableStoreById = new Map(
    executableStores.map((instruction) => [
      instruction.providerEntityId,
      instruction,
    ]),
  );
  const executableOffers = plan.offerInstructions.filter(
    (instruction): instruction is ExecutableOfferInstructionV2 =>
      instruction.action === "create" || instruction.action === "noop_existing",
  );
  const offerInstructions = Object.freeze(
    executableOffers.map((instruction, index) =>
      projectOfferInstruction(
        instruction,
        storeInstructions.length + index,
        executableStoreById.get(instruction.parentProviderStoreKey.id),
      )
    ),
  );
  assertion(
    offerInstructions.length ===
      plan.counts.offers.create + plan.counts.offers.noopExisting,
    "persistence_execution_invalid_offer_counts",
  );
  assertion(
    new Set(
      offerInstructions.map((instruction) => instruction.providerEntityId),
    ).size === offerInstructions.length,
    "persistence_execution_duplicate_offer_identity",
  );

  return Object.freeze({
    integrationId: primitives.integrationId,
    provider: primitives.provider,
    persistenceContractVersion: primitives.persistenceContractVersion,
    planFingerprintAlgorithm: PLAN_FINGERPRINT_ALGORITHM_V2,
    evaluationTimestamp: primitives.evaluationTimestamp,
    triggeredBy: primitives.triggeredBy,
    expectedCounts: copyCounts(plan.counts),
    storeInstructions,
    offerInstructions,
    canonicalPlanMaterialString: primitives.canonicalPlanMaterialString,
  });
}

/**
 * Validates and snapshots one ready plan before the asynchronous hash boundary.
 * Every RPC argument is consequently coupled to the exact material being hashed.
 */
export async function preparePersistenceExecution(
  plan: PersistencePlanV2,
  triggeredBy: string,
): Promise<PreparedPersistenceExecutionV2> {
  const primitives = capturePrimitiveExecutionInputs(plan, triggeredBy);
  validatePersistencePlanV2(plan);
  const snapshot = snapshotExecution(plan, primitives);
  const planFingerprint = await sha256Hex(
    snapshot.canonicalPlanMaterialString,
  );
  assertion(
    /^[0-9a-f]{64}$/.test(planFingerprint),
    "persistence_execution_invalid_fingerprint",
  );

  const rpcArgs: ApplyAffiliatePersistencePlanV2ArgsV2 = Object.freeze({
    _integration_id: snapshot.integrationId,
    _provider: snapshot.provider,
    _persistence_contract_version: snapshot.persistenceContractVersion,
    _plan_fingerprint_algorithm: snapshot.planFingerprintAlgorithm,
    _plan_fingerprint: planFingerprint,
    _evaluation_timestamp: snapshot.evaluationTimestamp,
    _triggered_by: snapshot.triggeredBy,
    _expected_counts: snapshot.expectedCounts,
    _store_instructions: snapshot.storeInstructions,
    _offer_instructions: snapshot.offerInstructions,
  });

  const prepared: PreparedPersistenceExecutionV2 = {
    [preparedExecutionBrand]: true,
    [preparedExecutionRpcArgs]: rpcArgs,
  };
  return Object.freeze(prepared);
}

/** The persistence boundary accepts only the opaque prepared capability. */
export function persistenceRpcArgs(
  prepared: PreparedPersistenceExecutionV2,
): ApplyAffiliatePersistencePlanV2ArgsV2 {
  assertion(
    prepared?.[preparedExecutionBrand] === true,
    "persistence_execution_not_prepared",
  );
  return prepared[preparedExecutionRpcArgs];
}
