import type {
  AdsOfferCreateProjectionV2,
  AdsStoreCreateProjectionV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-models.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsRefreshPersistenceOfferInstructionV2,
  type AdsRefreshPersistencePlanCountsV2,
  type AdsRefreshPersistencePlanV2,
  type AdsRefreshPersistenceStoreInstructionV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-models.ts";

export const ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2 =
  "sha256-canonical-plan-v1" as const;

type RefreshStoreUpdateV2 = Extract<
  AdsRefreshPersistenceStoreInstructionV2,
  { action: "update_existing" }
>;

type RefreshOfferUpdateV2 = Extract<
  AdsRefreshPersistenceOfferInstructionV2,
  { action: "update_existing" }
>;

type ExecutableRefreshStoreInstructionV2 = Extract<
  AdsRefreshPersistenceStoreInstructionV2,
  {
    action:
      | "create"
      | "noop_existing"
      | "update_existing";
  }
>;

type ExecutableRefreshOfferInstructionV2 = Extract<
  AdsRefreshPersistenceOfferInstructionV2,
  {
    action:
      | "create"
      | "noop_existing"
      | "update_existing";
  }
>;

export type AdsRefreshPersistenceRpcStoreInstructionV2 =
  | {
    readonly instructionOrdinal: number;
    readonly action: "create";
    readonly provider: "impact";
    readonly providerEntityNamespace: "campaign";
    readonly providerEntityId: string;
    readonly expectedExistingStoreId: null;
    readonly qualified: true;
    readonly projection: AdsStoreCreateProjectionV2;
  }
  | {
    readonly instructionOrdinal: number;
    readonly action: "noop_existing";
    readonly provider: "impact";
    readonly providerEntityNamespace: "campaign";
    readonly providerEntityId: string;
    readonly expectedExistingStoreId: string;
    readonly qualified: true;
    readonly projection: null;
  }
  | {
    readonly instructionOrdinal: number;
    readonly action: "update_existing";
    readonly provider: "impact";
    readonly providerEntityNamespace: "campaign";
    readonly providerEntityId: string;
    readonly expectedExistingStoreId: string;
    readonly qualified: true;
    readonly expectedCurrentManagedState:
      RefreshStoreUpdateV2["expectedCurrentManagedState"];
    readonly desiredManagedState:
      RefreshStoreUpdateV2["desiredManagedState"];
  };

export type AdsRefreshPersistenceRpcOfferInstructionV2 =
  | {
    readonly instructionOrdinal: number;
    readonly action: "create";
    readonly provider: "impact";
    readonly providerEntityNamespace: "ad";
    readonly providerEntityId: string;
    readonly kind: "coupon";
    readonly existingOfferId: null;
    readonly parentProviderEntityNamespace: "campaign";
    readonly parentProviderEntityId: string;
    readonly expectedParentStoreId: string | null;
    readonly projection: AdsOfferCreateProjectionV2;
  }
  | {
    readonly instructionOrdinal: number;
    readonly action: "noop_existing";
    readonly provider: "impact";
    readonly providerEntityNamespace: "ad";
    readonly providerEntityId: string;
    readonly kind: "coupon";
    readonly existingOfferId: string;
    readonly parentProviderEntityNamespace: "campaign";
    readonly parentProviderEntityId: string;
    readonly expectedParentStoreId: string;
    readonly projection: null;
  }
  | {
    readonly instructionOrdinal: number;
    readonly action: "update_existing";
    readonly provider: "impact";
    readonly providerEntityNamespace: "ad";
    readonly providerEntityId: string;
    readonly kind: "coupon";
    readonly existingOfferId: string;
    readonly parentProviderEntityNamespace: "campaign";
    readonly parentProviderEntityId: string;
    readonly expectedParentStoreId: string;
    readonly expectedCurrentManagedState:
      RefreshOfferUpdateV2["expectedCurrentManagedState"];
    readonly desiredManagedState:
      RefreshOfferUpdateV2["desiredManagedState"];
  };

export interface ApplyAffiliateAdsRefreshPersistencePlanV2Args {
  readonly _integration_id: string;
  readonly _provider: "impact";
  readonly _persistence_contract_version:
    typeof ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2;
  readonly _plan_fingerprint_algorithm:
    typeof ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2;
  readonly _plan_fingerprint: string;
  readonly _evaluation_timestamp: string;
  readonly _triggered_by: string;
  readonly _expected_counts:
    AdsRefreshPersistencePlanCountsV2;
  readonly _store_instructions:
    readonly AdsRefreshPersistenceRpcStoreInstructionV2[];
  readonly _offer_instructions:
    readonly AdsRefreshPersistenceRpcOfferInstructionV2[];
}

const preparedRefreshBrand:
  unique symbol = Symbol(
    "affiliate-sync-ads-v2-refresh-prepared-execution",
  );

const preparedRefreshArgs:
  unique symbol = Symbol(
    "affiliate-sync-ads-v2-refresh-prepared-execution-args",
  );

export interface PreparedAdsRefreshPersistenceExecutionV2 {
  readonly [preparedRefreshBrand]: true;
  readonly [preparedRefreshArgs]:
    ApplyAffiliateAdsRefreshPersistencePlanV2Args;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXPLICIT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const INT_MAX = 2147483647;

function assertion(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  return actual.length === wanted.length &&
    actual.every(
      (key, index) =>
        key === wanted[index],
    );
}

function validUuid(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    UUID_PATTERN.test(value);
}

function canonicalText(
  value: unknown,
  maxLength = 512,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim();
}

function validTimestamp(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    EXPLICIT_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(
      Date.parse(value),
    );
}

function nonnegativeInteger(
  value: unknown,
): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= INT_MAX;
}

function validStoreKey(
  value: unknown,
  expectedId: string,
): boolean {
  return isRecord(value) &&
    hasExactKeys(
      value,
      ["provider", "namespace", "id"],
    ) &&
    value.provider === "impact" &&
    value.namespace === "campaign" &&
    value.id === expectedId;
}

function validAdKey(
  value: unknown,
  expectedId: string,
): boolean {
  return isRecord(value) &&
    hasExactKeys(
      value,
      ["provider", "namespace", "id"],
    ) &&
    value.provider === "impact" &&
    value.namespace === "ad" &&
    value.id === expectedId;
}

function validRefreshCounts(
  value: unknown,
): value is AdsRefreshPersistencePlanCountsV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "stores",
        "offers",
        "writableStores",
        "writableOffers",
        "writableEntities",
      ],
    ) ||
    !isRecord(value.stores) ||
    !hasExactKeys(
      value.stores,
      [
        "create",
        "updateExisting",
        "noopExisting",
        "blockedAmbiguous",
        "noopUnmatched",
      ],
    ) ||
    !isRecord(value.offers) ||
    !hasExactKeys(
      value.offers,
      [
        "create",
        "updateExisting",
        "noopExisting",
        "noopHeld",
        "noopUnresolved",
      ],
    )
  ) {
    return false;
  }

  const allCounts = [
    value.stores.create,
    value.stores.updateExisting,
    value.stores.noopExisting,
    value.stores.blockedAmbiguous,
    value.stores.noopUnmatched,
    value.offers.create,
    value.offers.updateExisting,
    value.offers.noopExisting,
    value.offers.noopHeld,
    value.offers.noopUnresolved,
    value.writableStores,
    value.writableOffers,
    value.writableEntities,
  ];

  if (
    !allCounts.every(
      nonnegativeInteger,
    )
  ) {
    return false;
  }

  const writableStores =
    Number(value.stores.create) +
    Number(value.stores.updateExisting);

  const writableOffers =
    Number(value.offers.create) +
    Number(value.offers.updateExisting);

  return value.stores.blockedAmbiguous === 0 &&
    value.writableStores ===
      writableStores &&
    value.writableOffers ===
      writableOffers &&
    value.writableEntities ===
      writableStores +
        writableOffers;
}

function validateStoreInstruction(
  value: AdsRefreshPersistenceStoreInstructionV2,
): void {
  assertion(
    value.provider === "impact" &&
      value.providerEntityNamespace ===
        "campaign" &&
      canonicalText(
        value.providerEntityId,
      ) &&
      validStoreKey(
        value.providerStoreKey,
        value.providerEntityId,
      ),
    "ads_refresh_execution_invalid_store_identity",
  );

  if (
    value.action === "create"
  ) {
    assertion(
      value.expectedExistingStoreId ===
        null &&
        value.qualified === true &&
        isRecord(
          value.projection,
        ),
      "ads_refresh_execution_invalid_store_create",
    );

    return;
  }

  if (
    value.action ===
      "noop_existing"
  ) {
    assertion(
      validUuid(
        value.expectedExistingStoreId,
      ) &&
        value.qualified === true &&
        value.projection === null,
      "ads_refresh_execution_invalid_store_noop",
    );

    return;
  }

  if (
    value.action ===
      "update_existing"
  ) {
    assertion(
      validUuid(
        value.expectedExistingStoreId,
      ) &&
        value.qualified === true &&
        isRecord(
          value.expectedCurrentManagedState,
        ) &&
        isRecord(
          value.desiredManagedState,
        ),
      "ads_refresh_execution_invalid_store_update",
    );

    return;
  }

  throw new Error(
    "ads_refresh_execution_blocked_store_instruction",
  );
}

function validateOfferInstruction(
  value: AdsRefreshPersistenceOfferInstructionV2,
): void {
  assertion(
    value.provider === "impact" &&
      value.providerEntityNamespace ===
        "ad" &&
      value.kind === "coupon" &&
      canonicalText(
        value.providerEntityId,
      ) &&
      validAdKey(
        value.providerOfferKey,
        value.providerEntityId,
      ),
    "ads_refresh_execution_invalid_offer_identity",
  );

  if (
    value.action === "create"
  ) {
    assertion(
      value.existingOfferId ===
        null &&
        value.parentProviderEntityNamespace ===
          "campaign" &&
        canonicalText(
          value.parentProviderEntityId,
        ) &&
        validStoreKey(
          value.parentProviderStoreKey,
          value.parentProviderEntityId,
        ) &&
        (
          value.expectedParentStoreId ===
            null ||
          validUuid(
            value.expectedParentStoreId,
          )
        ) &&
        isRecord(
          value.projection,
        ),
      "ads_refresh_execution_invalid_offer_create",
    );

    return;
  }

  if (
    value.action ===
      "noop_existing"
  ) {
    assertion(
      validUuid(
        value.existingOfferId,
      ) &&
        value.parentProviderEntityNamespace ===
          "campaign" &&
        canonicalText(
          value.parentProviderEntityId,
        ) &&
        validStoreKey(
          value.parentProviderStoreKey,
          value.parentProviderEntityId,
        ) &&
        validUuid(
          value.expectedParentStoreId,
        ) &&
        value.projection === null,
      "ads_refresh_execution_invalid_offer_noop",
    );

    return;
  }

  if (
    value.action ===
      "update_existing"
  ) {
    assertion(
      validUuid(
        value.existingOfferId,
      ) &&
        value.parentProviderEntityNamespace ===
          "campaign" &&
        canonicalText(
          value.parentProviderEntityId,
        ) &&
        validStoreKey(
          value.parentProviderStoreKey,
          value.parentProviderEntityId,
        ) &&
        validUuid(
          value.expectedParentStoreId,
        ) &&
        isRecord(
          value.expectedCurrentManagedState,
        ) &&
        isRecord(
          value.desiredManagedState,
        ),
      "ads_refresh_execution_invalid_offer_update",
    );

    return;
  }

  if (
    value.action ===
      "noop_held" ||
    value.action ===
      "noop_unresolved"
  ) {
    return;
  }

  throw new Error(
    "ads_refresh_execution_blocked_offer_instruction",
  );
}

function deepFreeze<T>(
  value: T,
): T {
  if (
    value !== null &&
    typeof value === "object"
  ) {
    for (
      const key of Reflect.ownKeys(
        value as object,
      )
    ) {
      deepFreeze(
        (
          value as unknown as
            Record<PropertyKey, unknown>
        )[key],
      );
    }

    Object.freeze(value);
  }

  return value;
}

function frozenClone<T>(
  value: T,
): T {
  return deepFreeze(
    structuredClone(value),
  );
}

function storeRpcInstruction(
  value: ExecutableRefreshStoreInstructionV2,
  ordinal: number,
): AdsRefreshPersistenceRpcStoreInstructionV2 {
  if (
    value.action === "create"
  ) {
    return deepFreeze({
      instructionOrdinal:
        ordinal,
      action: "create",
      provider: "impact",
      providerEntityNamespace:
        "campaign",
      providerEntityId:
        value.providerEntityId,
      expectedExistingStoreId:
        null,
      qualified: true,
      projection:
        frozenClone(
          value.projection,
        ),
    });
  }

  if (
    value.action ===
      "noop_existing"
  ) {
    return Object.freeze({
      instructionOrdinal:
        ordinal,
      action: "noop_existing",
      provider: "impact",
      providerEntityNamespace:
        "campaign",
      providerEntityId:
        value.providerEntityId,
      expectedExistingStoreId:
        value.expectedExistingStoreId,
      qualified: true,
      projection: null,
    });
  }

  return deepFreeze({
    instructionOrdinal:
      ordinal,
    action: "update_existing",
    provider: "impact",
    providerEntityNamespace:
      "campaign",
    providerEntityId:
      value.providerEntityId,
    expectedExistingStoreId:
      value.expectedExistingStoreId,
    qualified: true,
    expectedCurrentManagedState:
      frozenClone(
        value.expectedCurrentManagedState,
      ),
    desiredManagedState:
      frozenClone(
        value.desiredManagedState,
      ),
  });
}

function offerRpcInstruction(
  value: ExecutableRefreshOfferInstructionV2,
  ordinal: number,
): AdsRefreshPersistenceRpcOfferInstructionV2 {
  if (
    value.action === "create"
  ) {
    return deepFreeze({
      instructionOrdinal:
        ordinal,
      action: "create",
      provider: "impact",
      providerEntityNamespace:
        "ad",
      providerEntityId:
        value.providerEntityId,
      kind: "coupon",
      existingOfferId: null,
      parentProviderEntityNamespace:
        "campaign",
      parentProviderEntityId:
        value.parentProviderEntityId,
      expectedParentStoreId:
        value.expectedParentStoreId,
      projection:
        frozenClone(
          value.projection,
        ),
    });
  }

  if (
    value.action ===
      "noop_existing"
  ) {
    return Object.freeze({
      instructionOrdinal:
        ordinal,
      action:
        "noop_existing",
      provider: "impact",
      providerEntityNamespace:
        "ad",
      providerEntityId:
        value.providerEntityId,
      kind: "coupon",
      existingOfferId:
        value.existingOfferId,
      parentProviderEntityNamespace:
        "campaign",
      parentProviderEntityId:
        value.parentProviderEntityId,
      expectedParentStoreId:
        value.expectedParentStoreId,
      projection: null,
    });
  }

  return deepFreeze({
    instructionOrdinal:
      ordinal,
    action:
      "update_existing",
    provider: "impact",
    providerEntityNamespace:
      "ad",
    providerEntityId:
      value.providerEntityId,
    kind: "coupon",
    existingOfferId:
      value.existingOfferId,
    parentProviderEntityNamespace:
      "campaign",
    parentProviderEntityId:
      value.parentProviderEntityId,
    expectedParentStoreId:
      value.expectedParentStoreId,
    expectedCurrentManagedState:
      frozenClone(
        value.expectedCurrentManagedState,
      ),
    desiredManagedState:
      frozenClone(
        value.desiredManagedState,
      ),
  });
}

async function sha256Hex(
  material: string,
): Promise<string> {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        material,
      ),
    );

  return Array.from(
    new Uint8Array(digest),
    (byte) =>
      byte.toString(16)
        .padStart(2, "0"),
  ).join("");
}

/**
 * Detached Ads-2 execution preparer.
 *
 * Creates an opaque host-owned capability only.
 * It does not call Supabase or execute persistence.
 */
export async function prepareAdsRefreshPersistenceExecutionV2(
  plan:
    AdsRefreshPersistencePlanV2,
  triggeredBy: string,
): Promise<
  PreparedAdsRefreshPersistenceExecutionV2
> {
  assertion(
    isRecord(plan) &&
      hasExactKeys(
        plan,
        [
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
        ],
      ),
    "ads_refresh_execution_invalid_plan_shape",
  );

  assertion(
    plan.persistenceContractVersion ===
        ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2 &&
      plan.provider ===
        "impact" &&
      validUuid(
        plan.integrationId,
      ) &&
      validTimestamp(
        plan.evaluationTimestamp,
      ) &&
      validUuid(
        triggeredBy,
      ) &&
      (
        plan.mode === "full" ||
        plan.mode === "canary"
      ) &&
      (
        (
          plan.mode === "full" &&
          plan.canaryAdId === null
        ) ||
        (
          plan.mode === "canary" &&
          canonicalText(
            plan.canaryAdId,
          )
        )
      ) &&
      plan.status === "ready" &&
      Array.isArray(
        plan.blockers,
      ) &&
      plan.blockers.length === 0 &&
      Array.isArray(
        plan.preconditions,
      ) &&
      Array.isArray(
        plan.storeInstructions,
      ) &&
      Array.isArray(
        plan.offerInstructions,
      ) &&
      validRefreshCounts(
        plan.counts,
      ),
    "ads_refresh_execution_invalid_plan",
  );

  assertion(
    isRecord(
      plan.canonicalPlanMaterial,
    ) &&
      JSON.stringify(
        plan.canonicalPlanMaterial,
      ) ===
        plan.canonicalPlanMaterialString,
    "ads_refresh_execution_invalid_canonical_material",
  );

  const rootMaterial = {
    persistenceContractVersion:
      plan.persistenceContractVersion,
    provider:
      plan.provider,
    integrationId:
      plan.integrationId,
    evaluationTimestamp:
      plan.evaluationTimestamp,
    mode:
      plan.mode,
    canaryAdId:
      plan.canaryAdId,
    status:
      plan.status,
    blockers:
      plan.blockers,
    preconditions:
      plan.preconditions,
    storeInstructions:
      plan.storeInstructions,
    offerInstructions:
      plan.offerInstructions,
    counts:
      plan.counts,
  };

  assertion(
    JSON.stringify(
      rootMaterial,
    ) ===
      plan.canonicalPlanMaterialString,
    "ads_refresh_execution_plan_material_mismatch",
  );

  const storeIds =
    new Set<string>();

  let storeCreate = 0;
  let storeUpdate = 0;
  let storeNoop = 0;

  for (
    const instruction of
      plan.storeInstructions
  ) {
    validateStoreInstruction(
      instruction,
    );

    assertion(
      !storeIds.has(
        instruction.providerEntityId,
      ),
      "ads_refresh_execution_duplicate_store_identity",
    );

    storeIds.add(
      instruction.providerEntityId,
    );

    if (
      instruction.action ===
        "create"
    ) {
      storeCreate += 1;
    } else if (
      instruction.action ===
        "update_existing"
    ) {
      storeUpdate += 1;
    } else if (
      instruction.action ===
        "noop_existing"
    ) {
      storeNoop += 1;
    }
  }

  let offerCreate = 0;
  let offerUpdate = 0;
  let offerNoop = 0;
  let offerHeld = 0;
  let offerUnresolved = 0;

  const offerIds =
    new Set<string>();

  for (
    const instruction of
      plan.offerInstructions
  ) {
    validateOfferInstruction(
      instruction,
    );

    assertion(
      !offerIds.has(
        instruction.providerEntityId,
      ),
      "ads_refresh_execution_duplicate_offer_identity",
    );

    offerIds.add(
      instruction.providerEntityId,
    );

    if (
      instruction.action ===
        "create"
    ) {
      offerCreate += 1;
    } else if (
      instruction.action ===
        "update_existing"
    ) {
      offerUpdate += 1;
    } else if (
      instruction.action ===
        "noop_existing"
    ) {
      offerNoop += 1;
    } else if (
      instruction.action ===
        "noop_held"
    ) {
      offerHeld += 1;
    } else if (
      instruction.action ===
        "noop_unresolved"
    ) {
      offerUnresolved += 1;
    }
  }

  assertion(
    storeCreate ===
        plan.counts.stores.create &&
      storeUpdate ===
        plan.counts.stores.updateExisting &&
      storeNoop ===
        plan.counts.stores.noopExisting &&
      plan.counts.stores.blockedAmbiguous ===
        0 &&
      offerCreate ===
        plan.counts.offers.create &&
      offerUpdate ===
        plan.counts.offers.updateExisting &&
      offerNoop ===
        plan.counts.offers.noopExisting &&
      offerHeld ===
        plan.counts.offers.noopHeld &&
      offerUnresolved ===
        plan.counts.offers.noopUnresolved,
    "ads_refresh_execution_count_mismatch",
  );

  const executableStores =
    plan.storeInstructions.filter(
      (
        entry,
      ): entry is ExecutableRefreshStoreInstructionV2 =>
        entry.action ===
          "create" ||
        entry.action ===
          "noop_existing" ||
        entry.action ===
          "update_existing",
    );

  const executableOffers =
    plan.offerInstructions.filter(
      (
        entry,
      ): entry is ExecutableRefreshOfferInstructionV2 =>
        entry.action ===
          "create" ||
        entry.action ===
          "noop_existing" ||
        entry.action ===
          "update_existing",
    );

  const stores =
    executableStores.map(
      (
        instruction,
        ordinal,
      ) =>
        storeRpcInstruction(
          instruction,
          ordinal,
        ),
    );

  const offers =
    executableOffers.map(
      (
        instruction,
        index,
      ) => {
        assertion(
          storeIds.has(
            instruction
              .parentProviderEntityId,
          ),
          "ads_refresh_execution_parent_not_in_plan",
        );

        return offerRpcInstruction(
          instruction,
          stores.length +
            index,
        );
      },
    );

  /*
   * Capture every RPC-relevant value before crossing the asynchronous
   * digest boundary. The caller may still hold and mutate the original
   * plan object while SHA-256 is pending; prepared execution must remain
   * bound to this exact validated snapshot.
   */
  const snapshot =
    deepFreeze({
      integrationId:
        plan.integrationId,
      evaluationTimestamp:
        plan.evaluationTimestamp,
      triggeredBy,
      counts:
        frozenClone(
          plan.counts,
        ),
      stores:
        frozenClone(
          stores,
        ),
      offers:
        frozenClone(
          offers,
        ),
      canonical:
        plan.canonicalPlanMaterialString,
    });

  const fingerprint =
    await sha256Hex(
      snapshot.canonical,
    );

  assertion(
    /^[0-9a-f]{64}$/.test(
      fingerprint,
    ),
    "ads_refresh_execution_invalid_fingerprint",
  );

  const args:
    ApplyAffiliateAdsRefreshPersistencePlanV2Args =
      deepFreeze({
        _integration_id:
          snapshot.integrationId,
        _provider:
          "impact",
        _persistence_contract_version:
          ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
        _plan_fingerprint_algorithm:
          ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2,
        _plan_fingerprint:
          fingerprint,
        _evaluation_timestamp:
          snapshot.evaluationTimestamp,
        _triggered_by:
          snapshot.triggeredBy,
        _expected_counts:
          snapshot.counts,
        _store_instructions:
          snapshot.stores,
        _offer_instructions:
          snapshot.offers,
      });

  const prepared:
    PreparedAdsRefreshPersistenceExecutionV2 =
      {
        [preparedRefreshBrand]:
          true,
        [preparedRefreshArgs]:
          args,
      };

  return Object.freeze(
    prepared,
  );
}

export function adsRefreshPersistenceRpcArgsV2(
  prepared:
    PreparedAdsRefreshPersistenceExecutionV2,
): ApplyAffiliateAdsRefreshPersistencePlanV2Args {
  assertion(
    prepared?.[
      preparedRefreshBrand
    ] === true,
    "ads_refresh_execution_not_prepared",
  );

  return prepared[
    preparedRefreshArgs
  ];
}
