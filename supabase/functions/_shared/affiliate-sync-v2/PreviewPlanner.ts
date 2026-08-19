import type {
  AdvertiserDistributionV2,
  ImpactParserDiagnosticsV2,
  ImpactStreamFetchDiagnosticsV2,
  PreviewIdentityIntegrityDiagnosticsV2,
  PromotionDeduplicationDiagnosticsV2,
  QuarantinedImpactRecordV2,
  RawFetchDiagnosticsV2,
  StoreCoverageV2,
} from "./diagnostics.ts";
import { ImpactMerchantResolver } from "./ImpactMerchantResolver.ts";
import { ImpactOfferNormalizer } from "./ImpactOfferNormalizer.ts";
import { OfferQualification } from "./OfferQualification.ts";
import {
  PublishingPolicy,
  StoreQualification,
  type PublishingHoldReasonV2,
  type PublishingPolicyConfigV2,
  type StoreQualificationConfigV2,
} from "./PublishingPolicy.ts";
import { RawPromotionDeduplicator } from "./RawPromotionDeduplicator.ts";
import {
  StoreOfferMatcher,
  type MatchedNormalizedCouponV2,
  type MatchedNormalizedDealV2,
} from "./StoreOfferMatcher.ts";
import type {
  AffiliateSyncPreviewV2,
  ExistingCatalogSnapshotV2,
  PreviewOfferAssociationV2,
  ProposedActionsV2,
  ProposedOfferActionV2,
  ProposedOfferKindCountsV2,
  ProposedResolvedStoreActionV2,
  ProposedStoreActionV2,
  ProviderStoreKey,
  RawImpactCampaignV2,
  RawImpactPromotionV2,
  StoreOfferAssociationV2,
} from "./models.ts";

export interface AffiliateSyncPreviewInputV2 {
  acceptedPromotions: readonly RawImpactPromotionV2[];
  acceptedCampaigns: readonly RawImpactCampaignV2[];
  fetchDiagnostics: {
    promotions: ImpactStreamFetchDiagnosticsV2;
    campaigns: ImpactStreamFetchDiagnosticsV2;
  };
  quarantinedRecords: readonly QuarantinedImpactRecordV2[];
  existingCatalogSnapshot: ExistingCatalogSnapshotV2;
  publishingPolicyConfig: PublishingPolicyConfigV2;
  storeQualificationConfig: StoreQualificationConfigV2;
  evaluationTimestamp: string;
  /** Bounds display details only; exact aggregate counters remain complete. */
  diagnosticDetailLimit?: number;
}

type MatchedOfferV2 = MatchedNormalizedCouponV2 | MatchedNormalizedDealV2;

const DEFAULT_DIAGNOSTIC_DETAIL_LIMIT = 100;

function detailLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DIAGNOSTIC_DETAIL_LIMIT;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("diagnosticDetailLimit must be a non-negative integer");
  }
  return value;
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function keyIdentity(key: ProviderStoreKey): string {
  if (key.provider !== "impact" || key.namespace !== "campaign" || !key.id) {
    throw new Error("PreviewPlanner accepts only Impact campaign provider-store keys");
  }
  return JSON.stringify([key.provider, key.namespace, key.id]);
}

function parserDiagnostics(
  records: readonly QuarantinedImpactRecordV2[],
): ImpactParserDiagnosticsV2 {
  const quarantinedPromotions = records.filter((entry) => entry.stream === "promotions").length;
  const quarantinedCampaigns = records.filter((entry) => entry.stream === "campaigns").length;
  return {
    quarantinedRecords: records.length,
    quarantinedPromotions,
    quarantinedCampaigns,
    quarantineDetails: [],
    quarantineDetailsReturned: 0,
    quarantineDetailsTruncated: records.length > 0,
  };
}

function deduplicationDiagnostics(
  result: ReturnType<typeof RawPromotionDeduplicator.deduplicate>,
): PromotionDeduplicationDiagnosticsV2 {
  return {
    acceptedInputRecords: result.stats.acceptedInputRecords,
    uniquePromotions: result.stats.uniquePromotions,
    duplicateRecordsRemoved: result.stats.duplicateRecordsRemoved,
    duplicatedIdentities: result.stats.duplicatedIdentities,
    identitiesWithConflictingProviderFields: result.stats.identitiesWithConflictingProviderFields,
    duplicateDetails: result.duplicateDiagnostics,
    duplicateDetailsReturned: result.stats.duplicateDetailsReturned,
    duplicateDetailsTruncated: result.stats.duplicateDetailsTruncated,
  };
}

function rawFetchDiagnostics(
  input: AffiliateSyncPreviewInputV2,
  parser: ImpactParserDiagnosticsV2,
  deduplication: PromotionDeduplicationDiagnosticsV2,
): RawFetchDiagnosticsV2 {
  return {
    promotions: input.fetchDiagnostics.promotions,
    campaigns: input.fetchDiagnostics.campaigns,
    uniquePromotionCount: deduplication.uniquePromotions,
    duplicatePromotionCount: deduplication.duplicateRecordsRemoved,
    duplicatedPromotionIdentities: deduplication.duplicatedIdentities,
    duplicates: deduplication.duplicateDetails,
    duplicateDetailsReturned: deduplication.duplicateDetailsReturned,
    duplicateDetailsTruncated: deduplication.duplicateDetailsTruncated,
    quarantinedRecords: parser.quarantineDetails,
    quarantinedDetailsReturned: parser.quarantineDetailsReturned,
    quarantinedDetailsTruncated: parser.quarantineDetailsTruncated,
  };
}

function advertiserDistribution(
  promotions: readonly RawImpactPromotionV2[],
  limit: number,
): { entries: AdvertiserDistributionV2[]; total: number; truncated: boolean } {
  const byAdvertiser = new Map<string, AdvertiserDistributionV2>();
  for (const promotion of promotions) {
    const identity = JSON.stringify([promotion.advertiserId]);
    const current = byAdvertiser.get(identity);
    if (current) current.promotionCount += 1;
    else {
      byAdvertiser.set(identity, {
        advertiserId: promotion.advertiserId,
        advertiserName: promotion.advertiserName,
        promotionCount: 1,
      });
    }
  }
  const ordered = [...byAdvertiser.values()].sort((left, right) => {
    if (left.promotionCount !== right.promotionCount) return right.promotionCount - left.promotionCount;
    if (left.advertiserId === null && right.advertiserId !== null) return 1;
    if (left.advertiserId !== null && right.advertiserId === null) return -1;
    const idOrder = compareOpaque(left.advertiserId ?? "", right.advertiserId ?? "");
    return idOrder || compareOpaque(left.advertiserName ?? "", right.advertiserName ?? "");
  });
  const entries = ordered.slice(0, limit);
  return { entries, total: ordered.length, truncated: entries.length < ordered.length };
}

function snapshotStoreIds(snapshot: ExistingCatalogSnapshotV2): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const store of snapshot.stores) {
    if (!store.id) throw new Error("PreviewPlanner snapshot store IDs must be nonempty");
    const identity = keyIdentity(store.providerStoreKey);
    const ids = result.get(identity);
    if (ids) ids.add(store.id);
    else result.set(identity, new Set([store.id]));
  }
  return result;
}

function selectedAndHeldReasons(policy: AffiliateSyncPreviewV2["publishingPolicy"]): {
  selected: Set<string>;
  heldReasons: Map<string, PublishingHoldReasonV2>;
} {
  const selected = new Set<string>();
  for (const offer of [...policy.selectedCoupons, ...policy.selectedDeals]) {
    if (selected.has(offer.promotionId)) throw new Error("PreviewPlanner received a duplicate selected PromotionId");
    selected.add(offer.promotionId);
  }
  const heldReasons = new Map<string, PublishingHoldReasonV2>();
  for (const entry of [...policy.heldCoupons, ...policy.heldDeals]) {
    if (heldReasons.has(entry.offer.promotionId) || selected.has(entry.offer.promotionId)) {
      throw new Error("PreviewPlanner requires disjoint selected and held PromotionIds");
    }
    heldReasons.set(entry.offer.promotionId, entry.reason);
  }
  return { selected, heldReasons };
}

function offerAction(
  offer: MatchedOfferV2,
  selected: ReadonlySet<string>,
  heldReasons: ReadonlyMap<string, PublishingHoldReasonV2>,
): ProposedOfferActionV2 {
  const base = {
    kind: offer.kind,
    promotionId: offer.promotionId,
    existingPromotionIdentity: offer.existingPromotionIdentity,
    existingOfferId: offer.existingOfferId,
  };
  if (offer.association.matchMethod === "unmatched") {
    if (selected.has(offer.promotionId) || heldReasons.get(offer.promotionId) !== "unresolved_store") {
      throw new Error("PreviewPlanner cannot select or repair an unresolved offer");
    }
    return {
      ...base,
      action: "unresolved",
      providerStoreKey: null,
      matchedStoreId: null,
      holdReason: "unresolved_store",
      unresolvedReason: offer.association.unresolvedReason,
    };
  }

  if (selected.has(offer.promotionId)) {
    const common = {
      ...base,
      providerStoreKey: { ...offer.association.providerStoreKey },
      matchedStoreId: offer.association.matchedStoreId,
      holdReason: null,
      unresolvedReason: null,
    };
    return offer.existingPromotionIdentity === "existing"
      ? { ...common, action: "existing" }
      : { ...common, action: "create" };
  }

  const reason = heldReasons.get(offer.promotionId);
  if (reason === undefined || reason === "unresolved_store") {
    throw new Error("PreviewPlanner requires one explicit final action per resolved offer");
  }
  return {
    ...base,
    action: "held",
    providerStoreKey: { ...offer.association.providerStoreKey },
    matchedStoreId: offer.association.matchedStoreId,
    holdReason: reason,
    unresolvedReason: null,
  };
}

function offerKindCounts(
  actions: readonly ProposedOfferActionV2[],
  kind: "coupon" | "deal",
): ProposedOfferKindCountsV2 {
  const relevant = actions.filter((action) => action.kind === kind);
  const existing = relevant.filter((action) => action.action === "existing").length;
  const proposedCreate = relevant.filter((action) => action.action === "create").length;
  return {
    normalized: relevant.length,
    selected: existing + proposedCreate,
    held: relevant.filter((action) => action.action === "held").length,
    unresolved: relevant.filter((action) => action.action === "unresolved").length,
    existing,
    proposedCreate,
  };
}

function setOfKeys(keys: Iterable<ProviderStoreKey>): Set<string> {
  return new Set([...keys].map(keyIdentity));
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function identityIntegrity(input: {
  associations: readonly PreviewOfferAssociationV2[];
  normalizedStoreKeys: readonly ProviderStoreKey[];
  policyStoreKeys: readonly ProviderStoreKey[];
  qualificationStoreKeys: readonly ProviderStoreKey[];
  resolverAssociations: readonly { promotionId: string; association: StoreOfferAssociationV2 }[];
}): PreviewIdentityIntegrityDiagnosticsV2 {
  const resolved = setOfKeys(input.resolverAssociations.flatMap((entry) =>
    entry.association.matchMethod === "unmatched" || entry.association.providerStoreKey === null
      ? []
      : [entry.association.providerStoreKey]));
  const normalized = setOfKeys(input.normalizedStoreKeys);
  const matched = setOfKeys(input.associations.flatMap((entry) =>
    entry.association.matchMethod === "unmatched" ? [] : [entry.association.providerStoreKey]));
  const policy = setOfKeys(input.policyStoreKeys);
  const qualification = setOfKeys(input.qualificationStoreKeys);
  const finalByPromotionId = new Map(input.associations.map((entry) => [entry.promotionId, entry.association]));
  let associationChanged = finalByPromotionId.size !== input.resolverAssociations.length;
  for (const resolvedAssociation of input.resolverAssociations) {
    const finalAssociation = finalByPromotionId.get(resolvedAssociation.promotionId);
    if (!finalAssociation) {
      associationChanged = true;
      continue;
    }
    if (resolvedAssociation.association.matchMethod === "unmatched") {
      if (
        finalAssociation.matchMethod !== "unmatched" ||
        finalAssociation.unresolvedReason !== resolvedAssociation.association.unresolvedReason ||
        finalAssociation.providerStoreKey !== null ||
        finalAssociation.matchedStoreId !== null
      ) associationChanged = true;
    } else if (
      finalAssociation.matchMethod === "unmatched" ||
      finalAssociation.matchMethod !== resolvedAssociation.association.matchMethod ||
      keyIdentity(finalAssociation.providerStoreKey) !== keyIdentity(resolvedAssociation.association.providerStoreKey)
    ) {
      associationChanged = true;
    }
  }
  const duplicateStoreRows =
    normalized.size !== input.normalizedStoreKeys.length ||
    policy.size !== input.policyStoreKeys.length ||
    qualification.size !== input.qualificationStoreKeys.length;
  const identityCollapseDetected = associationChanged || duplicateStoreRows || !(
    sameSet(resolved, normalized) &&
    sameSet(resolved, matched) &&
    sameSet(resolved, policy) &&
    sameSet(resolved, qualification)
  );
  if (identityCollapseDetected) {
    throw new Error("PreviewPlanner detected provider-store identity collapse");
  }
  return {
    distinctResolvedProviderStoreKeys: resolved.size,
    normalizedProviderStoreKeys: normalized.size,
    matchedProviderStoreKeys: matched.size,
    policyProviderStoreKeys: policy.size,
    qualificationProviderStoreKeys: qualification.size,
    identityCollapseDetected: false,
  };
}

function proposedActions(input: {
  offers: readonly MatchedOfferV2[];
  normalizedStoreKeys: readonly ProviderStoreKey[];
  snapshot: ExistingCatalogSnapshotV2;
  policy: AffiliateSyncPreviewV2["publishingPolicy"];
  qualification: AffiliateSyncPreviewV2["storeQualification"];
  duplicateRecordsRemoved: number;
  quarantinedRecords: number;
}): ProposedActionsV2 {
  const { selected, heldReasons } = selectedAndHeldReasons(input.policy);
  const offers = input.offers
    .map((offer) => offerAction(offer, selected, heldReasons))
    .sort((left, right) => compareOpaque(left.promotionId, right.promotionId));
  if (new Set(offers.map((action) => action.promotionId)).size !== offers.length) {
    throw new Error("PreviewPlanner requires exactly one final action per PromotionId");
  }

  const snapshotIds = snapshotStoreIds(input.snapshot);
  const qualificationByKey = new Map(input.qualification.map((entry) => [keyIdentity(entry.providerStoreKey), entry]));
  const policyByKey = new Map(input.policy.stores.map((entry) => [keyIdentity(entry.providerStoreKey), entry]));
  const resolvedStores: ProposedResolvedStoreActionV2[] = [...input.normalizedStoreKeys]
    .sort((left, right) => compareOpaque(keyIdentity(left), keyIdentity(right)))
    .map((providerStoreKey) => {
      const identity = keyIdentity(providerStoreKey);
      const ids = [...(snapshotIds.get(identity) ?? [])].sort(compareOpaque);
      const policyStore = policyByKey.get(identity);
      if (!policyStore) throw new Error("PreviewPlanner requires every resolved store to reach policy grouping");
      const qualified = qualificationByKey.get(identity)?.qualified ?? false;
      const action = ids.length === 0 ? "create" : ids.length === 1 ? "existing" : "ambiguous_snapshot";
      if (
        (action === "existing" && policyStore.matchedStoreId !== ids[0]) ||
        (action !== "existing" && policyStore.matchedStoreId !== null)
      ) {
        throw new Error("PreviewPlanner found inconsistent exact snapshot matching");
      }
      return {
        action,
        providerStoreKey: { ...providerStoreKey },
        matchedStoreId: policyStore.matchedStoreId,
        snapshotStoreIds: ids,
        qualified,
      };
    });
  const unmatchedStores: ProposedStoreActionV2[] = offers
    .filter((action) => action.action === "unresolved")
    .map((action) => ({
      action: "unmatched",
      providerStoreKey: null,
      matchedStoreId: null,
      promotionId: action.promotionId,
      unresolvedReason: action.unresolvedReason,
    }));
  const stores: ProposedStoreActionV2[] = [...resolvedStores, ...unmatchedStores];
  const couponCounts = offerKindCounts(offers, "coupon");
  const dealCounts = offerKindCounts(offers, "deal");
  const held = couponCounts.held + dealCounts.held;
  const unresolved = couponCounts.unresolved + dealCounts.unresolved;
  const existing = couponCounts.existing + dealCounts.existing;
  const proposedCreate = couponCounts.proposedCreate + dealCounts.proposedCreate;
  const normalized = couponCounts.normalized + dealCounts.normalized;
  if (existing + proposedCreate + held + unresolved !== normalized) {
    throw new Error("PreviewPlanner proposed offer actions do not reconcile");
  }

  return {
    stores,
    offers,
    counts: {
      stores: {
        discovered: resolvedStores.length,
        matchedExisting: resolvedStores.filter((entry) => entry.action === "existing").length,
        newCandidates: resolvedStores.filter((entry) => entry.action === "create").length,
        unmatchedAssociations: unmatchedStores.length,
        ambiguousSnapshot: resolvedStores.filter((entry) => entry.action === "ambiguous_snapshot").length,
        qualified: resolvedStores.filter((entry) => entry.qualified).length,
      },
      coupons: couponCounts,
      deals: dealCounts,
      offers: {
        normalized,
        selected: existing + proposedCreate,
        held,
        unresolved,
        existing,
        proposedCreate,
        duplicateRecordsRemoved: input.duplicateRecordsRemoved,
        quarantined: input.quarantinedRecords,
      },
    },
  };
}

function validateFetchInput(input: AffiliateSyncPreviewInputV2): void {
  if (input.fetchDiagnostics.promotions.stream !== "promotions" || input.fetchDiagnostics.campaigns.stream !== "campaigns") {
    throw new Error("PreviewPlanner fetch diagnostics use the wrong stream");
  }
  if (input.fetchDiagnostics.promotions.acceptedRecordCount !== input.acceptedPromotions.length) {
    throw new Error("PreviewPlanner Promotions count does not match fetch diagnostics");
  }
  if (input.fetchDiagnostics.campaigns.acceptedRecordCount !== input.acceptedCampaigns.length) {
    throw new Error("PreviewPlanner Campaigns count does not match fetch diagnostics");
  }
  for (const diagnostics of [input.fetchDiagnostics.promotions, input.fetchDiagnostics.campaigns]) {
    const counts = Object.values(diagnostics.quarantineReasonCounts);
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
      throw new Error("PreviewPlanner quarantine reason counts must be non-negative integers");
    }
    if (counts.reduce((total, count) => total + count, 0) !== diagnostics.quarantinedRecordCount) {
      throw new Error("PreviewPlanner quarantine reason counts do not reconcile");
    }
  }
  const promotionShapeCounts = input.fetchDiagnostics.promotions.promotionIdShapeCounts;
  if (!promotionShapeCounts) {
    throw new Error("PreviewPlanner requires PromotionIds shape diagnostics for Promotions");
  }
  if (input.fetchDiagnostics.campaigns.promotionIdShapeCounts !== undefined) {
    throw new Error("PreviewPlanner forbids PromotionIds shape diagnostics for Campaigns");
  }
  const shapeCounts = Object.values(promotionShapeCounts);
  if (shapeCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error("PreviewPlanner PromotionIds shape counts must be non-negative integers");
  }
  const structurallyValidPromotions = input.fetchDiagnostics.promotions.rawRecordCount -
    input.fetchDiagnostics.promotions.quarantineReasonCounts.malformed_record;
  if (shapeCounts.reduce((total, count) => total + count, 0) !== structurallyValidPromotions) {
    throw new Error("PreviewPlanner PromotionIds shape counts do not reconcile");
  }
  const carrierDiagnostics =
    input.fetchDiagnostics.promotions.promotionIdentifierCarrierDiagnostics;
  if (!carrierDiagnostics) {
    throw new Error(
      "PreviewPlanner requires identifier-carrier diagnostics for Promotions",
    );
  }
  if (
    input.fetchDiagnostics.campaigns
      .promotionIdentifierCarrierDiagnostics !== undefined
  ) {
    throw new Error(
      "PreviewPlanner forbids identifier-carrier diagnostics for Campaigns",
    );
  }
  for (const diagnostics of [
    carrierDiagnostics.promotionFileId,
    carrierDiagnostics.promotionIdSingular,
    carrierDiagnostics.id,
  ]) {
    const counts = [
      diagnostics.missing,
      diagnostics.null,
      diagnostics.validOpaqueScalar,
      diagnostics.invalidShape,
      diagnostics.distinctValidOpaqueValues,
    ];
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
      throw new Error(
        "PreviewPlanner identifier-carrier counts must be non-negative integers",
      );
    }
    if (
      diagnostics.missing + diagnostics.null +
        diagnostics.validOpaqueScalar + diagnostics.invalidShape !==
        structurallyValidPromotions
    ) {
      throw new Error(
        "PreviewPlanner identifier-carrier shape counts do not reconcile",
      );
    }
    if (
      diagnostics.distinctValidOpaqueValues >
        diagnostics.validOpaqueScalar
    ) {
      throw new Error(
        "PreviewPlanner identifier-carrier distinct counts exceed valid counts",
      );
    }
  }
  const uriCounts = Object.values(carrierDiagnostics.uri);
  if (uriCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error(
      "PreviewPlanner identifier-carrier counts must be non-negative integers",
    );
  }
  if (
    carrierDiagnostics.uri.missing + carrierDiagnostics.uri.null +
      carrierDiagnostics.uri.nonemptyString +
      carrierDiagnostics.uri.invalidShape !== structurallyValidPromotions
  ) {
    throw new Error(
      "PreviewPlanner identifier-carrier shape counts do not reconcile",
    );
  }
  if (
    carrierDiagnostics.uri.distinctNonemptyValues >
      carrierDiagnostics.uri.nonemptyString ||
    carrierDiagnostics.uri.promotionRetrievePathShape >
      carrierDiagnostics.uri.nonemptyString ||
    carrierDiagnostics.uri.distinctPromotionRetrieveTerminalSegments >
      carrierDiagnostics.uri.promotionRetrievePathShape
  ) {
    throw new Error(
      "PreviewPlanner identifier-carrier distinct counts exceed valid counts",
    );
  }
  const expectedQuarantined =
    input.fetchDiagnostics.promotions.quarantinedRecordCount +
    input.fetchDiagnostics.campaigns.quarantinedRecordCount;
  if (expectedQuarantined !== input.quarantinedRecords.length) {
    throw new Error("PreviewPlanner quarantine count does not match fetch diagnostics");
  }
}

/**
 * Pure A7 composition. The approved A6 API requires eligibility before caps:
 * dedupe -> resolve -> normalize -> match -> qualify offers -> policy -> qualify stores.
 */
export class PreviewPlanner {
  static plan(input: AffiliateSyncPreviewInputV2): AffiliateSyncPreviewV2 {
    validateFetchInput(input);
    const limit = detailLimit(input.diagnosticDetailLimit);
    const deduplicated = RawPromotionDeduplicator.deduplicate(input.acceptedPromotions, {
      diagnosticDetailLimit: limit,
    });
    const resolved = ImpactMerchantResolver.resolve(
      deduplicated.uniquePromotions,
      input.acceptedCampaigns,
      { diagnosticDetailLimit: limit },
    );
    const normalized = ImpactOfferNormalizer.normalize(
      deduplicated.uniquePromotions,
      resolved.promotionAssociations,
      input.acceptedCampaigns,
    );
    const matched = StoreOfferMatcher.match(normalized, input.existingCatalogSnapshot);
    const eligibility = OfferQualification.evaluate(matched, {
      evaluationTimestamp: input.evaluationTimestamp,
    });
    const policy = PublishingPolicy.apply(eligibility, input.publishingPolicyConfig);
    const qualification = StoreQualification.evaluate(policy, input.storeQualificationConfig);
    const parser = parserDiagnostics(input.quarantinedRecords);
    const deduplication = deduplicationDiagnostics(deduplicated);
    const distribution = advertiserDistribution(deduplicated.uniquePromotions, limit);
    const offers: MatchedOfferV2[] = [...matched.normalizedCoupons, ...matched.normalizedDeals];
    const associations: PreviewOfferAssociationV2[] = offers
      .map((offer) => ({
        promotionId: offer.promotionId,
        kind: offer.kind,
        association: offer.association,
        existingPromotionIdentity: offer.existingPromotionIdentity,
        existingOfferId: offer.existingOfferId,
      }))
      .sort((left, right) => compareOpaque(left.promotionId, right.promotionId));

    if (offers.length !== deduplicated.stats.uniquePromotions) {
      throw new Error("PreviewPlanner normalization count does not match deduplicated Promotions");
    }
    if (new Set(offers.map((offer) => offer.promotionId)).size !== offers.length) {
      throw new Error("PreviewPlanner normalization produced a duplicate PromotionId");
    }
    if (policy.diagnostics.selectedOffers + policy.diagnostics.heldOffers !== offers.length) {
      throw new Error("PreviewPlanner selected and held counts do not reconcile");
    }

    const integrity = identityIntegrity({
      associations,
      normalizedStoreKeys: normalized.normalizedStores.map((store) => store.providerStoreKey),
      policyStoreKeys: policy.stores.map((store) => store.providerStoreKey),
      qualificationStoreKeys: qualification.map((store) => store.providerStoreKey),
      resolverAssociations: resolved.promotionAssociations,
    });
    const actions = proposedActions({
      offers,
      normalizedStoreKeys: normalized.normalizedStores.map((store) => store.providerStoreKey),
      snapshot: input.existingCatalogSnapshot,
      policy,
      qualification,
      duplicateRecordsRemoved: deduplication.duplicateRecordsRemoved,
      quarantinedRecords: parser.quarantinedRecords,
    });
    const storesWithSelectedOffers = policy.stores.filter(
      (store) => store.selectedCoupons.length + store.selectedDeals.length > 0,
    ).length;
    const storeCoverage: StoreCoverageV2 = {
      campaignBackedStoresDiscovered: resolved.campaignIndexDiagnostics.indexedCampaigns,
      providerStoreKeysReferencedByPromotions: resolved.merchantIdentityDiagnostics.distinctResolvedProviderStoreKeys,
      storesWithResolvedOffers: normalized.normalizedStores.length,
      storesMatchedToExisting: actions.counts.stores.matchedExisting,
      newStoreCandidates: actions.counts.stores.newCandidates,
      storesWithSelectedOffers,
      qualifiedStores: qualification.filter((store) => store.qualified).length,
      unresolvedOffers: resolved.merchantIdentityDiagnostics.unmatchedTotal,
      ambiguousSnapshotKeys: matched.diagnostics.ambiguousSnapshotStoreKeys,
    };

    return {
      provider: "impact",
      evaluationTimestamp: input.evaluationTimestamp,
      rawFetchDiagnostics: rawFetchDiagnostics(input, parser, deduplication),
      parserDiagnostics: parser,
      deduplicationDiagnostics: deduplication,
      merchantIdentityDiagnostics: resolved.merchantIdentityDiagnostics,
      normalizationDiagnostics: normalized.diagnostics,
      storeMatchDiagnostics: matched.diagnostics,
      offerQualificationDiagnostics: eligibility.diagnostics,
      existingOfferIdentityDiagnostics: {
        normalizedOffers: offers.length,
        existingPromotionIdentities: matched.diagnostics.existingPromotionIdentities,
        newPromotionIdentities: matched.diagnostics.newPromotionIdentities,
      },
      topAdvertiserDistribution: distribution.entries,
      advertiserDistributionTotal: distribution.total,
      advertiserDistributionDetailsReturned: distribution.entries.length,
      advertiserDistributionDetailsTruncated: distribution.truncated,
      storeCoverage,
      identityIntegrityDiagnostics: integrity,
      normalizedStores: matched.normalizedStores,
      normalizedCoupons: matched.normalizedCoupons,
      normalizedDeals: matched.normalizedDeals,
      associations,
      publishingPolicy: policy,
      storeQualification: qualification,
      proposedActions: actions,
    };
  }
}
