import {
  AdsOfferQualification,
  AdsStoreMatcher,
  ImpactAdMerchantResolver,
  ImpactAdOfferNormalizer,
  type ImpactAdsFetchResultV2,
  type ImpactCampaignFetchResultForAdsV2,
  type MatchedImpactAdOfferV2,
  type NormalizedImpactAdOfferV2,
  type NormalizedImpactAdStoreV2,
  type ProviderAdOfferKey,
  type ProviderStoreKey,
  RawAdDeduplicator,
} from "../affiliate-sync-v2-ads/index.ts";
import {
  couponCanonicalV2,
  couponSeoDescriptionV2,
  couponSeoTitleV2,
  generateTermsTextV2,
  isExplicitEvaluationTimestampV2,
  normalizeSiteOriginV2,
  projectEffectiveDatesV2,
  resolveOfferStatusV2,
  storeCanonicalV2,
  storeSeoDescriptionV2,
  storeSeoTitleV2,
  storeSlugCandidateV2,
} from "../affiliate-presentation-v2/index.ts";
import {
  ADS_PERSISTENCE_CONTRACT_VERSION_V2,
  type AdsBlockedOfferInstructionV2,
  type AdsBlockedStoreInstructionV2,
  type AdsCanonicalPersistencePlanMaterialV2,
  type AdsCatalogOfferFactV2,
  type AdsCatalogPlanningContextV2,
  type AdsCatalogStoreFactV2,
  type AdsOfferCreateProjectionV2,
  type AdsPersistenceBlockerReasonV2,
  type AdsPersistenceBlockerV2,
  type AdsPersistenceHoldReasonV2,
  type AdsPersistenceModeV2,
  type AdsPersistenceOfferInstructionV2,
  type AdsPersistencePlanCountsV2,
  type AdsPersistencePlanV2,
  type AdsPersistencePreconditionCodeV2,
  type AdsPersistencePreconditionV2,
  type AdsPersistenceStoreInstructionV2,
  type AdsStoreCreateProjectionV2,
} from "./ads-persistence-models.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRECONDITION_ORDER: readonly AdsPersistencePreconditionCodeV2[] = [
  "context_valid",
  "campaign_fetch_complete",
  "campaign_records_trustworthy",
  "ads_fetch_complete",
  "duplicate_conflicts_excluded",
  "identity_not_collapsed",
  "catalog_consistent",
  "store_projections_valid",
  "offer_projections_valid",
  "instruction_counts_reconcile",
];

export interface AdsPersistencePlannerInputV2 {
  integrationId: string;
  evaluationTimestamp: string;
  siteUrl: string;
  mode: AdsPersistenceModeV2;
  canaryAdId: string | null;
  campaignFetch: ImpactCampaignFetchResultForAdsV2;
  adsFetch: ImpactAdsFetchResultV2;
  catalog: AdsCatalogPlanningContextV2;
}

interface CatalogIndexesV2 {
  campaignStores: Map<string, AdsCatalogStoreFactV2[]>;
  legacyStores: Map<string, AdsCatalogStoreFactV2[]>;
  storesBySlug: Map<string, AdsCatalogStoreFactV2[]>;
  adOffers: Map<string, AdsCatalogOfferFactV2[]>;
  legacyOffers: Map<string, AdsCatalogOfferFactV2[]>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed === value ? value : null;
}

function trimmedText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function validHttpUrl(value: string | null): string | null {
  const text = trimmedText(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.origin === "null"
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sameAdKey(
  left: ProviderAdOfferKey,
  right: ProviderAdOfferKey,
): boolean {
  return left.provider === right.provider &&
    left.namespace === right.namespace &&
    left.id === right.id;
}

function storeKey(id: string): ProviderStoreKey {
  return { provider: "impact", namespace: "campaign", id };
}

function adKey(id: string): ProviderAdOfferKey {
  return { provider: "impact", namespace: "ad", id };
}

function addGrouped<T>(map: Map<string, T[]>, key: string, value: T): void {
  const entries = map.get(key);
  if (entries) entries.push(value);
  else map.set(key, [value]);
}

function catalogIndexes(
  catalog: AdsCatalogPlanningContextV2,
): CatalogIndexesV2 | null {
  const result: CatalogIndexesV2 = {
    campaignStores: new Map(),
    legacyStores: new Map(),
    storesBySlug: new Map(),
    adOffers: new Map(),
    legacyOffers: new Map(),
  };
  const storeIds = new Set<string>();
  for (const store of catalog.stores) {
    if (
      exactText(store.storeId) === null || exactText(store.slug) === null ||
      storeIds.has(store.storeId)
    ) return null;
    storeIds.add(store.storeId);
    addGrouped(result.storesBySlug, store.slug, store);
    if (
      store.provider === "impact" &&
      (store.providerEntityNamespace === "campaign" ||
        store.providerEntityNamespace === "legacy") &&
      exactText(store.providerEntityId) !== null
    ) {
      addGrouped(
        store.providerEntityNamespace === "campaign"
          ? result.campaignStores
          : result.legacyStores,
        store.providerEntityId!,
        store,
      );
    } else if (
      store.provider !== null || store.providerEntityNamespace !== null ||
      store.providerEntityId !== null
    ) {
      if (
        exactText(store.provider) === null ||
        exactText(store.providerEntityNamespace) === null ||
        exactText(store.providerEntityId) === null
      ) return null;
    }
  }
  const offerIds = new Set<string>();
  for (const offer of catalog.offers) {
    if (
      exactText(offer.offerId) === null || exactText(offer.storeId) === null ||
      exactText(offer.providerEntityId) === null ||
      offer.provider !== "impact" ||
      !storeIds.has(offer.storeId) || offerIds.has(offer.offerId) ||
      (offer.providerEntityNamespace !== "ad" &&
        offer.providerEntityNamespace !== "legacy" &&
        offer.providerEntityNamespace !== "promotion") ||
      (offer.couponType !== "code" && offer.couponType !== "deal")
    ) return null;
    offerIds.add(offer.offerId);
    if (offer.providerEntityNamespace === "ad") {
      addGrouped(result.adOffers, offer.providerEntityId, offer);
    } else if (offer.providerEntityNamespace === "legacy") {
      addGrouped(result.legacyOffers, offer.providerEntityId, offer);
    }
  }
  return result;
}

function completeFetch(
  fetch: ImpactCampaignFetchResultForAdsV2 | ImpactAdsFetchResultV2,
  stream: "campaigns" | "ads",
): boolean {
  const diagnostic = fetch.diagnostics;
  const quarantineTotal = Object.values(diagnostic.quarantineReasonCounts)
    .reduce((sum, count) => sum + count, 0);
  return diagnostic.stream === stream && diagnostic.complete &&
    diagnostic.stopReason === "completed" &&
    diagnostic.parseFailureReason === null &&
    diagnostic.recordsDiscardedByLimit === 0 &&
    diagnostic.acceptedRecords === fetch.records.length &&
    diagnostic.rawRecords ===
      diagnostic.acceptedRecords + diagnostic.quarantinedRecords &&
    quarantineTotal === diagnostic.quarantinedRecords;
}

function emptyFacts(): Record<AdsPersistencePreconditionCodeV2, boolean> {
  return Object.fromEntries(
    PRECONDITION_ORDER.map((code) => [code, true]),
  ) as Record<AdsPersistencePreconditionCodeV2, boolean>;
}

function blocker(
  reason: AdsPersistenceBlockerReasonV2,
  entity: AdsPersistenceBlockerV2["entity"],
  namespace: AdsPersistenceBlockerV2["providerEntityNamespace"] = null,
  id: string | null = null,
): AdsPersistenceBlockerV2 {
  return {
    reason,
    entity,
    providerEntityNamespace: namespace,
    providerEntityId: id,
  };
}

function orderedBlockers(
  values: readonly AdsPersistenceBlockerV2[],
): AdsPersistenceBlockerV2[] {
  const unique = new Map<string, AdsPersistenceBlockerV2>();
  for (const value of values) unique.set(JSON.stringify(value), value);
  return [...unique.values()].sort((left, right) =>
    compareText(left.reason, right.reason) ||
    compareText(left.entity, right.entity) ||
    compareText(
      left.providerEntityNamespace ?? "",
      right.providerEntityNamespace ?? "",
    ) ||
    compareText(left.providerEntityId ?? "", right.providerEntityId ?? "")
  );
}

function planCounts(
  stores: readonly AdsPersistenceStoreInstructionV2[],
  offers: readonly AdsPersistenceOfferInstructionV2[],
): AdsPersistencePlanCountsV2 {
  const storeCreate =
    stores.filter((value) => value.action === "create").length;
  const storeNoop =
    stores.filter((value) => value.action === "noop_existing").length;
  const offerCreate =
    offers.filter((value) => value.action === "create").length;
  const offerNoop =
    offers.filter((value) => value.action === "noop_existing").length;
  return {
    stores: {
      create: storeCreate,
      noopExisting: storeNoop,
      blockedAmbiguous:
        stores.filter((value) => value.action === "blocked").length,
      noopUnmatched: 0,
    },
    offers: {
      create: offerCreate,
      noopExisting: offerNoop,
      noopHeld:
        offers.filter((value) =>
          value.action === "noop_held" || value.action === "blocked"
        ).length,
      noopUnresolved:
        offers.filter((value) => value.action === "noop_unresolved").length,
    },
    writableStores: storeCreate,
    writableOffers: offerCreate,
    writableEntities: storeCreate + offerCreate,
  };
}

function preconditions(
  facts: Record<AdsPersistencePreconditionCodeV2, boolean>,
): AdsPersistencePreconditionV2[] {
  return PRECONDITION_ORDER.map((code) => ({ code, satisfied: facts[code] }));
}

function finalize(input: {
  integrationId: string;
  evaluationTimestamp: string;
  mode: AdsPersistenceModeV2;
  canaryAdId: string | null;
  blockers: readonly AdsPersistenceBlockerV2[];
  facts: Record<AdsPersistencePreconditionCodeV2, boolean>;
  stores: AdsPersistenceStoreInstructionV2[];
  offers: AdsPersistenceOfferInstructionV2[];
}): AdsPersistencePlanV2 {
  input.stores.sort((left, right) =>
    compareText(left.providerEntityId, right.providerEntityId) ||
    compareText(left.action, right.action)
  );
  input.offers.sort((left, right) =>
    compareText(left.providerEntityId, right.providerEntityId) ||
    compareText(left.action, right.action)
  );
  const blockers = orderedBlockers(input.blockers);
  const counts = planCounts(input.stores, input.offers);
  input.facts.instruction_counts_reconcile =
    counts.writableStores === counts.stores.create &&
    counts.writableOffers === counts.offers.create &&
    counts.writableEntities === counts.writableStores + counts.writableOffers;
  const material: AdsCanonicalPersistencePlanMaterialV2 = {
    persistenceContractVersion: ADS_PERSISTENCE_CONTRACT_VERSION_V2,
    provider: "impact",
    integrationId: input.integrationId,
    evaluationTimestamp: input.evaluationTimestamp,
    mode: input.mode,
    canaryAdId: input.canaryAdId,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    preconditions: preconditions(input.facts),
    storeInstructions: input.stores,
    offerInstructions: input.offers,
    counts,
  };
  return {
    ...material,
    canonicalPlanMaterial: material,
    canonicalPlanMaterialString: JSON.stringify(material),
  };
}

function blockedEmpty(
  input: AdsPersistencePlannerInputV2,
  reason: AdsPersistenceBlockerReasonV2,
  fact: AdsPersistencePreconditionCodeV2,
): AdsPersistencePlanV2 {
  const facts = emptyFacts();
  facts[fact] = false;
  return finalize({
    integrationId: input.integrationId,
    evaluationTimestamp: input.evaluationTimestamp,
    mode: input.mode,
    canaryAdId: input.canaryAdId,
    blockers: [blocker(reason, "plan")],
    facts,
    stores: [],
    offers: [],
  });
}

function storeProjection(
  store: NormalizedImpactAdStoreV2,
  evaluationTimestamp: string,
  siteOrigin: string,
): AdsStoreCreateProjectionV2 | null {
  const name = trimmedText(store.name);
  if (name === null) return null;
  const slug = storeSlugCandidateV2(name);
  const destinationUrl = validHttpUrl(store.destinationUrl);
  const trackingUrl = validHttpUrl(store.trackingUrl);
  return {
    name,
    slugCandidate: slug,
    description: null,
    affiliateUrl: destinationUrl,
    destinationUrl,
    country: null,
    shippingRegions: [],
    logoSourceUrl: null,
    metadata: {
      advertiserId: trimmedText(store.advertiserId),
      campaignId: store.campaignId,
      campaignName: name,
      destinationUrl,
      trackingUrl,
    },
    importOrigin: "provider",
    lifecycleManaged: true,
    lifecycleHidden: false,
    lastQualificationResult: "qualified",
    lastQualifiedAt: evaluationTimestamp,
    seoTitle: storeSeoTitleV2(name, evaluationTimestamp),
    seoDescription: storeSeoDescriptionV2(name),
    seoCanonicalUrl: storeCanonicalV2(siteOrigin, slug),
  };
}

function offerProjection(
  offer: NormalizedImpactAdOfferV2,
  store: NormalizedImpactAdStoreV2,
  parentStoreSlug: string,
  evaluationTimestamp: string,
  siteOrigin: string,
): AdsOfferCreateProjectionV2 | null {
  const title = trimmedText(offer.title);
  const storeName = trimmedText(store.name);
  if (
    title === null || storeName === null ||
    offer.codeClass !== "code_bearing" ||
    offer.validatedCouponCode.length === 0
  ) return null;
  const dates = projectEffectiveDatesV2({
    dealStartDate: offer.providerDealStartDate,
    startDate: offer.providerStartDate,
    dealEndDate: offer.providerDealEndDate,
    endDate: offer.providerEndDate,
  });
  if (!offer.dateFieldsValid || !dates.ok) return null;
  const adTracking = validHttpUrl(offer.trackingUrl);
  const campaignTracking = validHttpUrl(store.trackingUrl);
  const adLanding = validHttpUrl(offer.landingPageUrl);
  const campaignDestination = validHttpUrl(store.destinationUrl);
  const terms = generateTermsTextV2(offer.structuredTerms, dates.expiryDate);
  const providerStatus = trimmedText(offer.dealState)?.toLowerCase() ?? null;
  return {
    title,
    description: trimmedText(offer.description),
    couponCode: offer.validatedCouponCode,
    couponType: "code",
    affiliateUrl: adTracking ?? campaignTracking,
    landingPageUrl: adLanding ?? campaignDestination,
    startDate: dates.startDate,
    expiryDate: dates.expiryDate,
    status: resolveOfferStatusV2({
      providerStatus,
      startDate: dates.startDate,
      endDate: dates.expiryDate,
      evaluationTimestamp,
    }),
    terms,
    discountType: offer.discountType === "unknown" ? null : offer.discountType,
    discountValue: offer.discountValue,
    structuredTerms: offer.structuredTerms === null
      ? null
      : { ...offer.structuredTerms },
    metadata: {
      adId: offer.providerOfferKey.id,
      campaignId: store.campaignId,
      advertiserId: trimmedText(offer.advertiserId),
      dealId: trimmedText(offer.dealId),
      campaignName: storeName,
      adName: title,
      dealStartDate: offer.providerDealStartDate,
      dealEndDate: offer.providerDealEndDate,
      startDate: offer.providerStartDate,
      endDate: offer.providerEndDate,
    },
    seoTitle: couponSeoTitleV2(title, storeName, evaluationTimestamp),
    seoDescription: couponSeoDescriptionV2(title, storeName),
    seoCanonicalUrl: couponCanonicalV2(
      siteOrigin,
      parentStoreSlug,
      title,
    ),
  };
}

function heldInstruction(
  offerKey: ProviderAdOfferKey,
  action: "noop_held" | "noop_unresolved",
  reason: AdsPersistenceHoldReasonV2,
  parent: ProviderStoreKey | null,
): AdsPersistenceOfferInstructionV2 {
  return {
    action,
    providerOfferKey: { ...offerKey },
    provider: "impact",
    providerEntityNamespace: "ad",
    providerEntityId: offerKey.id,
    kind: "coupon",
    existingOfferId: null,
    parentProviderStoreKey: parent === null ? null : { ...parent },
    parentProviderEntityNamespace: parent === null ? null : "campaign",
    parentProviderEntityId: parent?.id ?? null,
    expectedParentStoreId: null,
    holdReason: reason,
    projection: null,
  };
}

function blockedOffer(
  offer: NormalizedImpactAdOfferV2,
  reason: AdsBlockedOfferInstructionV2["reason"],
  parent: ProviderStoreKey | null,
  existingOfferId: string | null = null,
  expectedParentStoreId: string | null = null,
): AdsBlockedOfferInstructionV2 {
  return {
    action: "blocked",
    providerOfferKey: { ...offer.providerOfferKey },
    provider: "impact",
    providerEntityNamespace: "ad",
    providerEntityId: offer.providerOfferKey.id,
    kind: "coupon",
    existingOfferId,
    parentProviderStoreKey: parent === null ? null : { ...parent },
    parentProviderEntityNamespace: parent === null ? null : "campaign",
    parentProviderEntityId: parent?.id ?? null,
    expectedParentStoreId,
    reason,
    projection: null,
  };
}

function blockedStore(
  campaignId: string,
  reason: AdsBlockedStoreInstructionV2["reason"],
): AdsBlockedStoreInstructionV2 {
  return {
    action: "blocked",
    providerStoreKey: storeKey(campaignId),
    provider: "impact",
    providerEntityNamespace: "campaign",
    providerEntityId: campaignId,
    reason,
    expectedExistingStoreId: null,
    qualified: false,
    projection: null,
  };
}

function sourceIdentityIsSafe(input: {
  selectedRawIds: readonly string[];
  normalizedOffers: readonly NormalizedImpactAdOfferV2[];
  normalizedStores: readonly NormalizedImpactAdStoreV2[];
}): boolean {
  const rawIds = new Set(input.selectedRawIds);
  const adIds = new Set(
    input.normalizedOffers.map((offer) => offer.providerOfferKey.id),
  );
  const campaignIds = new Set(
    input.normalizedStores.map((store) => store.campaignId),
  );
  const resolvedCampaignIds = new Set(
    input.normalizedOffers.flatMap((offer) =>
      offer.association.matchMethod === "campaign_id"
        ? [offer.association.providerStoreKey.id]
        : []
    ),
  );
  return rawIds.size === input.selectedRawIds.length &&
    adIds.size === input.normalizedOffers.length &&
    rawIds.size === adIds.size && [...rawIds].every((id) => adIds.has(id)) &&
    campaignIds.size === input.normalizedStores.length &&
    campaignIds.size === resolvedCampaignIds.size &&
    [...campaignIds].every((id) => resolvedCampaignIds.has(id));
}

/** Pure, deterministic Ads-to-transaction intent planner. */
export class AdsPersistencePlannerV2 {
  static plan(input: AdsPersistencePlannerInputV2): AdsPersistencePlanV2 {
    const validContext = UUID_PATTERN.test(input.integrationId) &&
      isExplicitEvaluationTimestampV2(input.evaluationTimestamp) &&
      normalizeSiteOriginV2(input.siteUrl) !== null &&
      ((input.mode === "full" && input.canaryAdId === null) ||
        (input.mode === "canary" && exactText(input.canaryAdId) !== null));
    if (!validContext) {
      return blockedEmpty(input, "invalid_context", "context_valid");
    }
    if (!completeFetch(input.campaignFetch, "campaigns")) {
      return blockedEmpty(
        input,
        "campaign_fetch_incomplete",
        "campaign_fetch_complete",
      );
    }
    if (input.campaignFetch.diagnostics.quarantinedRecords !== 0) {
      return blockedEmpty(
        input,
        "campaign_records_quarantined",
        "campaign_records_trustworthy",
      );
    }
    if (!completeFetch(input.adsFetch, "ads")) {
      return blockedEmpty(input, "ads_fetch_incomplete", "ads_fetch_complete");
    }
    const indexes = catalogIndexes(input.catalog);
    if (indexes === null) {
      return blockedEmpty(input, "invalid_context", "catalog_consistent");
    }

    const facts = emptyFacts();
    const blockers: AdsPersistenceBlockerV2[] = [];
    const stores: AdsPersistenceStoreInstructionV2[] = [];
    const offers: AdsPersistenceOfferInstructionV2[] = [];
    const siteOrigin = normalizeSiteOriginV2(input.siteUrl)!;
    const deduplicated = RawAdDeduplicator.deduplicate(input.adsFetch.records);
    const conflicts = new Map(
      deduplicated.conflictedProviderOfferKeys.map((key) => [key.id, key]),
    );
    let selectedRaw = deduplicated.uniqueAds;

    if (input.mode === "canary") {
      const canaryId = input.canaryAdId!;
      const conflicted = conflicts.get(canaryId);
      if (conflicted) {
        facts.duplicate_conflicts_excluded = false;
        blockers.push(blocker("canary_ad_conflicted", "offer", "ad", canaryId));
        offers.push(heldInstruction(
          conflicted,
          "noop_unresolved",
          "duplicate_identity_conflict",
          null,
        ));
        return finalize({
          integrationId: input.integrationId,
          evaluationTimestamp: input.evaluationTimestamp,
          mode: input.mode,
          canaryAdId: input.canaryAdId,
          blockers,
          facts,
          stores,
          offers,
        });
      }
      selectedRaw = deduplicated.uniqueAds.filter((ad) =>
        ad.providerOfferKey.id === canaryId
      );
      if (selectedRaw.length === 0) {
        blockers.push(blocker("canary_ad_not_found", "offer", "ad", canaryId));
        return finalize({
          integrationId: input.integrationId,
          evaluationTimestamp: input.evaluationTimestamp,
          mode: input.mode,
          canaryAdId: input.canaryAdId,
          blockers,
          facts,
          stores,
          offers,
        });
      }
    } else {
      for (const conflict of deduplicated.conflictedProviderOfferKeys) {
        offers.push(heldInstruction(
          conflict,
          "noop_unresolved",
          "duplicate_identity_conflict",
          null,
        ));
      }
    }

    const resolution = ImpactAdMerchantResolver.resolve(
      selectedRaw,
      input.campaignFetch.records,
    );
    const normalized = ImpactAdOfferNormalizer.normalize(resolution);
    const matched = AdsStoreMatcher.match(normalized, { stores: [] });
    const qualification = AdsOfferQualification.evaluate(matched, {
      evaluationTimestamp: input.evaluationTimestamp,
    });
    if (
      !sourceIdentityIsSafe({
        selectedRawIds: selectedRaw.map((ad) => ad.providerOfferKey.id),
        normalizedOffers: normalized.offers,
        normalizedStores: normalized.stores,
      })
    ) {
      facts.identity_not_collapsed = false;
      blockers.push(blocker("identity_collapse_detected", "plan"));
    }

    const normalizedStoreByCampaign = new Map(
      normalized.stores.map((store) => [store.campaignId, store]),
    );
    const matchedByAd = new Map(
      matched.offers.map((offer) => [offer.providerOfferKey.id, offer]),
    );
    const qualifiedByAd = new Map(
      qualification.offers.map((
        entry,
      ) => [entry.offer.providerOfferKey.id, entry]),
    );
    const candidates: NormalizedImpactAdOfferV2[] = [];

    for (const offer of normalized.offers) {
      const matchedOffer = matchedByAd.get(offer.providerOfferKey.id);
      const qualified = qualifiedByAd.get(offer.providerOfferKey.id);
      if (!matchedOffer || !qualified) {
        facts.identity_not_collapsed = false;
        blockers.push(
          blocker(
            "identity_collapse_detected",
            "offer",
            "ad",
            offer.providerOfferKey.id,
          ),
        );
        continue;
      }
      if (offer.codeClass !== "code_bearing") {
        offers.push(heldInstruction(
          offer.providerOfferKey,
          "noop_held",
          "missing_coupon_code",
          offer.association.matchMethod === "campaign_id"
            ? offer.association.providerStoreKey
            : null,
        ));
        if (input.mode === "canary") {
          blockers.push(
            blocker(
              "canary_ad_ineligible",
              "offer",
              "ad",
              offer.providerOfferKey.id,
            ),
          );
        }
        continue;
      }
      if (offer.association.matchMethod === "unmatched") {
        const holdReason = offer.association.unresolvedReason ===
            "campaign_advertiser_conflict"
          ? "identity_conflict"
          : "unresolved_store";
        offers.push(heldInstruction(
          offer.providerOfferKey,
          "noop_unresolved",
          holdReason,
          null,
        ));
        if (input.mode === "canary") {
          blockers.push(
            blocker(
              "canary_ad_ineligible",
              "offer",
              "ad",
              offer.providerOfferKey.id,
            ),
          );
        }
        continue;
      }
      if (!qualified.eligible || qualified.reason !== null) {
        offers.push(heldInstruction(
          offer.providerOfferKey,
          "noop_held",
          qualified.reason ?? "invalid_date",
          offer.association.providerStoreKey,
        ));
        if (input.mode === "canary") {
          blockers.push(
            blocker(
              "canary_ad_ineligible",
              "offer",
              "ad",
              offer.providerOfferKey.id,
            ),
          );
        }
        continue;
      }
      candidates.push(offer);
    }

    const candidateCampaigns = [
      ...new Set(candidates.map((offer) => offer.campaignId!)),
    ]
      .sort(compareText);
    const storeDecision = new Map<string, AdsPersistenceStoreInstructionV2>();
    const pendingCreates = new Map<string, AdsStoreCreateProjectionV2>();
    for (const campaignId of candidateCampaigns) {
      const normalizedStore = normalizedStoreByCampaign.get(campaignId);
      const campaignMatches = indexes.campaignStores.get(campaignId) ?? [];
      const legacyMatches = indexes.legacyStores.get(campaignId) ?? [];
      if (campaignMatches.length > 1) {
        facts.catalog_consistent = false;
        const decision = blockedStore(campaignId, "duplicate_store_identity");
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        blockers.push(
          blocker("duplicate_store_identity", "store", "campaign", campaignId),
        );
        continue;
      }
      if (legacyMatches.length > 0) {
        const decision = blockedStore(campaignId, "legacy_identity_collision");
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        blockers.push(
          blocker("legacy_identity_collision", "store", "campaign", campaignId),
        );
        continue;
      }
      if (campaignMatches.length === 1) {
        const match = campaignMatches[0]!;
        const decision: AdsPersistenceStoreInstructionV2 = {
          action: "noop_existing",
          providerStoreKey: storeKey(campaignId),
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: campaignId,
          expectedExistingStoreId: match.storeId,
          qualified: true,
          projection: null,
        };
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        continue;
      }
      if (!normalizedStore) {
        facts.store_projections_valid = false;
        const decision = blockedStore(campaignId, "invalid_store_projection");
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        blockers.push(
          blocker("invalid_store_projection", "store", "campaign", campaignId),
        );
        continue;
      }
      const projection = storeProjection(
        normalizedStore,
        input.evaluationTimestamp,
        siteOrigin,
      );
      if (!projection) {
        facts.store_projections_valid = false;
        const decision = blockedStore(campaignId, "invalid_store_projection");
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        blockers.push(
          blocker("invalid_store_projection", "store", "campaign", campaignId),
        );
        continue;
      }
      pendingCreates.set(campaignId, projection);
    }

    const campaignsByCandidateSlug = new Map<string, string[]>();
    for (const [campaignId, projection] of pendingCreates) {
      addGrouped(
        campaignsByCandidateSlug,
        projection.slugCandidate,
        campaignId,
      );
    }
    for (const [campaignId, projection] of pendingCreates) {
      const collidesWithCatalog =
        (indexes.storesBySlug.get(projection.slugCandidate) ?? [])
          .length > 0;
      const collidesWithPlan =
        (campaignsByCandidateSlug.get(projection.slugCandidate) ?? []).length >
          1;
      if (collidesWithCatalog || collidesWithPlan) {
        const decision = blockedStore(campaignId, "store_slug_collision");
        storeDecision.set(campaignId, decision);
        stores.push(decision);
        blockers.push(
          blocker("store_slug_collision", "store", "campaign", campaignId),
        );
      } else {
        const decision: AdsPersistenceStoreInstructionV2 = {
          action: "create",
          providerStoreKey: storeKey(campaignId),
          provider: "impact",
          providerEntityNamespace: "campaign",
          providerEntityId: campaignId,
          expectedExistingStoreId: null,
          qualified: true,
          projection,
        };
        storeDecision.set(campaignId, decision);
        stores.push(decision);
      }
    }

    for (
      const offer of candidates.sort((left, right) =>
        compareText(left.providerOfferKey.id, right.providerOfferKey.id)
      )
    ) {
      const campaignId = offer.campaignId!;
      const parent = storeDecision.get(campaignId);
      const normalizedStore = normalizedStoreByCampaign.get(campaignId);
      if (!parent || !normalizedStore || parent.action === "blocked") {
        const reason = parent?.action === "blocked" &&
            parent.reason === "legacy_identity_collision"
          ? "legacy_identity_collision"
          : "incompatible_parent";
        offers.push(blockedOffer(offer, reason, storeKey(campaignId)));
        blockers.push(
          blocker(reason, "offer", "ad", offer.providerOfferKey.id),
        );
        continue;
      }
      const existingAds = indexes.adOffers.get(offer.providerOfferKey.id) ?? [];
      const legacyAds = indexes.legacyOffers.get(offer.providerOfferKey.id) ??
        [];
      if (existingAds.length > 1) {
        facts.catalog_consistent = false;
        offers.push(blockedOffer(
          offer,
          "duplicate_offer_identity",
          storeKey(campaignId),
        ));
        blockers.push(
          blocker(
            "duplicate_offer_identity",
            "offer",
            "ad",
            offer.providerOfferKey.id,
          ),
        );
        continue;
      }
      if (legacyAds.length > 0) {
        offers.push(blockedOffer(
          offer,
          "legacy_identity_collision",
          storeKey(campaignId),
        ));
        blockers.push(
          blocker(
            "legacy_identity_collision",
            "offer",
            "ad",
            offer.providerOfferKey.id,
          ),
        );
        continue;
      }
      if (existingAds.length === 1) {
        const existing = existingAds[0]!;
        if (existing.couponType !== "code") {
          offers.push(blockedOffer(
            offer,
            "offer_kind_conflict",
            storeKey(campaignId),
            existing.offerId,
            parent.expectedExistingStoreId,
          ));
          blockers.push(
            blocker(
              "offer_kind_conflict",
              "offer",
              "ad",
              offer.providerOfferKey.id,
            ),
          );
          continue;
        }
        if (
          parent.action !== "noop_existing" ||
          existing.storeId !== parent.expectedExistingStoreId
        ) {
          offers.push(blockedOffer(
            offer,
            "incompatible_parent",
            storeKey(campaignId),
            existing.offerId,
            parent.expectedExistingStoreId,
          ));
          blockers.push(
            blocker(
              "incompatible_parent",
              "offer",
              "ad",
              offer.providerOfferKey.id,
            ),
          );
          continue;
        }
        offers.push({
          action: "noop_existing",
          providerOfferKey: { ...offer.providerOfferKey },
          provider: "impact",
          providerEntityNamespace: "ad",
          providerEntityId: offer.providerOfferKey.id,
          kind: "coupon",
          existingOfferId: existing.offerId,
          parentProviderStoreKey: storeKey(campaignId),
          parentProviderEntityNamespace: "campaign",
          parentProviderEntityId: campaignId,
          expectedParentStoreId: parent.expectedExistingStoreId,
          projection: null,
        });
        continue;
      }
      const parentSlug = parent.action === "create"
        ? parent.projection.slugCandidate
        : input.catalog.stores.find((store) =>
          store.storeId === parent.expectedExistingStoreId
        )?.slug ?? null;
      const projection = parentSlug === null ? null : offerProjection(
        offer,
        normalizedStore,
        parentSlug,
        input.evaluationTimestamp,
        siteOrigin,
      );
      if (!projection) {
        facts.offer_projections_valid = false;
        offers.push(blockedOffer(
          offer,
          "invalid_offer_projection",
          storeKey(campaignId),
          null,
          parent.expectedExistingStoreId,
        ));
        blockers.push(
          blocker(
            "invalid_offer_projection",
            "offer",
            "ad",
            offer.providerOfferKey.id,
          ),
        );
        continue;
      }
      offers.push({
        action: "create",
        providerOfferKey: { ...offer.providerOfferKey },
        provider: "impact",
        providerEntityNamespace: "ad",
        providerEntityId: offer.providerOfferKey.id,
        kind: "coupon",
        existingOfferId: null,
        parentProviderStoreKey: storeKey(campaignId),
        parentProviderEntityNamespace: "campaign",
        parentProviderEntityId: campaignId,
        expectedParentStoreId: parent.action === "noop_existing"
          ? parent.expectedExistingStoreId
          : null,
        projection,
      });
    }

    return finalize({
      integrationId: input.integrationId,
      evaluationTimestamp: input.evaluationTimestamp,
      mode: input.mode,
      canaryAdId: input.canaryAdId,
      blockers,
      facts,
      stores,
      offers,
    });
  }
}

export function adsPersistenceBlockerReasonCountsV2(
  plan: AdsPersistencePlanV2,
): Partial<Record<AdsPersistenceBlockerReasonV2, number>> {
  const result: Partial<Record<AdsPersistenceBlockerReasonV2, number>> = {};
  for (const entry of plan.blockers) {
    result[entry.reason] = (result[entry.reason] ?? 0) + 1;
  }
  return result;
}

export function planContainsAdIdentityV2(
  plan: AdsPersistencePlanV2,
  key: ProviderAdOfferKey,
): boolean {
  return plan.offerInstructions.some((instruction) =>
    sameAdKey(instruction.providerOfferKey, key)
  );
}
