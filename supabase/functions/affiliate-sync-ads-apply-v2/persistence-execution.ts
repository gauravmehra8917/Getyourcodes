import type {
  AdsOfferCreateProjectionV2,
  AdsPersistenceOfferInstructionV2,
  AdsPersistencePlanCountsV2,
  AdsPersistencePlanV2,
  AdsPersistenceStoreInstructionV2,
  AdsStoreCreateProjectionV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/index.ts";
import { ADS_PERSISTENCE_CONTRACT_VERSION_V2 } from "../_shared/affiliate-sync-v2-ads-persistence/index.ts";

export const ADS_PLAN_FINGERPRINT_ALGORITHM_V2 =
  "sha256-canonical-plan-v1" as const;

type ExecutableStoreInstructionV2 = Extract<
  AdsPersistenceStoreInstructionV2,
  { action: "create" | "noop_existing" }
>;
type ExecutableOfferInstructionV2 = Extract<
  AdsPersistenceOfferInstructionV2,
  { action: "create" | "noop_existing" }
>;

export interface AdsPersistenceRpcStoreInstructionV2 {
  readonly instructionOrdinal: number;
  readonly action: "create" | "noop_existing";
  readonly provider: "impact";
  readonly providerEntityNamespace: "campaign";
  readonly providerEntityId: string;
  readonly expectedExistingStoreId: string | null;
  readonly qualified: true;
  readonly projection: AdsStoreCreateProjectionV2 | null;
}

export interface AdsPersistenceRpcOfferInstructionV2 {
  readonly instructionOrdinal: number;
  readonly action: "create" | "noop_existing";
  readonly provider: "impact";
  readonly providerEntityNamespace: "ad";
  readonly providerEntityId: string;
  readonly kind: "coupon";
  readonly existingOfferId: string | null;
  readonly parentProviderEntityNamespace: "campaign";
  readonly parentProviderEntityId: string;
  readonly expectedParentStoreId: string | null;
  readonly projection: AdsOfferCreateProjectionV2 | null;
}

export interface ApplyAffiliateAdsPersistencePlanV2Args {
  readonly _integration_id: string;
  readonly _provider: "impact";
  readonly _persistence_contract_version:
    typeof ADS_PERSISTENCE_CONTRACT_VERSION_V2;
  readonly _plan_fingerprint_algorithm:
    typeof ADS_PLAN_FINGERPRINT_ALGORITHM_V2;
  readonly _plan_fingerprint: string;
  readonly _evaluation_timestamp: string;
  readonly _triggered_by: string;
  readonly _expected_counts: AdsPersistencePlanCountsV2;
  readonly _store_instructions: readonly AdsPersistenceRpcStoreInstructionV2[];
  readonly _offer_instructions: readonly AdsPersistenceRpcOfferInstructionV2[];
}

const preparedBrand: unique symbol = Symbol(
  "affiliate-sync-ads-v2-prepared-execution",
);
const preparedArgs: unique symbol = Symbol(
  "affiliate-sync-ads-v2-prepared-execution-args",
);

/** Opaque host-only capability. No caller-supplied RPC material is accepted. */
export interface PreparedAdsPersistenceExecutionV2 {
  readonly [preparedBrand]: true;
  readonly [preparedArgs]: ApplyAffiliateAdsPersistencePlanV2Args;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPLICIT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PROVIDER_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVALID_COUPON_CODES = new Set([
  "n/a",
  "none",
  "no code",
  "null",
  "undefined",
]);

function assertion(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
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

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = EXPLICIT_TIMESTAMP_PATTERN.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] ?? 0);
}

function validCalendarDateParts(
  year: number,
  month: number,
  day: number,
): boolean {
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] ?? 0);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value;
}

function validProviderDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value !== value.trim()) return false;
  if (validIsoDate(value)) return true;
  const match = PROVIDER_TIMESTAMP_PATTERN.exec(value);
  return match !== null &&
    validCalendarDateParts(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ) &&
    Number.isFinite(Date.parse(value));
}

function canonicalText(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && value === value.trim();
}

function nullableText(
  value: unknown,
  maximum = 20_000,
): value is string | null {
  return value === null || canonicalText(value, maximum);
}

function validCouponCode(value: unknown): value is string {
  return canonicalText(value, 2_000) &&
    !INVALID_COUPON_CODES.has(value.toLowerCase());
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validHttpUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (!canonicalText(value, 8_192)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && url.origin !== "null";
  } catch {
    return false;
  }
}

function validStoreKey(value: unknown, id: string): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["provider", "namespace", "id"]) &&
    value.provider === "impact" && value.namespace === "campaign" &&
    value.id === id;
}

function validAdKey(value: unknown, id: string): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["provider", "namespace", "id"]) &&
    value.provider === "impact" && value.namespace === "ad" && value.id === id;
}

function validCounts(value: unknown): value is AdsPersistencePlanCountsV2 {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "stores",
      "offers",
      "writableStores",
      "writableOffers",
      "writableEntities",
    ]) || !isRecord(value.stores) || !hasExactKeys(value.stores, [
      "create",
      "noopExisting",
      "blockedAmbiguous",
      "noopUnmatched",
    ]) || !isRecord(value.offers) || !hasExactKeys(value.offers, [
      "create",
      "noopExisting",
      "noopHeld",
      "noopUnresolved",
    ])
  ) return false;
  const numbers = [
    value.stores.create,
    value.stores.noopExisting,
    value.stores.blockedAmbiguous,
    value.stores.noopUnmatched,
    value.offers.create,
    value.offers.noopExisting,
    value.offers.noopHeld,
    value.offers.noopUnresolved,
    value.writableStores,
    value.writableOffers,
    value.writableEntities,
  ];
  if (
    !numbers.every((entry) =>
      typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0
    )
  ) return false;
  const writableStores = value.writableStores as number;
  const writableOffers = value.writableOffers as number;
  return value.stores.blockedAmbiguous === 0 &&
    writableStores === value.stores.create &&
    writableOffers === value.offers.create &&
    value.writableEntities === writableStores + writableOffers;
}

function copyCounts(
  value: AdsPersistencePlanCountsV2,
): AdsPersistencePlanCountsV2 {
  return Object.freeze({
    stores: Object.freeze({ ...value.stores }),
    offers: Object.freeze({ ...value.offers }),
    writableStores: value.writableStores,
    writableOffers: value.writableOffers,
    writableEntities: value.writableEntities,
  });
}

function validStructuredTerms(value: unknown): boolean {
  if (value === null) return true;
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "minimumPurchase",
      "maximumSavings",
      "purchaseLimit",
      "scope",
      "currency",
      "text",
    ])
  ) return false;
  return [value.minimumPurchase, value.maximumSavings]
    .every((entry) =>
      entry === null ||
      (typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
    ) &&
    (value.purchaseLimit === null ||
      (typeof value.purchaseLimit === "number" &&
        Number.isFinite(value.purchaseLimit) && value.purchaseLimit > 0)) &&
    nullableText(value.scope, 2_000) && nullableText(value.text, 20_000) &&
    (value.currency === null ||
      (typeof value.currency === "string" &&
        /^[A-Z]{3}$/.test(value.currency)));
}

function validStoreProjection(
  value: unknown,
  campaignId: string,
  evaluationTimestamp: string,
): value is AdsStoreCreateProjectionV2 {
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
      "seoTitle",
      "seoDescription",
      "seoCanonicalUrl",
    ]) || !isRecord(value.metadata) || !hasExactKeys(value.metadata, [
      "advertiserId",
      "campaignId",
      "campaignName",
      "destinationUrl",
      "trackingUrl",
    ])
  ) return false;
  return canonicalText(value.name, 1_000) &&
    canonicalText(value.slugCandidate, 80) &&
    SLUG_PATTERN.test(value.slugCandidate) &&
    value.description === null && validHttpUrl(value.affiliateUrl) &&
    validHttpUrl(value.destinationUrl) &&
    value.affiliateUrl === value.destinationUrl && value.country === null &&
    Array.isArray(value.shippingRegions) &&
    value.shippingRegions.length === 0 &&
    value.logoSourceUrl === null && value.importOrigin === "provider" &&
    value.lifecycleManaged === true && value.lifecycleHidden === false &&
    value.lastQualificationResult === "qualified" &&
    validTimestamp(value.lastQualifiedAt) &&
    Date.parse(value.lastQualifiedAt) === Date.parse(evaluationTimestamp) &&
    canonicalText(value.seoTitle, 1_000) &&
    canonicalText(value.seoDescription, 4_000) &&
    validHttpUrl(value.seoCanonicalUrl) &&
    nullableText(value.metadata.advertiserId, 512) &&
    value.metadata.campaignId === campaignId &&
    canonicalText(value.metadata.campaignName, 1_000) &&
    validHttpUrl(value.metadata.destinationUrl) &&
    value.metadata.destinationUrl === value.destinationUrl &&
    validHttpUrl(value.metadata.trackingUrl);
}

function validOfferProjection(
  value: unknown,
  adId: string,
  campaignId: string,
): value is AdsOfferCreateProjectionV2 {
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
      "structuredTerms",
      "metadata",
      "seoTitle",
      "seoDescription",
      "seoCanonicalUrl",
    ]) || !isRecord(value.metadata) || !hasExactKeys(value.metadata, [
      "adId",
      "campaignId",
      "advertiserId",
      "dealId",
      "campaignName",
      "adName",
      "dealStartDate",
      "dealEndDate",
      "startDate",
      "endDate",
    ])
  ) return false;
  const discountIsValid = value.discountType === null
    ? value.discountValue === null
    : (value.discountType === "percentage" || value.discountType === "fixed") &&
      typeof value.discountValue === "number" &&
      Number.isFinite(value.discountValue) && value.discountValue >= 0;
  return canonicalText(value.title, 2_000) && nullableText(value.description) &&
    validCouponCode(value.couponCode) && value.couponType === "code" &&
    validHttpUrl(value.affiliateUrl) && validHttpUrl(value.landingPageUrl) &&
    (value.startDate === null || validIsoDate(value.startDate)) &&
    (value.expiryDate === null || validIsoDate(value.expiryDate)) &&
    (value.status === "active" || value.status === "expired" ||
      value.status === "draft") &&
    nullableText(value.terms) &&
    discountIsValid && validStructuredTerms(value.structuredTerms) &&
    value.metadata.adId === adId && value.metadata.campaignId === campaignId &&
    nullableText(value.metadata.advertiserId, 512) &&
    nullableText(value.metadata.dealId, 512) &&
    canonicalText(value.metadata.campaignName, 1_000) &&
    value.metadata.adName === value.title &&
    validProviderDate(value.metadata.dealStartDate) &&
    validProviderDate(value.metadata.dealEndDate) &&
    validProviderDate(value.metadata.startDate) &&
    validProviderDate(value.metadata.endDate) &&
    canonicalText(value.seoTitle, 1_000) &&
    canonicalText(value.seoDescription, 4_000) &&
    validHttpUrl(value.seoCanonicalUrl);
}

function copyStoreProjection(
  value: AdsStoreCreateProjectionV2,
): AdsStoreCreateProjectionV2 {
  return Object.freeze({
    name: value.name,
    slugCandidate: value.slugCandidate,
    description: value.description,
    affiliateUrl: value.affiliateUrl,
    destinationUrl: value.destinationUrl,
    country: value.country,
    shippingRegions: Object.freeze([...value.shippingRegions]),
    logoSourceUrl: value.logoSourceUrl,
    metadata: Object.freeze({ ...value.metadata }),
    importOrigin: "provider",
    lifecycleManaged: true,
    lifecycleHidden: false,
    lastQualificationResult: "qualified",
    lastQualifiedAt: value.lastQualifiedAt,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    seoCanonicalUrl: value.seoCanonicalUrl,
  });
}

function copyOfferProjection(
  value: AdsOfferCreateProjectionV2,
): AdsOfferCreateProjectionV2 {
  return Object.freeze({
    title: value.title,
    description: value.description,
    couponCode: value.couponCode,
    couponType: "code",
    affiliateUrl: value.affiliateUrl,
    landingPageUrl: value.landingPageUrl,
    startDate: value.startDate,
    expiryDate: value.expiryDate,
    status: value.status,
    terms: value.terms,
    discountType: value.discountType,
    discountValue: value.discountValue,
    structuredTerms: value.structuredTerms === null
      ? null
      : Object.freeze({ ...value.structuredTerms }),
    metadata: Object.freeze({ ...value.metadata }),
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    seoCanonicalUrl: value.seoCanonicalUrl,
  });
}

function projectStore(
  value: ExecutableStoreInstructionV2,
  ordinal: number,
  evaluationTimestamp: string,
): AdsPersistenceRpcStoreInstructionV2 {
  assertion(
    isRecord(value) && hasExactKeys(value, [
      "action",
      "providerStoreKey",
      "provider",
      "providerEntityNamespace",
      "providerEntityId",
      "expectedExistingStoreId",
      "qualified",
      "projection",
    ]) && value.provider === "impact" &&
      value.providerEntityNamespace === "campaign" &&
      canonicalText(value.providerEntityId, 512) &&
      validStoreKey(value.providerStoreKey, value.providerEntityId) &&
      value.qualified === true,
    "ads_execution_invalid_store_identity",
  );
  if (value.action === "create") {
    assertion(
      value.expectedExistingStoreId === null &&
        validStoreProjection(
          value.projection,
          value.providerEntityId,
          evaluationTimestamp,
        ),
      "ads_execution_invalid_store_create",
    );
    return Object.freeze({
      instructionOrdinal: ordinal,
      action: "create",
      provider: "impact",
      providerEntityNamespace: "campaign",
      providerEntityId: value.providerEntityId,
      expectedExistingStoreId: null,
      qualified: true,
      projection: copyStoreProjection(value.projection),
    });
  }
  assertion(
    validUuid(value.expectedExistingStoreId) && value.projection === null,
    "ads_execution_invalid_store_noop",
  );
  return Object.freeze({
    instructionOrdinal: ordinal,
    action: "noop_existing",
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: value.providerEntityId,
    expectedExistingStoreId: value.expectedExistingStoreId,
    qualified: true,
    projection: null,
  });
}

function projectOffer(
  value: ExecutableOfferInstructionV2,
  ordinal: number,
  parent: AdsPersistenceRpcStoreInstructionV2 | undefined,
): AdsPersistenceRpcOfferInstructionV2 {
  assertion(
    isRecord(value) && hasExactKeys(value, [
      "action",
      "providerOfferKey",
      "provider",
      "providerEntityNamespace",
      "providerEntityId",
      "kind",
      "existingOfferId",
      "parentProviderStoreKey",
      "parentProviderEntityNamespace",
      "parentProviderEntityId",
      "expectedParentStoreId",
      "projection",
    ]) && value.provider === "impact" &&
      value.providerEntityNamespace === "ad" &&
      canonicalText(value.providerEntityId, 512) &&
      validAdKey(value.providerOfferKey, value.providerEntityId) &&
      value.kind === "coupon" &&
      value.parentProviderEntityNamespace === "campaign" &&
      canonicalText(value.parentProviderEntityId, 512) &&
      validStoreKey(
        value.parentProviderStoreKey,
        value.parentProviderEntityId,
      ) &&
      parent !== undefined &&
      (parent.action === "create"
        ? value.expectedParentStoreId === null
        : value.expectedParentStoreId === parent.expectedExistingStoreId),
    "ads_execution_invalid_offer_identity",
  );
  if (value.action === "create") {
    assertion(
      value.existingOfferId === null &&
        validOfferProjection(
          value.projection,
          value.providerEntityId,
          value.parentProviderEntityId,
        ),
      "ads_execution_invalid_offer_create",
    );
    return Object.freeze({
      instructionOrdinal: ordinal,
      action: "create",
      provider: "impact",
      providerEntityNamespace: "ad",
      providerEntityId: value.providerEntityId,
      kind: "coupon",
      existingOfferId: null,
      parentProviderEntityNamespace: "campaign",
      parentProviderEntityId: value.parentProviderEntityId,
      expectedParentStoreId: value.expectedParentStoreId,
      projection: copyOfferProjection(value.projection),
    });
  }
  assertion(
    validUuid(value.existingOfferId) &&
      validUuid(value.expectedParentStoreId) &&
      value.projection === null,
    "ads_execution_invalid_offer_noop",
  );
  return Object.freeze({
    instructionOrdinal: ordinal,
    action: "noop_existing",
    provider: "impact",
    providerEntityNamespace: "ad",
    providerEntityId: value.providerEntityId,
    kind: "coupon",
    existingOfferId: value.existingOfferId,
    parentProviderEntityNamespace: "campaign",
    parentProviderEntityId: value.parentProviderEntityId,
    expectedParentStoreId: value.expectedParentStoreId,
    projection: null,
  });
}

/** Edge-native SHA-256 over the exact UTF-8 canonical-plan bytes. */
export async function sha256AdsPlanHexV2(material: string): Promise<string> {
  assertion(
    typeof material === "string",
    "ads_execution_invalid_hash_material",
  );
  assertion(
    globalThis.crypto?.subtle !== undefined,
    "ads_execution_web_crypto_unavailable",
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

/** Validates, snapshots and hashes the server-owned ready plan. */
export async function prepareAdsPersistenceExecutionV2(
  plan: AdsPersistencePlanV2,
  triggeredBy: string,
): Promise<PreparedAdsPersistenceExecutionV2> {
  assertion(
    isRecord(plan) && hasExactKeys(plan, [
      "persistenceContractVersion",
      "provider",
      "integrationId",
      "evaluationTimestamp",
      "mode",
      "canaryAdId",
      "status",
      "blockers",
      "preconditions",
      "storeInstructions",
      "offerInstructions",
      "counts",
      "canonicalPlanMaterial",
      "canonicalPlanMaterialString",
    ]),
    "ads_execution_invalid_plan_shape",
  );
  assertion(
    plan.persistenceContractVersion === ADS_PERSISTENCE_CONTRACT_VERSION_V2 &&
      plan.provider === "impact" && validUuid(plan.integrationId) &&
      validTimestamp(plan.evaluationTimestamp) && validUuid(triggeredBy) &&
      (plan.mode === "full" || plan.mode === "canary") &&
      ((plan.mode === "full" && plan.canaryAdId === null) ||
        (plan.mode === "canary" && canonicalText(plan.canaryAdId, 512))) &&
      plan.status === "ready" && Array.isArray(plan.blockers) &&
      plan.blockers.length === 0 && Array.isArray(plan.preconditions) &&
      plan.preconditions.length > 0 &&
      plan.preconditions.every((entry) =>
        isRecord(entry) &&
        hasExactKeys(entry, ["code", "satisfied"]) && entry.satisfied === true
      ) &&
      Array.isArray(plan.storeInstructions) &&
      Array.isArray(plan.offerInstructions) &&
      validCounts(plan.counts),
    "ads_execution_invalid_plan",
  );

  assertion(
    isRecord(plan.canonicalPlanMaterial) &&
      JSON.stringify(plan.canonicalPlanMaterial) ===
        plan.canonicalPlanMaterialString,
    "ads_execution_invalid_canonical_material",
  );
  const rootMaterial = {
    persistenceContractVersion: plan.persistenceContractVersion,
    provider: plan.provider,
    integrationId: plan.integrationId,
    evaluationTimestamp: plan.evaluationTimestamp,
    mode: plan.mode,
    canaryAdId: plan.canaryAdId,
    status: plan.status,
    blockers: plan.blockers,
    preconditions: plan.preconditions,
    storeInstructions: plan.storeInstructions,
    offerInstructions: plan.offerInstructions,
    counts: plan.counts,
  };
  assertion(
    JSON.stringify(rootMaterial) === plan.canonicalPlanMaterialString,
    "ads_execution_plan_material_mismatch",
  );

  const storeActionCounts = {
    create: plan.storeInstructions.filter((entry) => entry.action === "create")
      .length,
    noop:
      plan.storeInstructions.filter((entry) => entry.action === "noop_existing")
        .length,
    blocked:
      plan.storeInstructions.filter((entry) => entry.action === "blocked")
        .length,
  };
  const offerActionCounts = {
    create: plan.offerInstructions.filter((entry) => entry.action === "create")
      .length,
    noop:
      plan.offerInstructions.filter((entry) => entry.action === "noop_existing")
        .length,
    held: plan.offerInstructions.filter((entry) => entry.action === "noop_held")
      .length,
    unresolved:
      plan.offerInstructions.filter((entry) =>
        entry.action === "noop_unresolved"
      ).length,
    blocked:
      plan.offerInstructions.filter((entry) => entry.action === "blocked")
        .length,
  };
  assertion(
    storeActionCounts.create === plan.counts.stores.create &&
      storeActionCounts.noop === plan.counts.stores.noopExisting &&
      storeActionCounts.blocked === 0 &&
      offerActionCounts.create === plan.counts.offers.create &&
      offerActionCounts.noop === plan.counts.offers.noopExisting &&
      offerActionCounts.held === plan.counts.offers.noopHeld &&
      offerActionCounts.unresolved === plan.counts.offers.noopUnresolved &&
      offerActionCounts.blocked === 0,
    "ads_execution_invalid_instruction_counts",
  );

  const executableStores = plan.storeInstructions.filter(
    (entry): entry is ExecutableStoreInstructionV2 =>
      entry.action === "create" || entry.action === "noop_existing",
  );
  const stores = Object.freeze(
    executableStores.map((entry, index) =>
      projectStore(entry, index, plan.evaluationTimestamp)
    ),
  );
  assertion(
    new Set(stores.map((entry) => entry.providerEntityId)).size ===
      stores.length,
    "ads_execution_duplicate_store_identity",
  );
  const storeById = new Map(
    stores.map((entry) => [entry.providerEntityId, entry]),
  );
  const executableOffers = plan.offerInstructions.filter(
    (entry): entry is ExecutableOfferInstructionV2 =>
      entry.action === "create" || entry.action === "noop_existing",
  );
  const offers = Object.freeze(
    executableOffers.map((entry, index) =>
      projectOffer(
        entry,
        stores.length + index,
        storeById.get(entry.parentProviderEntityId),
      )
    ),
  );
  assertion(
    new Set(offers.map((entry) => entry.providerEntityId)).size ===
      offers.length,
    "ads_execution_duplicate_offer_identity",
  );

  // Capture all RPC material before crossing the asynchronous digest boundary.
  const snapshot = Object.freeze({
    integrationId: plan.integrationId,
    evaluationTimestamp: plan.evaluationTimestamp,
    triggeredBy,
    counts: copyCounts(plan.counts),
    stores,
    offers,
    canonical: plan.canonicalPlanMaterialString,
  });
  const fingerprint = await sha256AdsPlanHexV2(snapshot.canonical);
  assertion(
    /^[0-9a-f]{64}$/.test(fingerprint),
    "ads_execution_invalid_fingerprint",
  );
  const args: ApplyAffiliateAdsPersistencePlanV2Args = Object.freeze({
    _integration_id: snapshot.integrationId,
    _provider: "impact",
    _persistence_contract_version: ADS_PERSISTENCE_CONTRACT_VERSION_V2,
    _plan_fingerprint_algorithm: ADS_PLAN_FINGERPRINT_ALGORITHM_V2,
    _plan_fingerprint: fingerprint,
    _evaluation_timestamp: snapshot.evaluationTimestamp,
    _triggered_by: snapshot.triggeredBy,
    _expected_counts: snapshot.counts,
    _store_instructions: snapshot.stores,
    _offer_instructions: snapshot.offers,
  });
  const prepared: PreparedAdsPersistenceExecutionV2 = {
    [preparedBrand]: true,
    [preparedArgs]: args,
  };
  return Object.freeze(prepared);
}

/** The service-role boundary accepts only the opaque prepared capability. */
export function adsPersistenceRpcArgsV2(
  prepared: PreparedAdsPersistenceExecutionV2,
): ApplyAffiliateAdsPersistencePlanV2Args {
  assertion(prepared?.[preparedBrand] === true, "ads_execution_not_prepared");
  return prepared[preparedArgs];
}
