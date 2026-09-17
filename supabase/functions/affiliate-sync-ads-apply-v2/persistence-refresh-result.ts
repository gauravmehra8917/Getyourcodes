import type {
  AdsRefreshPersistencePlanCountsV2,
} from "../_shared/affiliate-sync-v2-ads-persistence/ads-persistence-refresh-models.ts";

import {
  ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2,
  adsRefreshPersistenceRpcArgsV2,
  type PreparedAdsRefreshPersistenceExecutionV2,
} from "./persistence-refresh-execution.ts";

export interface AdsRefreshPersistenceActualCountsV2 {
  readonly storesCreated: number;
  readonly storesUpdatedExisting: number;
  readonly storesNoopExisting: number;
  readonly offersCreated: number;
  readonly offersUpdatedExisting: number;
  readonly offersNoopExisting: number;
  readonly ledgerRows: number;
}

export interface AdsRefreshCreatedEvidenceV2 {
  readonly entityId: string;
  readonly providerEntityId: string;
}

export interface AdsRefreshPersistenceLedgerEntryV2 {
  readonly instructionOrdinal: number;

  readonly entityKind:
    | "store"
    | "offer";

  readonly plannedAction:
    | "create"
    | "noop_existing"
    | "update_existing";

  readonly outcome:
    | "created"
    | "noop_existing"
    | "updated_existing";

  readonly provider:
    "impact";

  readonly providerEntityNamespace:
    | "campaign"
    | "ad";

  readonly providerEntityId:
    string;

  readonly entityId:
    string;

  readonly expectedEntityId:
    string | null;

  readonly parentProviderEntityNamespace:
    "campaign" | null;

  readonly parentProviderEntityId:
    string | null;

  readonly parentEntityId:
    string | null;

  readonly offerKind:
    "coupon" | null;
}

export interface ValidatedAdsRefreshPersistenceSuccessV2 {
  readonly status:
    | "committed"
    | "replayed_existing";

  readonly runId:
    string;

  readonly persistenceContractVersion:
    "v2-a11-ads-2";

  readonly planFingerprintAlgorithm:
    typeof ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2;

  readonly planFingerprint:
    string;

  readonly evaluationTimestamp:
    string;

  readonly counts: {
    readonly expected:
      AdsRefreshPersistencePlanCountsV2;

    readonly actual:
      AdsRefreshPersistenceActualCountsV2;
  };

  readonly createdStores:
    readonly AdsRefreshCreatedEvidenceV2[];

  readonly createdOffers:
    readonly AdsRefreshCreatedEvidenceV2[];

  readonly noops: {
    readonly stores: number;
    readonly offers: number;
  };

  readonly ledger:
    readonly AdsRefreshPersistenceLedgerEntryV2[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHA256_HEX_PATTERN =
  /^[0-9a-f]{64}$/;

const EXPLICIT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const INT_MAX =
  2147483647;

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
  const actual =
    Object.keys(value).sort();

  const wanted =
    [...expected].sort();

  return actual.length === wanted.length &&
    actual.every(
      (key, index) =>
        key === wanted[index],
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

function validUuid(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    UUID_PATTERN.test(value);
}

function sameUuid(
  left: string,
  right: string,
): boolean {
  return left.toLowerCase() ===
    right.toLowerCase();
}

function canonicalProviderId(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim();
}

function validTimestamp(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    EXPLICIT_TIMESTAMP_PATTERN.test(
      value,
    ) &&
    Number.isFinite(
      Date.parse(value),
    );
}

function validExpectedCounts(
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

  const values = [
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
    !values.every(
      nonnegativeInteger,
    )
  ) {
    return false;
  }

  const writableStores =
    Number(
      value.stores.create,
    ) +
    Number(
      value.stores.updateExisting,
    );

  const writableOffers =
    Number(
      value.offers.create,
    ) +
    Number(
      value.offers.updateExisting,
    );

  return (
    value.stores.blockedAmbiguous === 0 &&
    value.writableStores ===
      writableStores &&
    value.writableOffers ===
      writableOffers &&
    value.writableEntities ===
      writableStores +
        writableOffers
  );
}

function sameExpectedCounts(
  left:
    AdsRefreshPersistencePlanCountsV2,

  right:
    AdsRefreshPersistencePlanCountsV2,
): boolean {
  return (
    left.stores.create ===
      right.stores.create &&

    left.stores.updateExisting ===
      right.stores.updateExisting &&

    left.stores.noopExisting ===
      right.stores.noopExisting &&

    left.stores.blockedAmbiguous ===
      right.stores.blockedAmbiguous &&

    left.stores.noopUnmatched ===
      right.stores.noopUnmatched &&

    left.offers.create ===
      right.offers.create &&

    left.offers.updateExisting ===
      right.offers.updateExisting &&

    left.offers.noopExisting ===
      right.offers.noopExisting &&

    left.offers.noopHeld ===
      right.offers.noopHeld &&

    left.offers.noopUnresolved ===
      right.offers.noopUnresolved &&

    left.writableStores ===
      right.writableStores &&

    left.writableOffers ===
      right.writableOffers &&

    left.writableEntities ===
      right.writableEntities
  );
}

function validActualCounts(
  value: unknown,
): value is AdsRefreshPersistenceActualCountsV2 {
  return (
    isRecord(value) &&

    hasExactKeys(
      value,
      [
        "storesCreated",
        "storesUpdatedExisting",
        "storesNoopExisting",
        "offersCreated",
        "offersUpdatedExisting",
        "offersNoopExisting",
        "ledgerRows",
      ],
    ) &&

    nonnegativeInteger(
      value.storesCreated,
    ) &&

    nonnegativeInteger(
      value.storesUpdatedExisting,
    ) &&

    nonnegativeInteger(
      value.storesNoopExisting,
    ) &&

    nonnegativeInteger(
      value.offersCreated,
    ) &&

    nonnegativeInteger(
      value.offersUpdatedExisting,
    ) &&

    nonnegativeInteger(
      value.offersNoopExisting,
    ) &&

    nonnegativeInteger(
      value.ledgerRows,
    )
  );
}

function createdEvidence(
  value: unknown,
): AdsRefreshCreatedEvidenceV2[] | null {
  if (
    !Array.isArray(value)
  ) {
    return null;
  }

  const result:
    AdsRefreshCreatedEvidenceV2[] = [];

  const entityIds =
    new Set<string>();

  const providerIds =
    new Set<string>();

  for (
    const entry of value
  ) {
    if (
      !isRecord(entry) ||

      !hasExactKeys(
        entry,
        [
          "entityId",
          "providerEntityId",
        ],
      ) ||

      !validUuid(
        entry.entityId,
      ) ||

      !canonicalProviderId(
        entry.providerEntityId,
      )
    ) {
      return null;
    }

    const entityKey =
      entry.entityId.toLowerCase();

    if (
      entityIds.has(
        entityKey,
      ) ||
      providerIds.has(
        entry.providerEntityId,
      )
    ) {
      return null;
    }

    entityIds.add(
      entityKey,
    );

    providerIds.add(
      entry.providerEntityId,
    );

    result.push({
      entityId:
        entry.entityId,

      providerEntityId:
        entry.providerEntityId,
    });
  }

  return result;
}

function sameCreatedEvidence(
  left:
    readonly AdsRefreshCreatedEvidenceV2[],

  right:
    readonly AdsRefreshCreatedEvidenceV2[],
): boolean {
  if (
    left.length !==
      right.length
  ) {
    return false;
  }

  const rightByProvider =
    new Map(
      right.map(
        (entry) => [
          entry.providerEntityId,
          entry.entityId,
        ],
      ),
    );

  return left.every(
    (entry) => {
      const other =
        rightByProvider.get(
          entry.providerEntityId,
        );

      return other !== undefined &&
        sameUuid(
          entry.entityId,
          other,
        );
    },
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

function expectedOutcome(
  action:
    | "create"
    | "noop_existing"
    | "update_existing",
):
  | "created"
  | "noop_existing"
  | "updated_existing" {
  if (
    action === "create"
  ) {
    return "created";
  }

  if (
    action ===
      "update_existing"
  ) {
    return "updated_existing";
  }

  return "noop_existing";
}

/**
 * Strictly validates committed/replayed Ads-2 RPC success evidence.
 *
 * Detached only:
 * - does not invoke Supabase
 * - does not alter handler behavior
 * - does not accept Ads-1 result semantics
 */
export function parseAdsRefreshPersistenceSuccessV2(
  value: unknown,

  prepared:
    PreparedAdsRefreshPersistenceExecutionV2,
): ValidatedAdsRefreshPersistenceSuccessV2 | null {
  const args =
    adsRefreshPersistenceRpcArgsV2(
      prepared,
    );

  if (
    !isRecord(value) ||

    !hasExactKeys(
      value,
      [
        "status",
        "runId",
        "persistenceContractVersion",
        "planFingerprintAlgorithm",
        "planFingerprint",
        "evaluationTimestamp",
        "counts",
        "createdStores",
        "createdOffers",
        "noops",
        "ledger",
      ],
    ) ||

    (
      value.status !==
        "committed" &&
      value.status !==
        "replayed_existing"
    ) ||

    !validUuid(
      value.runId,
    ) ||

    value.persistenceContractVersion !==
      "v2-a11-ads-2" ||

    value.planFingerprintAlgorithm !==
      ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2 ||

    typeof value.planFingerprint !==
      "string" ||

    !SHA256_HEX_PATTERN.test(
      value.planFingerprint,
    ) ||

    value.planFingerprint !==
      args._plan_fingerprint ||

    !validTimestamp(
      value.evaluationTimestamp,
    ) ||

    Date.parse(
      value.evaluationTimestamp,
    ) !==
      Date.parse(
        args._evaluation_timestamp,
      ) ||

    !isRecord(
      value.counts,
    ) ||

    !hasExactKeys(
      value.counts,
      [
        "expected",
        "actual",
      ],
    ) ||

    !validExpectedCounts(
      value.counts.expected,
    ) ||

    !sameExpectedCounts(
      value.counts.expected,
      args._expected_counts,
    ) ||

    !validActualCounts(
      value.counts.actual,
    ) ||

    !isRecord(
      value.noops,
    ) ||

    !hasExactKeys(
      value.noops,
      [
        "stores",
        "offers",
      ],
    ) ||

    !nonnegativeInteger(
      value.noops.stores,
    ) ||

    !nonnegativeInteger(
      value.noops.offers,
    )
  ) {
    return null;
  }

  const actual =
    value.counts.actual;

  const createdStores =
    createdEvidence(
      value.createdStores,
    );

  const createdOffers =
    createdEvidence(
      value.createdOffers,
    );

  if (
    createdStores === null ||
    createdOffers === null ||
    !Array.isArray(
      value.ledger,
    )
  ) {
    return null;
  }

  const instructions = [
    ...args
      ._store_instructions,

    ...args
      ._offer_instructions,
  ];

  if (
    value.ledger.length !==
      instructions.length ||
    actual.ledgerRows !==
      instructions.length
  ) {
    return null;
  }

  const storeEntities =
    new Map<string, string>();

  const seenEntities =
    new Set<string>();

  const seenIdentities =
    new Set<string>();

  const ledgerCreatedStores:
    AdsRefreshCreatedEvidenceV2[] = [];

  const ledgerCreatedOffers:
    AdsRefreshCreatedEvidenceV2[] = [];

  const ledger:
    AdsRefreshPersistenceLedgerEntryV2[] = [];

  let storesCreated =
    0;

  let storesUpdated =
    0;

  let storesNoop =
    0;

  let offersCreated =
    0;

  let offersUpdated =
    0;

  let offersNoop =
    0;

  for (
    let index = 0;
    index <
      value.ledger.length;
    index += 1
  ) {
    const entry =
      value.ledger[index];

    if (
      !isRecord(entry) ||

      !hasExactKeys(
        entry,
        [
          "instructionOrdinal",
          "entityKind",
          "plannedAction",
          "outcome",
          "provider",
          "providerEntityNamespace",
          "providerEntityId",
          "entityId",
          "expectedEntityId",
          "parentProviderEntityNamespace",
          "parentProviderEntityId",
          "parentEntityId",
          "offerKind",
        ],
      ) ||

      entry.instructionOrdinal !==
        index ||

      entry.provider !==
        "impact" ||

      !canonicalProviderId(
        entry.providerEntityId,
      ) ||

      !validUuid(
        entry.entityId,
      )
    ) {
      return null;
    }

    const instruction =
      instructions[index]!;

    const isStore =
      index <
        args
          ._store_instructions
          .length;

    if (
      entry.entityKind !==
        (
          isStore
            ? "store"
            : "offer"
        ) ||

      entry.plannedAction !==
        instruction.action ||

      entry.outcome !==
        expectedOutcome(
          instruction.action,
        ) ||

      entry.providerEntityNamespace !==
        instruction
          .providerEntityNamespace ||

      entry.providerEntityId !==
        instruction
          .providerEntityId
    ) {
      return null;
    }

    const expectedId =
      isStore
        ? args
          ._store_instructions[
            index
          ]!
          .expectedExistingStoreId
        : args
          ._offer_instructions[
            index -
              args
                ._store_instructions
                .length
          ]!
          .existingOfferId;

    if (
      expectedId === null
        ? entry.expectedEntityId !==
          null
        : (
          !validUuid(
            entry.expectedEntityId,
          ) ||
          !sameUuid(
            entry.expectedEntityId,
            expectedId,
          ) ||
          !sameUuid(
            entry.entityId,
            expectedId,
          )
        )
    ) {
      return null;
    }

    const entityKey =
      entry.entityId
        .toLowerCase();

    const identityKey =
      `${entry.providerEntityNamespace}\u0000${entry.providerEntityId}`;

    if (
      seenEntities.has(
        entityKey,
      ) ||
      seenIdentities.has(
        identityKey,
      )
    ) {
      return null;
    }

    seenEntities.add(
      entityKey,
    );

    seenIdentities.add(
      identityKey,
    );

    if (
      isStore
    ) {
      if (
        entry.providerEntityNamespace !==
          "campaign" ||

        entry.parentProviderEntityNamespace !==
          null ||

        entry.parentProviderEntityId !==
          null ||

        entry.parentEntityId !==
          null ||

        entry.offerKind !==
          null
      ) {
        return null;
      }

      storeEntities.set(
        entry.providerEntityId,
        entry.entityId,
      );

      if (
        entry.outcome ===
          "created"
      ) {
        storesCreated +=
          1;

        ledgerCreatedStores.push({
          entityId:
            entry.entityId,

          providerEntityId:
            entry.providerEntityId,
        });
      } else if (
        entry.outcome ===
          "updated_existing"
      ) {
        storesUpdated +=
          1;
      } else {
        storesNoop +=
          1;
      }
    } else {
      const offerInstruction =
        args
          ._offer_instructions[
            index -
              args
                ._store_instructions
                .length
          ]!;

      if (
        entry.providerEntityNamespace !==
          "ad" ||

        entry.parentProviderEntityNamespace !==
          "campaign" ||

        entry.parentProviderEntityId !==
          offerInstruction
            .parentProviderEntityId ||

        !validUuid(
          entry.parentEntityId,
        ) ||

        entry.offerKind !==
          "coupon"
      ) {
        return null;
      }

      const resolvedParent =
        storeEntities.get(
          offerInstruction
            .parentProviderEntityId,
        );

      if (
        resolvedParent ===
          undefined ||

        !sameUuid(
          resolvedParent,
          entry.parentEntityId,
        )
      ) {
        return null;
      }

      if (
        offerInstruction
          .expectedParentStoreId !==
            null &&

        !sameUuid(
          offerInstruction
            .expectedParentStoreId,
          entry.parentEntityId,
        )
      ) {
        return null;
      }

      if (
        entry.outcome ===
          "created"
      ) {
        offersCreated +=
          1;

        ledgerCreatedOffers.push({
          entityId:
            entry.entityId,

          providerEntityId:
            entry.providerEntityId,
        });
      } else if (
        entry.outcome ===
          "updated_existing"
      ) {
        offersUpdated +=
          1;
      } else {
        offersNoop +=
          1;
      }
    }

    ledger.push({
      instructionOrdinal:
        entry.instructionOrdinal as number,

      entityKind:
        entry.entityKind as
          | "store"
          | "offer",

      plannedAction:
        entry.plannedAction as
          | "create"
          | "noop_existing"
          | "update_existing",

      outcome:
        entry.outcome as
          | "created"
          | "noop_existing"
          | "updated_existing",

      provider:
        "impact",

      providerEntityNamespace:
        entry.providerEntityNamespace as
          | "campaign"
          | "ad",

      providerEntityId:
        entry.providerEntityId,

      entityId:
        entry.entityId,

      expectedEntityId:
        entry.expectedEntityId as
          string | null,

      parentProviderEntityNamespace:
        entry.parentProviderEntityNamespace as
          "campaign" | null,

      parentProviderEntityId:
        entry.parentProviderEntityId as
          string | null,

      parentEntityId:
        entry.parentEntityId as
          string | null,

      offerKind:
        entry.offerKind as
          "coupon" | null,
    });
  }

  if (
    storesCreated !==
      actual.storesCreated ||

    storesUpdated !==
      actual.storesUpdatedExisting ||

    storesNoop !==
      actual.storesNoopExisting ||

    offersCreated !==
      actual.offersCreated ||

    offersUpdated !==
      actual.offersUpdatedExisting ||

    offersNoop !==
      actual.offersNoopExisting ||

    value.noops.stores !==
      storesNoop ||

    value.noops.offers !==
      offersNoop ||

    createdStores.length !==
      storesCreated ||

    createdOffers.length !==
      offersCreated ||

    !sameCreatedEvidence(
      createdStores,
      ledgerCreatedStores,
    ) ||

    !sameCreatedEvidence(
      createdOffers,
      ledgerCreatedOffers,
    ) ||

    actual.ledgerRows !==
      storesCreated +
        storesUpdated +
        storesNoop +
        offersCreated +
        offersUpdated +
        offersNoop
  ) {
    return null;
  }

  return frozenClone({
    status:
      value.status,

    runId:
      value.runId,

    persistenceContractVersion:
      "v2-a11-ads-2",

    planFingerprintAlgorithm:
      ADS_REFRESH_PLAN_FINGERPRINT_ALGORITHM_V2,

    planFingerprint:
      value.planFingerprint,

    evaluationTimestamp:
      value.evaluationTimestamp,

    counts: {
      expected:
        value.counts.expected,

      actual,
    },

    createdStores,
    createdOffers,

    noops: {
      stores:
        value.noops.stores,

      offers:
        value.noops.offers,
    },

    ledger,
  });
}
