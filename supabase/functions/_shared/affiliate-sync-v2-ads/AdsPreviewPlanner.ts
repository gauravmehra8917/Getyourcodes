import type {
  AdsShadowPolicyConfigV2,
  ExistingAdsCatalogSnapshotV2,
  ProviderStoreKey,
  RawImpactAdV2,
} from "./ad-models.ts";
import { providerStoreKeyIdentityV2 } from "./ad-models.ts";
import type {
  AdsDealCardinalityDiagnosticsV2,
  AdsIdentityIntegrityDiagnosticsV2,
  AdsPolicyDiagnosticsV2,
  AffiliateSyncAdsPreviewDiagnosticsV2,
  ImpactAdsFetchDiagnosticsV2,
  ImpactAdsFetchStopReasonV2,
} from "./ads-diagnostics.ts";
import { AdsOfferQualification } from "./AdsOfferQualification.ts";
import { AdsPublishingSelection } from "./AdsPublishingSelection.ts";
import { AdsStoreMatcher } from "./AdsStoreMatcher.ts";
import { ImpactAdMerchantResolver } from "./ImpactAdMerchantResolver.ts";
import { ImpactAdOfferNormalizer } from "./ImpactAdOfferNormalizer.ts";
import type { ImpactAdsFetchResultV2 } from "./ImpactAdsClient.ts";
import type {
  ImpactCampaignFetchResultForAdsV2,
} from "./ImpactAdsCampaignClient.ts";
import { RawAdDeduplicator } from "./RawAdDeduplicator.ts";

export type AdsPreviewBlockedStageV2 = "campaign_fetch" | "ads_fetch";
export type AdsPreviewStopReasonV2 =
  | ImpactAdsFetchStopReasonV2
  | "campaign_records_quarantined";

export interface AdsPreviewPlanInputV2 {
  campaignFetch: ImpactCampaignFetchResultForAdsV2;
  /** Must be null when Campaign retrieval was not trustworthy-complete. */
  adsFetch: ImpactAdsFetchResultV2 | null;
  existingCatalogSnapshot: ExistingAdsCatalogSnapshotV2;
  policyConfig: AdsShadowPolicyConfigV2;
  evaluationTimestamp: string;
}

export interface AdsPreviewFetchSummaryV2 {
  campaigns: ImpactAdsFetchDiagnosticsV2;
  ads: ImpactAdsFetchDiagnosticsV2 | null;
}

export interface BlockedAdsPreviewPlanResultV2 {
  complete: false;
  stopReason: AdsPreviewStopReasonV2;
  blockedStage: AdsPreviewBlockedStageV2;
  evaluationTimestamp: string;
  fetch: AdsPreviewFetchSummaryV2;
  preview: null;
}

export interface CompletedAdsPreviewPlanResultV2 {
  complete: true;
  stopReason: "completed";
  blockedStage: null;
  evaluationTimestamp: string;
  fetch: {
    campaigns: ImpactAdsFetchDiagnosticsV2;
    ads: ImpactAdsFetchDiagnosticsV2;
  };
  preview: AffiliateSyncAdsPreviewDiagnosticsV2;
}

export type AdsPreviewPlanResultV2 =
  | BlockedAdsPreviewPlanResultV2
  | CompletedAdsPreviewPlanResultV2;

function blocked(
  input: AdsPreviewPlanInputV2,
  stage: AdsPreviewBlockedStageV2,
  stopReason: AdsPreviewStopReasonV2,
): BlockedAdsPreviewPlanResultV2 {
  return {
    complete: false,
    stopReason,
    blockedStage: stage,
    evaluationTimestamp: input.evaluationTimestamp,
    fetch: {
      campaigns: input.campaignFetch.diagnostics,
      ads: input.adsFetch?.diagnostics ?? null,
    },
    preview: null,
  };
}

function validateCompleteFetch(
  diagnostics: ImpactAdsFetchDiagnosticsV2,
  recordCount: number,
  stream: "ads" | "campaigns",
): void {
  if (
    diagnostics.stream !== stream || !diagnostics.complete ||
    diagnostics.stopReason !== "completed"
  ) throw new Error(`Expected a completed ${stream} fetch`);
  if (
    diagnostics.acceptedRecords !== recordCount ||
    diagnostics.recordsDiscardedByLimit !== 0 ||
    diagnostics.rawRecords !==
      diagnostics.acceptedRecords + diagnostics.quarantinedRecords
  ) throw new Error(`${stream} fetch diagnostics do not reconcile`);
  const quarantineTotal = Object.values(
    diagnostics.quarantineReasonCounts,
  ).reduce((total, count) => total + count, 0);
  if (quarantineTotal !== diagnostics.quarantinedRecords) {
    throw new Error(`${stream} quarantine diagnostics do not reconcile`);
  }
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function policyDiagnostics(
  selection: ReturnType<typeof AdsPublishingSelection.apply>,
  config: AdsShadowPolicyConfigV2,
): AdsPolicyDiagnosticsV2 {
  for (const [field, value] of Object.entries(config)) {
    nonNegativeInteger(value, field);
  }
  if (config.sourceNeutralMaxSelectedAdsPerStore !== 0) {
    throw new Error("A11-S3 selection must remain source-neutral and uncapped");
  }
  const couponEvaluation = config.minimumSelectedCoupons === 0
    ? "not_applicable" as const
    : "classification_dependent" as const;
  const dealEvaluation = config.minimumSelectedDeals === 0
    ? "not_applicable" as const
    : "classification_dependent" as const;
  const classificationDependent = couponEvaluation ===
      "classification_dependent" ||
    dealEvaluation === "classification_dependent";

  let pass = 0;
  let fail = 0;
  let dependent = 0;
  let passWith = 0;
  let passWithout = 0;
  let failWith = 0;
  let failWithout = 0;
  let dependentWith = 0;
  let dependentWithout = 0;
  for (const store of selection.stores) {
    const hasSelectedAds = store.selected.length > 0;
    const meetsSettledTotalMinimum = store.selected.length >=
      config.minimumTotalSelectedOffers;
    if (!meetsSettledTotalMinimum) {
      fail += 1;
      if (hasSelectedAds) failWith += 1;
      else failWithout += 1;
      continue;
    }
    if (classificationDependent) {
      dependent += 1;
      if (hasSelectedAds) dependentWith += 1;
      else dependentWithout += 1;
      continue;
    }
    pass += 1;
    if (hasSelectedAds) passWith += 1;
    else passWithout += 1;
  }
  return {
    couponCap: {
      value: config.maximumCouponsPerStore,
      evaluation: "classification_dependent",
    },
    dealCap: {
      value: config.maximumDealsPerStore,
      evaluation: "classification_dependent",
    },
    minimumSelectedCoupons: {
      value: config.minimumSelectedCoupons,
      evaluation: couponEvaluation,
    },
    minimumSelectedDeals: {
      value: config.minimumSelectedDeals,
      evaluation: dealEvaluation,
    },
    minimumTotalSelectedOffers: {
      value: config.minimumTotalSelectedOffers,
      evaluation: "evaluated",
    },
    storesEvaluated: selection.stores.length,
    policyQualificationPass: pass,
    policyQualificationFail: fail,
    policyQualificationClassificationDependent: dependent,
    storesWithSelectedAds: selection.diagnostics.storesWithSelectedAds,
    policyPassWithSelectedAds: passWith,
    policyPassWithoutSelectedAds: passWithout,
    policyFailWithSelectedAds: failWith,
    policyFailWithoutSelectedAds: failWithout,
    classificationDependentWithSelectedAds: dependentWith,
    classificationDependentWithoutSelectedAds: dependentWithout,
  };
}

function dealCardinality(
  uniqueAds: readonly RawImpactAdV2[],
): AdsDealCardinalityDiagnosticsV2 {
  const adsByDeal = new Map<string, Set<string>>();
  let without = 0;
  for (const ad of uniqueAds) {
    if (ad.dealId === null) {
      without += 1;
      continue;
    }
    const ids = adsByDeal.get(ad.dealId);
    if (ids) ids.add(ad.providerOfferKey.id);
    else adsByDeal.set(ad.dealId, new Set([ad.providerOfferKey.id]));
  }
  let one = 0;
  let multiple = 0;
  let maximum = 0;
  for (const ids of adsByDeal.values()) {
    if (ids.size === 1) one += 1;
    else if (ids.size > 1) multiple += 1;
    maximum = Math.max(maximum, ids.size);
  }
  return {
    adsWithDealId: uniqueAds.length - without,
    adsWithoutDealId: without,
    distinctDealIds: adsByDeal.size,
    dealIdsWithOneAd: one,
    dealIdsWithMultipleAds: multiple,
    maxAdsPerDeal: maximum,
  };
}

function adIdSet(
  values: Iterable<{ providerOfferKey: { id: string } }>,
): Set<string> {
  return new Set([...values].map((value) => value.providerOfferKey.id));
}

function storeKeySet(values: Iterable<ProviderStoreKey>): Set<string> {
  return new Set([...values].map(providerStoreKeyIdentityV2));
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size &&
    [...left].every((value) => right.has(value));
}

function identityIntegrity(input: {
  fetched: readonly RawImpactAdV2[];
  unique: readonly RawImpactAdV2[];
  resolution: ReturnType<typeof ImpactAdMerchantResolver.resolve>;
  normalized: ReturnType<typeof ImpactAdOfferNormalizer.normalize>;
  matched: ReturnType<typeof AdsStoreMatcher.match>;
  qualification: ReturnType<typeof AdsOfferQualification.evaluate>;
  selection: ReturnType<typeof AdsPublishingSelection.apply>;
}): AdsIdentityIntegrityDiagnosticsV2 {
  const fetchedIds = adIdSet(input.fetched);
  const uniqueIds = adIdSet(input.unique);
  const normalizedIds = adIdSet(input.normalized.offers);
  const dispositionOffers = [
    ...input.selection.stores.flatMap((store) => store.selected),
    ...input.selection.stores.flatMap((store) =>
      store.held.map((entry) => entry.offer)
    ),
    ...input.selection.unresolvedHeld.map((entry) => entry.offer),
  ];
  const dispositionIds = adIdSet(dispositionOffers);
  const resolvedKeys = storeKeySet(
    input.resolution.ads.flatMap((entry) =>
      entry.association.matchMethod === "unmatched"
        ? []
        : [entry.association.providerStoreKey]
    ),
  );
  const normalizedKeys = storeKeySet(
    input.normalized.stores.map((store) => store.providerStoreKey),
  );
  const matchedKeys = storeKeySet(
    input.matched.stores.map((store) => store.providerStoreKey),
  );
  const qualificationKeys = storeKeySet(
    input.selection.stores.map((store) => store.store.providerStoreKey),
  );
  const adIdentitySafe = sameSet(uniqueIds, normalizedIds) &&
    sameSet(uniqueIds, dispositionIds) &&
    input.unique.length === uniqueIds.size &&
    input.normalized.offers.length === uniqueIds.size &&
    input.qualification.offers.length === uniqueIds.size &&
    dispositionOffers.length === uniqueIds.size;
  const storeIdentitySafe = sameSet(resolvedKeys, normalizedKeys) &&
    sameSet(resolvedKeys, matchedKeys) &&
    sameSet(resolvedKeys, qualificationKeys) &&
    input.normalized.stores.length === normalizedKeys.size &&
    input.matched.stores.length === matchedKeys.size &&
    input.selection.stores.length === qualificationKeys.size;
  if (!adIdentitySafe || !storeIdentitySafe) {
    throw new Error("AdsPreviewPlanner detected identity collapse");
  }
  return {
    distinctAdIdsAfterFetch: fetchedIds.size,
    distinctAdIdsAfterDeduplication: uniqueIds.size,
    distinctAdIdsAfterNormalization: normalizedIds.size,
    distinctAdIdsAfterFinalDisposition: dispositionIds.size,
    distinctProviderStoreKeysAfterResolution: resolvedKeys.size,
    distinctProviderStoreKeysAfterNormalization: normalizedKeys.size,
    distinctProviderStoreKeysAfterMatching: matchedKeys.size,
    distinctProviderStoreKeysAfterQualification: qualificationKeys.size,
    identityCollapseDetected: false,
  };
}

/** End-to-end aggregate-only Ads preview. No persistence action is modeled. */
export class AdsPreviewPlanner {
  static plan(input: AdsPreviewPlanInputV2): AdsPreviewPlanResultV2 {
    const campaignDiagnostics = input.campaignFetch.diagnostics;
    if (
      !campaignDiagnostics.complete ||
      campaignDiagnostics.stopReason !== "completed"
    ) {
      if (input.adsFetch !== null) {
        throw new Error("Ads must not be fetched after incomplete Campaigns");
      }
      return blocked(
        input,
        "campaign_fetch",
        campaignDiagnostics.stopReason,
      );
    }
    validateCompleteFetch(
      campaignDiagnostics,
      input.campaignFetch.records.length,
      "campaigns",
    );
    if (campaignDiagnostics.quarantinedRecords > 0) {
      if (input.adsFetch !== null) {
        throw new Error(
          "Ads must not be fetched with a partial Campaign index",
        );
      }
      return blocked(
        input,
        "campaign_fetch",
        "campaign_records_quarantined",
      );
    }
    if (input.adsFetch === null) {
      throw new Error("A completed Campaign fetch requires an Ads fetch");
    }
    if (
      !input.adsFetch.diagnostics.complete ||
      input.adsFetch.diagnostics.stopReason !== "completed"
    ) {
      return blocked(
        input,
        "ads_fetch",
        input.adsFetch.diagnostics.stopReason,
      );
    }
    validateCompleteFetch(
      input.adsFetch.diagnostics,
      input.adsFetch.records.length,
      "ads",
    );

    const deduplicated = RawAdDeduplicator.deduplicate(
      input.adsFetch.records,
    );
    const resolution = ImpactAdMerchantResolver.resolve(
      deduplicated.uniqueAds,
      input.campaignFetch.records,
    );
    const normalized = ImpactAdOfferNormalizer.normalize(resolution);
    const matched = AdsStoreMatcher.match(
      normalized,
      input.existingCatalogSnapshot,
    );
    const qualification = AdsOfferQualification.evaluate(matched, {
      evaluationTimestamp: input.evaluationTimestamp,
    });
    const selection = AdsPublishingSelection.apply(matched, qualification, {
      sourceNeutralMaxSelectedAdsPerStore:
        input.policyConfig.sourceNeutralMaxSelectedAdsPerStore,
    });
    const policy = policyDiagnostics(selection, input.policyConfig);
    const identity = identityIntegrity({
      fetched: input.adsFetch.records,
      unique: deduplicated.uniqueAds,
      resolution,
      normalized,
      matched,
      qualification,
      selection,
    });

    return {
      complete: true,
      stopReason: "completed",
      blockedStage: null,
      evaluationTimestamp: input.evaluationTimestamp,
      fetch: {
        campaigns: campaignDiagnostics,
        ads: input.adsFetch.diagnostics,
      },
      preview: {
        deduplication: deduplicated.diagnostics,
        campaignIndex: resolution.campaignIndex.diagnostics,
        merchantIdentity: resolution.diagnostics,
        normalization: normalized.diagnostics,
        storeMatching: matched.diagnostics,
        qualification: qualification.diagnostics,
        selection: selection.diagnostics,
        policy,
        dealCardinality: dealCardinality(deduplicated.uniqueAds),
        identityIntegrity: identity,
        existingOfferMatching: "not_evaluated",
      },
    };
  }
}
