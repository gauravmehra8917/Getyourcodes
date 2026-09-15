import {
  AdsOfferQualification,
  AdsStoreMatcher,
  ImpactAdMerchantResolver,
  ImpactAdOfferNormalizer,
  RawAdDeduplicator,
  type ProviderStoreKey,
} from "../affiliate-sync-v2-ads/index.ts";
import {
  normalizeSiteOriginV2,
} from "../affiliate-presentation-v2/index.ts";

import {
  AdsPersistencePlannerV2,
  projectAdsOfferCreateProjectionV2,
  projectAdsStoreCreateProjectionV2,
  type AdsPersistencePlannerInputV2,
} from "./AdsPersistencePlannerV2.ts";

import type {
  AdsCatalogOfferFactV2,
  AdsCatalogStoreFactV2,
  AdsPersistenceBlockerReasonV2,
  AdsProviderManagedOfferStateV2,
  AdsProviderManagedStoreStateV2,
} from "./ads-persistence-models.ts";

import type {
  AdsRefreshPersistenceBlockerV2,
  AdsRefreshPersistenceOfferInstructionV2,
  AdsRefreshPersistencePlanV2,
  AdsRefreshPersistenceStoreInstructionV2,
  AdsUpdateOfferInstructionV2,
  AdsUpdateStoreInstructionV2,
} from "./ads-persistence-refresh-models.ts";

import {
  finalizeAdsRefreshPersistencePlanV2,
} from "./ads-persistence-refresh-finalizer.ts";

import {
  providerManagedOfferDesiredStateFromProjectionV2,
  providerManagedStoreDesiredStateFromProjectionV2,
} from "./provider-managed-desired-state.ts";

import {
  providerManagedOfferStateFromProjectionV2,
  providerManagedStoreStateFromProjectionV2,
} from "./provider-managed-state.ts";

import {
  decideProviderManagedOfferRefreshV2,
  decideProviderManagedStoreRefreshV2,
} from "./provider-refresh-decision.ts";

import {
  classifyExistingAdRefreshSourceV2,
} from "./provider-refresh-source-policy.ts";

import {
  classifyProviderManagedStoreOwnershipV2,
} from "./provider-refresh-ownership.ts";

type RefreshPlanBlockerV2 = Extract<
  AdsRefreshPersistenceBlockerV2,
  {
    source: "provider_refresh";
    scope: "plan";
  }
>;

type RefreshStoreBlockerV2 = Extract<
  AdsRefreshPersistenceBlockerV2,
  {
    source: "provider_refresh";
    scope: "store";
  }
>;

type RefreshOfferBlockerV2 = Extract<
  AdsRefreshPersistenceBlockerV2,
  {
    source: "provider_refresh";
    scope: "offer";
  }
>;

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

function storeKey(
  campaignId: string,
): ProviderStoreKey {
  return {
    provider: "impact",
    namespace: "campaign",
    id: campaignId,
  };
}

function copyStoreState(
  state: AdsProviderManagedStoreStateV2,
): AdsProviderManagedStoreStateV2 {
  return {
    affiliateUrl: state.affiliateUrl,
    metadata: {
      ...state.metadata,
    },
  };
}

function copyOfferState(
  state: AdsProviderManagedOfferStateV2,
): AdsProviderManagedOfferStateV2 {
  return {
    couponCode: state.couponCode,
    affiliateUrl: state.affiliateUrl,
    landingPageUrl: state.landingPageUrl,
    startDate: state.startDate,
    expiryDate: state.expiryDate,
    status: state.status,
    terms: state.terms,
    discountType: state.discountType,
    discountValue: state.discountValue,
    structuredTerms:
      state.structuredTerms === null
        ? null
        : { ...state.structuredTerms },
    metadata: {
      ...state.metadata,
    },
  };
}

function addGrouped<T>(
  map: Map<string, T[]>,
  id: string,
  value: T,
): void {
  const existing = map.get(id);

  if (existing) {
    existing.push(value);
    return;
  }

  map.set(id, [value]);
}

/**
 * Detached Ads-2 provider-managed refresh materializer.
 *
 * This module:
 * - starts from the settled Ads-1 plan,
 * - independently rebuilds trusted provider source evidence,
 * - independently revalidates identity, parentage and ownership,
 * - reuses the exact Ads-1 projection functions,
 * - emits at most one final instruction per provider identity,
 * - never executes persistence.
 */
export function materializeAdsRefreshPersistencePlanV2(
  input: AdsPersistencePlannerInputV2,
): AdsRefreshPersistencePlanV2 {
  const basePlan =
    AdsPersistencePlannerV2.plan(input);

  const storeInstructions:
    AdsRefreshPersistenceStoreInstructionV2[] =
      [...basePlan.storeInstructions];

  const offerInstructions:
    AdsRefreshPersistenceOfferInstructionV2[] =
      [...basePlan.offerInstructions];

  const additionalBlockers:
    AdsRefreshPersistenceBlockerV2[] = [];

  const blockerKeys = new Set<string>();

  const addPlanBlocker = (
    reason: AdsPersistenceBlockerReasonV2,
  ): void => {
    const key = `plan|${reason}`;

    if (blockerKeys.has(key)) return;
    blockerKeys.add(key);

    const blocker: RefreshPlanBlockerV2 = {
      source: "provider_refresh",
      scope: "plan",
      reason,
      providerEntityNamespace: null,
      providerEntityId: null,
    };

    additionalBlockers.push(blocker);
  };

  const addStoreBlocker = (
    campaignId: string,
    reason: RefreshStoreBlockerV2["reason"],
  ): void => {
    const key =
      `store|${campaignId}|${reason}`;

    if (blockerKeys.has(key)) return;
    blockerKeys.add(key);

    const blocker: RefreshStoreBlockerV2 = {
      source: "provider_refresh",
      scope: "store",
      reason,
      providerEntityNamespace: "campaign",
      providerEntityId: campaignId,
    };

    additionalBlockers.push(blocker);
  };

  const addOfferBlocker = (
    adId: string,
    reason: RefreshOfferBlockerV2["reason"],
  ): void => {
    const key =
      `offer|${adId}|${reason}`;

    if (blockerKeys.has(key)) return;
    blockerKeys.add(key);

    const blocker: RefreshOfferBlockerV2 = {
      source: "provider_refresh",
      scope: "offer",
      reason,
      providerEntityNamespace: "ad",
      providerEntityId: adId,
    };

    additionalBlockers.push(blocker);
  };

  const replaceStoreInstruction = (
    instruction:
      AdsRefreshPersistenceStoreInstructionV2,
  ): void => {
    const index =
      storeInstructions.findIndex(
        (entry) =>
          entry.providerEntityId ===
            instruction.providerEntityId,
      );

    if (index === -1) {
      storeInstructions.push(instruction);
      return;
    }

    storeInstructions[index] = instruction;
  };

  const replaceOfferInstruction = (
    instruction:
      AdsRefreshPersistenceOfferInstructionV2,
  ): void => {
    const index =
      offerInstructions.findIndex(
        (entry) =>
          entry.providerEntityId ===
            instruction.providerEntityId,
      );

    if (index === -1) {
      offerInstructions.push(instruction);
      return;
    }

    offerInstructions[index] = instruction;
  };

  /*
   * A blocked Ads-1 plan never becomes writable merely because Ads-2 exists.
   * Preserve its instructions and let the detached finalizer carry forward
   * the existing blockers/version-independent diagnostics.
   */
  if (basePlan.status !== "ready") {
    return finalizeAdsRefreshPersistencePlanV2({
      basePlan,
      storeInstructions,
      offerInstructions,
    });
  }

  const siteOrigin =
    normalizeSiteOriginV2(input.siteUrl);

  if (siteOrigin === null) {
    addPlanBlocker("invalid_context");

    return finalizeAdsRefreshPersistencePlanV2({
      basePlan,
      storeInstructions,
      offerInstructions,
      additionalBlockers,
    });
  }

  /*
   * Rebuild the trusted provider source exactly as the current planner and
   * preview do. No browser/client material enters this path.
   */
  const deduplicated =
    RawAdDeduplicator.deduplicate(
      input.adsFetch.records,
    );

  const selectedRaw =
    input.mode === "canary"
      ? deduplicated.uniqueAds.filter(
          (entry) =>
            entry.providerOfferKey.id ===
              input.canaryAdId,
        )
      : deduplicated.uniqueAds;

  const resolution =
    ImpactAdMerchantResolver.resolve(
      selectedRaw,
      input.campaignFetch.records,
    );

  const normalized =
    ImpactAdOfferNormalizer.normalize(
      resolution,
    );

  const matched =
    AdsStoreMatcher.match(
      normalized,
      { stores: [] },
    );

  const qualification =
    AdsOfferQualification.evaluate(
      matched,
      {
        evaluationTimestamp:
          input.evaluationTimestamp,
      },
    );

  const normalizedStoreByCampaign =
    new Map(
      normalized.stores.map(
        (store) => [
          store.campaignId,
          store,
        ],
      ),
    );

  const normalizedOfferByAd =
    new Map(
      normalized.offers.map(
        (offer) => [
          offer.providerOfferKey.id,
          offer,
        ],
      ),
    );

  const qualifiedByAd =
    new Map(
      qualification.offers.map(
        (entry) => [
          entry.offer.providerOfferKey.id,
          entry,
        ],
      ),
    );

  /*
   * Bounded exact catalog indexes.
   *
   * Promotion identities intentionally do not collide with Ad identity,
   * preserving the settled Ads-1 rule.
   */
  const campaignStores =
    new Map<string, AdsCatalogStoreFactV2[]>();

  const legacyStores =
    new Map<string, AdsCatalogStoreFactV2[]>();

  for (const store of input.catalog.stores) {
    if (
      store.provider !== "impact" ||
      store.providerEntityId === null
    ) {
      continue;
    }

    if (
      store.providerEntityNamespace ===
        "campaign"
    ) {
      addGrouped(
        campaignStores,
        store.providerEntityId,
        store,
      );
    } else if (
      store.providerEntityNamespace ===
        "legacy"
    ) {
      addGrouped(
        legacyStores,
        store.providerEntityId,
        store,
      );
    }
  }

  const adOffers =
    new Map<string, AdsCatalogOfferFactV2[]>();

  const legacyOffers =
    new Map<string, AdsCatalogOfferFactV2[]>();

  for (const offer of input.catalog.offers) {
    if (
      offer.providerEntityNamespace === "ad"
    ) {
      addGrouped(
        adOffers,
        offer.providerEntityId,
        offer,
      );
    } else if (
      offer.providerEntityNamespace ===
        "legacy"
    ) {
      addGrouped(
        legacyOffers,
        offer.providerEntityId,
        offer,
      );
    }
  }

  const processedCampaigns =
    new Set<string>();

  const processedAds =
    new Set<string>();

  const processExistingStore = (
    campaignId: string,
    existing: AdsCatalogStoreFactV2,
  ): void => {
    if (
      processedCampaigns.has(campaignId)
    ) {
      return;
    }

    processedCampaigns.add(campaignId);

    const exactMatches =
      campaignStores.get(campaignId) ?? [];

    const legacyMatches =
      legacyStores.get(campaignId) ?? [];

    if (exactMatches.length > 1) {
      addPlanBlocker(
        "duplicate_store_identity",
      );
      return;
    }

    if (legacyMatches.length > 0) {
      addPlanBlocker(
        "legacy_identity_collision",
      );
      return;
    }

    if (
      exactMatches.length !== 1 ||
      exactMatches[0]!.storeId !==
        existing.storeId
    ) {
      addStoreBlocker(
        campaignId,
        "invalid_projection",
      );
      return;
    }

    const ownership =
      classifyProviderManagedStoreOwnershipV2(
        existing,
      );

    if (ownership.action === "blocked") {
      addStoreBlocker(
        campaignId,
        ownership.reason,
      );
      return;
    }

    const sourceStore =
      normalizedStoreByCampaign.get(
        campaignId,
      );

    if (!sourceStore) {
      addStoreBlocker(
        campaignId,
        "invalid_projection",
      );
      return;
    }

    const projection =
      projectAdsStoreCreateProjectionV2(
        sourceStore,
        input.evaluationTimestamp,
        siteOrigin,
      );

    if (projection === null) {
      addStoreBlocker(
        campaignId,
        "invalid_projection",
      );
      return;
    }

    const current =
      existing.providerManagedState;

    if (
      current === null ||
      current === undefined
    ) {
      addStoreBlocker(
        campaignId,
        "missing_snapshot",
      );
      return;
    }

    const comparableDesired =
      providerManagedStoreStateFromProjectionV2(
        projection,
      );

    const decision =
      decideProviderManagedStoreRefreshV2(
        current,
        comparableDesired,
      );

    if (
      decision ===
        "blocked_missing_snapshot"
    ) {
      addStoreBlocker(
        campaignId,
        "missing_snapshot",
      );
      return;
    }

    if (decision === "noop_existing") {
      replaceStoreInstruction({
        action: "noop_existing",
        providerStoreKey:
          storeKey(campaignId),
        provider: "impact",
        providerEntityNamespace:
          "campaign",
        providerEntityId:
          campaignId,
        expectedExistingStoreId:
          existing.storeId,
        qualified: true,
        projection: null,
      });

      return;
    }

    const update:
      AdsUpdateStoreInstructionV2 = {
        action: "update_existing",
        providerStoreKey:
          storeKey(campaignId),
        provider: "impact",
        providerEntityNamespace:
          "campaign",
        providerEntityId:
          campaignId,
        expectedExistingStoreId:
          existing.storeId,
        qualified: true,
        expectedCurrentManagedState:
          copyStoreState(current),
        desiredManagedState:
          providerManagedStoreDesiredStateFromProjectionV2(
            projection,
          ),
      };

    replaceStoreInstruction(update);
  };

  const processExistingOffer = (
    adId: string,
    existing: AdsCatalogOfferFactV2,
    existingParent:
      AdsCatalogStoreFactV2,
  ): void => {
    if (processedAds.has(adId)) {
      return;
    }

    processedAds.add(adId);

    const qualified =
      qualifiedByAd.get(adId);

    if (!qualified) {
      addPlanBlocker(
        "identity_collapse_detected",
      );
      return;
    }

    /*
     * Parent ownership is authorization and therefore precedes source-quality
     * refresh policy exactly as established in D3A2.
     */
    const ownership =
      classifyProviderManagedStoreOwnershipV2(
        existingParent,
      );

    if (ownership.action === "blocked") {
      addOfferBlocker(
        adId,
        ownership.reason,
      );

      if (
        qualified.offer.association
          .matchMethod === "campaign_id" &&
        qualified.offer.association
          .providerStoreKey.id ===
            existingParent.providerEntityId
      ) {
        processExistingStore(
          qualified.offer.association
            .providerStoreKey.id,
          existingParent,
        );
      }

      return;
    }

    const sourceDisposition =
      classifyExistingAdRefreshSourceV2(
        qualified,
      );

    if (
      sourceDisposition.action ===
        "no_action"
    ) {
      return;
    }

    if (
      sourceDisposition.action ===
        "blocked"
    ) {
      addOfferBlocker(
        adId,
        sourceDisposition.blockReason,
      );

      if (
        qualified.offer.association
          .matchMethod === "campaign_id" &&
        qualified.offer.association
          .providerStoreKey.id ===
            existingParent.providerEntityId
      ) {
        processExistingStore(
          qualified.offer.association
            .providerStoreKey.id,
          existingParent,
        );
      }

      return;
    }

    if (
      qualified.offer.association
        .matchMethod !== "campaign_id"
    ) {
      addPlanBlocker(
        "incompatible_parent",
      );
      return;
    }

    const campaignId =
      qualified.offer.association
        .providerStoreKey.id;

    const exactCampaignMatches =
      campaignStores.get(campaignId) ??
        [];

    const legacyCampaignMatches =
      legacyStores.get(campaignId) ??
        [];

    if (
      exactCampaignMatches.length > 1
    ) {
      addPlanBlocker(
        "duplicate_store_identity",
      );
      return;
    }

    if (
      legacyCampaignMatches.length > 0
    ) {
      addPlanBlocker(
        "legacy_identity_collision",
      );
      return;
    }

    if (
      exactCampaignMatches.length !== 1
    ) {
      addPlanBlocker(
        "incompatible_parent",
      );
      return;
    }

    const parentStore =
      exactCampaignMatches[0]!;

    if (
      existing.storeId !==
        parentStore.storeId ||
      existingParent.storeId !==
        parentStore.storeId ||
      existingParent.providerEntityId !==
        campaignId
    ) {
      addPlanBlocker(
        "incompatible_parent",
      );
      return;
    }

    /*
     * Campaign refresh is independently materialized. This may append a
     * Campaign instruction when Ads-1 emitted only noop_held for an existing
     * future/expired Ad.
     */
    processExistingStore(
      campaignId,
      parentStore,
    );

    const sourceOffer =
      normalizedOfferByAd.get(adId);

    const sourceStore =
      normalizedStoreByCampaign.get(
        campaignId,
      );

    if (
      !sourceOffer ||
      !sourceStore
    ) {
      addOfferBlocker(
        adId,
        "invalid_projection",
      );
      return;
    }

    const projection =
      projectAdsOfferCreateProjectionV2(
        sourceOffer,
        sourceStore,
        parentStore.slug,
        input.evaluationTimestamp,
        siteOrigin,
      );

    if (projection === null) {
      addOfferBlocker(
        adId,
        "invalid_projection",
      );
      return;
    }

    const current =
      existing.providerManagedState;

    if (
      current === null ||
      current === undefined
    ) {
      addOfferBlocker(
        adId,
        "missing_snapshot",
      );
      return;
    }

    const comparableDesired =
      providerManagedOfferStateFromProjectionV2(
        projection,
      );

    const decision =
      decideProviderManagedOfferRefreshV2(
        current,
        comparableDesired,
      );

    if (
      decision ===
        "blocked_missing_snapshot"
    ) {
      addOfferBlocker(
        adId,
        "missing_snapshot",
      );
      return;
    }

    const parentProviderStoreKey =
      storeKey(campaignId);

    if (decision === "noop_existing") {
      replaceOfferInstruction({
        action: "noop_existing",
        providerOfferKey: {
          ...sourceOffer.providerOfferKey,
        },
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: adId,
        kind: "coupon",
        existingOfferId:
          existing.offerId,
        parentProviderStoreKey,
        parentProviderEntityNamespace:
          "campaign",
        parentProviderEntityId:
          campaignId,
        expectedParentStoreId:
          parentStore.storeId,
        projection: null,
      });

      return;
    }

    const update:
      AdsUpdateOfferInstructionV2 = {
        action: "update_existing",
        providerOfferKey: {
          ...sourceOffer.providerOfferKey,
        },
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: adId,
        kind: "coupon",
        existingOfferId:
          existing.offerId,
        parentProviderStoreKey,
        parentProviderEntityNamespace:
          "campaign",
        parentProviderEntityId:
          campaignId,
        expectedParentStoreId:
          parentStore.storeId,
        expectedCurrentManagedState:
          copyOfferState(current),
        desiredManagedState:
          providerManagedOfferDesiredStateFromProjectionV2(
            projection,
          ),
      };

    replaceOfferInstruction(update);
  };

  /*
   * First transform exact existing entities Ads-1 already emitted as
   * noop_existing.
   */
  for (
    const instruction of
      basePlan.storeInstructions
  ) {
    if (
      instruction.action !==
        "noop_existing"
    ) {
      continue;
    }

    const existing =
      input.catalog.stores.find(
        (store) =>
          store.storeId ===
            instruction
              .expectedExistingStoreId &&
          store.provider === "impact" &&
          store.providerEntityNamespace ===
            "campaign" &&
          store.providerEntityId ===
            instruction.providerEntityId,
      );

    if (!existing) {
      addStoreBlocker(
        instruction.providerEntityId,
        "invalid_projection",
      );

      processedCampaigns.add(
        instruction.providerEntityId,
      );

      continue;
    }

    processExistingStore(
      instruction.providerEntityId,
      existing,
    );
  }

  for (
    const instruction of
      basePlan.offerInstructions
  ) {
    if (
      instruction.action !==
        "noop_existing"
    ) {
      continue;
    }

    const existing =
      input.catalog.offers.find(
        (offer) =>
          offer.offerId ===
            instruction.existingOfferId &&
          offer.provider === "impact" &&
          offer.providerEntityNamespace ===
            "ad" &&
          offer.providerEntityId ===
            instruction.providerEntityId,
      );

    const parentStore =
      input.catalog.stores.find(
        (store) =>
          store.storeId ===
            instruction
              .expectedParentStoreId &&
          store.provider === "impact" &&
          store.providerEntityNamespace ===
            "campaign" &&
          store.providerEntityId ===
            instruction
              .parentProviderEntityId,
      );

    if (
      !existing ||
      !parentStore
    ) {
      addOfferBlocker(
        instruction.providerEntityId,
        "invalid_projection",
      );

      processedAds.add(
        instruction.providerEntityId,
      );

      continue;
    }

    processExistingOffer(
      instruction.providerEntityId,
      existing,
      parentStore,
    );
  }

  /*
   * Supplemental exact-existing pass.
   *
   * This is the critical lifecycle bridge:
   * Ads-1 can emit noop_held/noop_unresolved before exact-existing refresh
   * matching. New held Ads remain untouched because they have no exact
   * catalog Ad identity.
   */
  for (
    const sourceOffer of
      [...normalized.offers].sort(
        (left, right) =>
          compareText(
            left.providerOfferKey.id,
            right.providerOfferKey.id,
          ),
      )
  ) {
    const adId =
      sourceOffer.providerOfferKey.id;

    if (processedAds.has(adId)) {
      continue;
    }

    const exactAds =
      adOffers.get(adId) ?? [];

    const legacyAds =
      legacyOffers.get(adId) ?? [];

    /*
     * No exact historical Ad identity:
     * preserve Ads-1 CREATE/hold behavior verbatim.
     */
    if (
      exactAds.length === 0 &&
      legacyAds.length === 0
    ) {
      continue;
    }

    if (exactAds.length > 1) {
      addPlanBlocker(
        "duplicate_offer_identity",
      );
      processedAds.add(adId);
      continue;
    }

    if (legacyAds.length > 0) {
      addPlanBlocker(
        "legacy_identity_collision",
      );
      processedAds.add(adId);
      continue;
    }

    if (exactAds.length !== 1) {
      continue;
    }

    const existing =
      exactAds[0]!;

    if (existing.couponType !== "code") {
      addPlanBlocker(
        "offer_kind_conflict",
      );
      processedAds.add(adId);
      continue;
    }

    const existingParent =
      input.catalog.stores.find(
        (store) =>
          store.storeId ===
            existing.storeId &&
          store.provider === "impact" &&
          store.providerEntityNamespace ===
            "campaign" &&
          store.providerEntityId !== null,
      );

    if (!existingParent) {
      addPlanBlocker(
        "incompatible_parent",
      );
      processedAds.add(adId);
      continue;
    }

    processExistingOffer(
      adId,
      existing,
      existingParent,
    );
  }

  return finalizeAdsRefreshPersistencePlanV2({
    basePlan,
    storeInstructions,
    offerInstructions,
    additionalBlockers,
  });
}
