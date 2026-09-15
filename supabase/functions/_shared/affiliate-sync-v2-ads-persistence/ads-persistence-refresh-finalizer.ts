import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  type AdsPersistencePlanV2,
} from "./ads-persistence-models.ts";

import {
  ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,
  type AdsRefreshCanonicalPersistencePlanMaterialV2,
  type AdsRefreshPersistenceBlockerV2,
  type AdsRefreshPersistenceOfferInstructionV2,
  type AdsRefreshPersistencePlanCountsV2,
  type AdsRefreshPersistencePlanV2,
  type AdsRefreshPersistenceStoreInstructionV2,
} from "./ads-persistence-refresh-models.ts";

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function canonicalJsonValue(
  value: unknown,
  path = "$",
): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `ads2_non_finite_number:${path}`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      canonicalJsonValue(
        entry,
        `${path}[${index}]`,
      )
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const object =
      value as Record<string, unknown>;

    const result: {
      [key: string]: CanonicalJsonValue;
    } = {};

    for (
      const key of Object.keys(object).sort()
    ) {
      const entry = object[key];

      if (entry === undefined) {
        throw new Error(
          `ads2_undefined_value:${path}.${key}`,
        );
      }

      result[key] = canonicalJsonValue(
        entry,
        `${path}.${key}`,
      );
    }

    return result;
  }

  throw new Error(
    `ads2_non_json_value:${path}`,
  );
}

export function canonicalAdsRefreshJsonV2(
  value: unknown,
): string {
  return JSON.stringify(
    canonicalJsonValue(value),
  );
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(
    canonicalAdsRefreshJsonV2(value),
  ) as T;
}

function compareText(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
    ? 1
    : 0;
}

function sortStoreInstructions(
  value:
    readonly AdsRefreshPersistenceStoreInstructionV2[],
): AdsRefreshPersistenceStoreInstructionV2[] {
  return canonicalClone([...value]).sort(
    (left, right) =>
      compareText(
        left.providerEntityId,
        right.providerEntityId,
      ) ||
      compareText(
        left.action,
        right.action,
      ),
  );
}

function sortOfferInstructions(
  value:
    readonly AdsRefreshPersistenceOfferInstructionV2[],
): AdsRefreshPersistenceOfferInstructionV2[] {
  return canonicalClone([...value]).sort(
    (left, right) =>
      compareText(
        left.providerEntityId,
        right.providerEntityId,
      ) ||
      compareText(
        left.action,
        right.action,
      ),
  );
}

function assertUniqueProviderIds(
  kind: "store" | "offer",
  entries:
    | readonly AdsRefreshPersistenceStoreInstructionV2[]
    | readonly AdsRefreshPersistenceOfferInstructionV2[],
): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    const id = entry.providerEntityId;

    if (!id || id !== id.trim()) {
      throw new Error(
        `ads2_invalid_${kind}_provider_id`,
      );
    }

    if (seen.has(id)) {
      throw new Error(
        `ads2_duplicate_${kind}_provider_id`,
      );
    }

    seen.add(id);
  }
}

function sortBlockers(
  blockers:
    readonly AdsRefreshPersistenceBlockerV2[],
): AdsRefreshPersistenceBlockerV2[] {
  return canonicalClone([...blockers]).sort(
    (left, right) =>
      compareText(
        canonicalAdsRefreshJsonV2(left),
        canonicalAdsRefreshJsonV2(right),
      ),
  );
}

function countsFor(
  basePlan: AdsPersistencePlanV2,
  stores:
    readonly AdsRefreshPersistenceStoreInstructionV2[],
  offers:
    readonly AdsRefreshPersistenceOfferInstructionV2[],
): AdsRefreshPersistencePlanCountsV2 {
  const storeCreate =
    stores.filter(
      (entry) => entry.action === "create",
    ).length;

  const storeUpdate =
    stores.filter(
      (entry) =>
        entry.action === "update_existing",
    ).length;

  const storeNoop =
    stores.filter(
      (entry) =>
        entry.action === "noop_existing",
    ).length;

  const offerCreate =
    offers.filter(
      (entry) => entry.action === "create",
    ).length;

  const offerUpdate =
    offers.filter(
      (entry) =>
        entry.action === "update_existing",
    ).length;

  const offerNoop =
    offers.filter(
      (entry) =>
        entry.action === "noop_existing",
    ).length;

  const offerHeld =
    offers.filter(
      (entry) =>
        entry.action === "noop_held",
    ).length;

  const offerUnresolved =
    offers.filter(
      (entry) =>
        entry.action === "noop_unresolved",
    ).length;

  const writableStores =
    storeCreate + storeUpdate;

  const writableOffers =
    offerCreate + offerUpdate;

  return {
    stores: {
      create: storeCreate,
      updateExisting: storeUpdate,
      noopExisting: storeNoop,

      /*
       * These are settled source/planning diagnostics from ads-1 rather than
       * direct instruction-action counts. Preserve them until the ads-2
       * materializer intentionally replaces their semantics.
       */
      blockedAmbiguous:
        basePlan.counts.stores.blockedAmbiguous,

      noopUnmatched:
        basePlan.counts.stores.noopUnmatched,
    },

    offers: {
      create: offerCreate,
      updateExisting: offerUpdate,
      noopExisting: offerNoop,
      noopHeld: offerHeld,
      noopUnresolved: offerUnresolved,
    },

    writableStores,

    writableOffers,

    writableEntities:
      writableStores + writableOffers,
  };
}

function hasBlockedInstruction(
  stores:
    readonly AdsRefreshPersistenceStoreInstructionV2[],
  offers:
    readonly AdsRefreshPersistenceOfferInstructionV2[],
): boolean {
  return stores.some(
    (entry) => entry.action === "blocked",
  ) ||
    offers.some(
      (entry) => entry.action === "blocked",
    );
}

export interface FinalizeAdsRefreshPersistencePlanV2Input {
  /**
   * Settled ads-1 plan supplies trusted run identity, source diagnostics and
   * preconditions. It is never modified.
   */
  basePlan: AdsPersistencePlanV2;

  /**
   * Fully materialized ads-2 instructions.
   *
   * D2 deliberately does not construct UPDATE material from preview data.
   */
  storeInstructions:
    readonly AdsRefreshPersistenceStoreInstructionV2[];

  offerInstructions:
    readonly AdsRefreshPersistenceOfferInstructionV2[];

  /**
   * Refresh-only blocker evidence discovered outside the settled ads-1 plan.
   */
  additionalBlockers?:
    readonly AdsRefreshPersistenceBlockerV2[];
}

/**
 * Detached deterministic ads-2 canonical finalizer.
 *
 * This function cannot execute a mutation and has no database/provider
 * dependency. It accepts only already-materialized instructions.
 */
export function finalizeAdsRefreshPersistencePlanV2(
  input: FinalizeAdsRefreshPersistencePlanV2Input,
): AdsRefreshPersistencePlanV2 {
  if (
    input.basePlan.persistenceContractVersion !==
      ADS_PERSISTENCE_CONTRACT_VERSION_V2
  ) {
    throw new Error(
      "ads2_requires_ads1_base_plan",
    );
  }

  const stores = sortStoreInstructions(
    input.storeInstructions,
  );

  const offers = sortOfferInstructions(
    input.offerInstructions,
  );

  assertUniqueProviderIds(
    "store",
    stores,
  );

  assertUniqueProviderIds(
    "offer",
    offers,
  );

  const blockers = sortBlockers([
    ...input.basePlan.blockers,
    ...(input.additionalBlockers ?? []),
  ]);

  const preconditions = canonicalClone(
    input.basePlan.preconditions,
  );

  const counts = countsFor(
    input.basePlan,
    stores,
    offers,
  );

  const status:
    "ready" | "blocked" =
      input.basePlan.status === "blocked" ||
        blockers.length > 0 ||
        hasBlockedInstruction(
          stores,
          offers,
        )
        ? "blocked"
        : "ready";

  const material:
    AdsRefreshCanonicalPersistencePlanMaterialV2 =
      {
        persistenceContractVersion:
          ADS_PERSISTENCE_REFRESH_CONTRACT_VERSION_V2,

        provider:
          input.basePlan.provider,

        integrationId:
          input.basePlan.integrationId,

        evaluationTimestamp:
          input.basePlan.evaluationTimestamp,

        mode:
          input.basePlan.mode,

        canaryAdId:
          input.basePlan.canaryAdId,

        status,

        blockers,

        preconditions,

        storeInstructions: stores,

        offerInstructions: offers,

        counts,
      };

  const canonicalPlanMaterial =
    canonicalClone(material);

  const canonicalPlanMaterialString =
    canonicalAdsRefreshJsonV2(
      canonicalPlanMaterial,
    );

  return {
    ...canonicalPlanMaterial,

    canonicalPlanMaterial,

    canonicalPlanMaterialString,
  };
}
