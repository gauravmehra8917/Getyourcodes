import type {
  AffiliateSyncPreviewV2,
  ProposedOfferActionV2,
  ProposedStoreActionV2,
  ProviderStoreKey,
} from "./models.ts";
import {
  PERSISTENCE_CONTRACT_VERSION_V2,
  type CanonicalPersistencePlanMaterialV2,
  type KnownOfferKindV2,
  type KnownStoreSlugV2,
  type OfferCreateProjectionV2,
  type PersistenceOfferInstructionV2,
  type PersistencePlanBlockerV2,
  type PersistencePlanCountsV2,
  type PersistencePlanInputV2,
  type PersistencePlanPreconditionV2,
  type PersistencePlanV2,
  type PersistencePreconditionCodeV2,
  type PersistenceStoreInstructionV2,
  type StoreCreateProjectionV2,
} from "./persistence-models.ts";

type PreviewOfferV2 =
  | AffiliateSyncPreviewV2["normalizedCoupons"][number]
  | AffiliateSyncPreviewV2["normalizedDeals"][number];

const PRECONDITION_ORDER: readonly PersistencePreconditionCodeV2[] = [
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
];

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function copyKey(key: ProviderStoreKey): ProviderStoreKey {
  return { provider: key.provider, namespace: key.namespace, id: key.id };
}

function validKey(value: ProviderStoreKey | null): value is ProviderStoreKey {
  return value !== null && value.provider === "impact" &&
    value.namespace === "campaign" && typeof value.id === "string" &&
    value.id.length > 0;
}

function keyText(key: ProviderStoreKey): string {
  return JSON.stringify([key.provider, key.namespace, key.id]);
}

function sameKey(left: ProviderStoreKey, right: ProviderStoreKey): boolean {
  return keyText(left) === keyText(right);
}

function nonempty(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function slugCandidate(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "item";
}

function explicitTimestamp(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateOnly(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

/** Calendar dates are always derived from the represented instant in UTC. */
function utcDate(value: string | null): { valid: boolean; value: string | null } {
  if (value === null) return { valid: true, value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return validDateOnly(value)
      ? { valid: true, value }
      : { valid: false, value: null };
  }
  if (!explicitTimestamp(value)) return { valid: false, value: null };
  return {
    valid: true,
    value: new Date(Date.parse(value)).toISOString().slice(0, 10),
  };
}

function storeProjection(
  store: AffiliateSyncPreviewV2["normalizedStores"][number] | undefined,
  evaluationTimestamp: string,
): StoreCreateProjectionV2 | null {
  if (!store || !validKey(store.providerStoreKey)) return null;
  const name = nonempty(store.name);
  if (!name) return null;
  return {
    name,
    slugCandidate: slugCandidate(name),
    description: null,
    affiliateUrl: nonempty(store.trackingUrl),
    destinationUrl: nonempty(store.destinationUrl),
    country: null,
    shippingRegions: [],
    logoSourceUrl: null,
    metadata: {
      advertiserId: nonempty(store.advertiserId),
      campaignId: store.providerStoreKey.id,
    },
    importOrigin: "provider",
    lifecycleManaged: true,
    lifecycleHidden: false,
    lastQualificationResult: "qualified",
    lastQualifiedAt: evaluationTimestamp,
  };
}

function offerProjection(
  offer: PreviewOfferV2 | undefined,
  parent: ProviderStoreKey,
): OfferCreateProjectionV2 | null {
  if (!offer || !validKey(parent)) return null;
  const title = nonempty(offer.title);
  const start = utcDate(offer.startDate);
  const end = utcDate(offer.endDate);
  if (!title || !start.valid || !end.valid) return null;
  if (offer.kind === "coupon" && !nonempty(offer.code)) return null;
  return {
    title,
    description: nonempty(offer.description),
    couponCode: offer.kind === "coupon" ? nonempty(offer.code) : null,
    couponType: offer.kind === "coupon" ? "code" : "deal",
    affiliateUrl: nonempty(offer.trackingUrl),
    landingPageUrl: null,
    startDate: start.value,
    expiryDate: end.value,
    status: "active",
    terms: offer.kind === "coupon" ? nonempty(offer.terms) : null,
    discountType: offer.kind === "coupon" && offer.discountType !== "unknown"
      ? offer.discountType
      : null,
    discountValue: offer.kind === "coupon" &&
        (offer.discountValue === null || Number.isFinite(offer.discountValue))
      ? offer.discountValue
      : null,
    metadata: {
      advertiserId: nonempty(offer.advertiserId),
      campaignId: nonempty(offer.campaignId),
      programId: nonempty(offer.programId),
      resolvedCampaignId: parent.id,
    },
  };
}

function blocker(
  reason: PersistencePlanBlockerV2["reason"],
  entity: PersistencePlanBlockerV2["entity"],
  input: {
    providerStoreKey?: ProviderStoreKey | null;
    promotionId?: string | null;
    internalIds?: readonly string[];
  } = {},
): PersistencePlanBlockerV2 {
  return {
    reason,
    entity,
    providerStoreKey: input.providerStoreKey && validKey(input.providerStoreKey)
      ? copyKey(input.providerStoreKey)
      : null,
    promotionId: nonempty(input.promotionId ?? null),
    internalIds: [...(input.internalIds ?? [])].filter((id) => !!nonempty(id)).sort(compareCodeUnit),
  };
}

function compareBlockers(
  left: PersistencePlanBlockerV2,
  right: PersistencePlanBlockerV2,
): number {
  return compareCodeUnit(left.reason, right.reason) ||
    compareCodeUnit(left.entity, right.entity) ||
    compareCodeUnit(
      left.providerStoreKey ? keyText(left.providerStoreKey) : "",
      right.providerStoreKey ? keyText(right.providerStoreKey) : "",
    ) ||
    compareCodeUnit(left.promotionId ?? "", right.promotionId ?? "") ||
    compareCodeUnit(JSON.stringify(left.internalIds), JSON.stringify(right.internalIds));
}

function orderedBlockers(
  values: readonly PersistencePlanBlockerV2[],
): PersistencePlanBlockerV2[] {
  const unique = new Map<string, PersistencePlanBlockerV2>();
  for (const value of values) {
    const ordered = { ...value, internalIds: [...value.internalIds].sort(compareCodeUnit) };
    unique.set(JSON.stringify(ordered), ordered);
  }
  return [...unique.values()].sort(compareBlockers);
}

function compareStoreInstructions(
  left: PersistenceStoreInstructionV2,
  right: PersistenceStoreInstructionV2,
): number {
  const leftKey = left.providerStoreKey ? keyText(left.providerStoreKey) : "~";
  const rightKey = right.providerStoreKey ? keyText(right.providerStoreKey) : "~";
  return compareCodeUnit(leftKey, rightKey) ||
    compareCodeUnit(
      left.action === "noop_unmatched" ? left.promotionId : "",
      right.action === "noop_unmatched" ? right.promotionId : "",
    ) || compareCodeUnit(left.action, right.action);
}

function compareOfferInstructions(
  left: PersistenceOfferInstructionV2,
  right: PersistenceOfferInstructionV2,
): number {
  return compareCodeUnit(left.promotionId, right.promotionId) ||
    compareCodeUnit(left.kind, right.kind) || compareCodeUnit(left.action, right.action);
}

function counts(
  stores: readonly PersistenceStoreInstructionV2[],
  offers: readonly PersistenceOfferInstructionV2[],
): PersistencePlanCountsV2 {
  const storeCounts = {
    create: stores.filter((entry) => entry.action === "create").length,
    noopExisting: stores.filter((entry) => entry.action === "noop_existing").length,
    blockedAmbiguous: stores.filter((entry) => entry.action === "blocked_ambiguous").length,
    noopUnmatched: stores.filter((entry) => entry.action === "noop_unmatched").length,
  };
  const offerCounts = {
    create: offers.filter((entry) => entry.action === "create").length,
    noopExisting: offers.filter((entry) => entry.action === "noop_existing").length,
    noopHeld: offers.filter((entry) => entry.action === "noop_held").length,
    noopUnresolved: offers.filter((entry) => entry.action === "noop_unresolved").length,
  };
  return {
    stores: storeCounts,
    offers: offerCounts,
    writableStores: storeCounts.create,
    writableOffers: offerCounts.create,
    writableEntities: storeCounts.create + offerCounts.create,
  };
}

function countMismatch(
  preview: AffiliateSyncPreviewV2,
  planCounts: PersistencePlanCountsV2,
): boolean {
  const expectedStores = preview.proposedActions.counts.stores;
  const expectedOffers = preview.proposedActions.counts.offers;
  return planCounts.stores.create !== expectedStores.newCandidates ||
    planCounts.stores.noopExisting !== expectedStores.matchedExisting ||
    planCounts.stores.blockedAmbiguous !== expectedStores.ambiguousSnapshot ||
    planCounts.stores.noopUnmatched !== expectedStores.unmatchedAssociations ||
    planCounts.offers.create !== expectedOffers.proposedCreate ||
    planCounts.offers.noopExisting !== expectedOffers.existing ||
    planCounts.offers.noopHeld !== expectedOffers.held ||
    planCounts.offers.noopUnresolved !== expectedOffers.unresolved;
}

function safeStoreSignature(
  store: AffiliateSyncPreviewV2["normalizedStores"][number],
): string {
  return JSON.stringify([
    store.providerStoreKey.id,
    store.name,
    store.advertiserId,
    store.destinationUrl,
    store.trackingUrl,
  ]);
}

function safeOfferSignature(offer: PreviewOfferV2): string {
  return JSON.stringify([
    offer.promotionId,
    offer.kind,
    offer.title,
    offer.description,
    offer.trackingUrl,
    offer.startDate,
    offer.endDate,
    offer.kind === "coupon" ? offer.code : null,
  ]);
}

function normalizedStores(
  preview: AffiliateSyncPreviewV2,
  add: (value: PersistencePlanBlockerV2) => void,
  facts: Record<PersistencePreconditionCodeV2, boolean>,
): Map<string, AffiliateSyncPreviewV2["normalizedStores"][number]> {
  const grouped = new Map<string, AffiliateSyncPreviewV2["normalizedStores"]>();
  for (const store of preview.normalizedStores) {
    if (!validKey(store.providerStoreKey)) {
      facts.store_projections_valid = false;
      add(blocker("invalid_store_projection", "store"));
      continue;
    }
    const identity = keyText(store.providerStoreKey);
    const entries = grouped.get(identity);
    if (entries) entries.push(store);
    else grouped.set(identity, [store]);
  }
  const result = new Map<string, AffiliateSyncPreviewV2["normalizedStores"][number]>();
  for (const [identity, entries] of grouped) {
    const ordered = [...entries].sort((left, right) =>
      compareCodeUnit(safeStoreSignature(left), safeStoreSignature(right)));
    if (ordered.length > 1) {
      facts.store_identities_unique = false;
      add(blocker("duplicate_store_identity", "store", {
        providerStoreKey: ordered[0]!.providerStoreKey,
      }));
    }
    result.set(identity, ordered[0]!);
  }
  return result;
}

function normalizedOffers(
  preview: AffiliateSyncPreviewV2,
  add: (value: PersistencePlanBlockerV2) => void,
  facts: Record<PersistencePreconditionCodeV2, boolean>,
): Map<string, PreviewOfferV2[]> {
  const grouped = new Map<string, PreviewOfferV2[]>();
  for (const offer of [...preview.normalizedCoupons, ...preview.normalizedDeals]) {
    const id = nonempty(offer.promotionId);
    if (!id) {
      facts.offer_projections_valid = false;
      add(blocker("invalid_offer_projection", "offer"));
      continue;
    }
    const entries = grouped.get(id);
    if (entries) entries.push(offer);
    else grouped.set(id, [offer]);
  }
  for (const [promotionId, entries] of grouped) {
    entries.sort((left, right) =>
      compareCodeUnit(safeOfferSignature(left), safeOfferSignature(right)));
    if (entries.length > 1) {
      facts.promotion_identities_unique = false;
      add(blocker("duplicate_offer_identity", "offer", { promotionId }));
      if (new Set(entries.map((entry) => entry.kind)).size > 1) {
        facts.offer_kinds_consistent = false;
        add(blocker("offer_kind_conflict", "offer", { promotionId }));
      }
    }
  }
  return grouped;
}

function validKnownSlugs(
  values: readonly KnownStoreSlugV2[],
  add: (value: PersistencePlanBlockerV2) => void,
  facts: Record<PersistencePreconditionCodeV2, boolean>,
): KnownStoreSlugV2[] {
  const result: KnownStoreSlugV2[] = [];
  for (const value of values) {
    const storeId = nonempty(value.storeId);
    const slug = nonempty(value.slug);
    if (!storeId || !slug || (value.providerStoreKey !== null && !validKey(value.providerStoreKey))) {
      facts.context_is_consistent = false;
      add(blocker("invalid_context", "plan"));
      continue;
    }
    result.push({
      storeId,
      slug,
      providerStoreKey: value.providerStoreKey ? copyKey(value.providerStoreKey) : null,
    });
  }
  return result.sort((left, right) =>
    compareCodeUnit(left.slug, right.slug) || compareCodeUnit(left.storeId, right.storeId));
}

function validKnownKinds(
  values: readonly KnownOfferKindV2[],
  add: (value: PersistencePlanBlockerV2) => void,
  facts: Record<PersistencePreconditionCodeV2, boolean>,
): KnownOfferKindV2[] {
  const result: KnownOfferKindV2[] = [];
  for (const value of values) {
    const offerId = nonempty(value.offerId);
    const promotionId = nonempty(value.promotionId);
    if (!offerId || !promotionId || (value.kind !== "coupon" && value.kind !== "deal")) {
      facts.context_is_consistent = false;
      add(blocker("invalid_context", "plan"));
      continue;
    }
    result.push({ offerId, promotionId, kind: value.kind });
  }
  return result.sort((left, right) =>
    compareCodeUnit(left.promotionId, right.promotionId) ||
    compareCodeUnit(left.offerId, right.offerId) || compareCodeUnit(left.kind, right.kind));
}

function storeActionOrder(action: ProposedStoreActionV2): string {
  if (action.action === "unmatched") return `~${action.promotionId}`;
  return `${keyText(action.providerStoreKey)}:${action.action}`;
}

function offerActionOrder(action: ProposedOfferActionV2): string {
  return `${action.promotionId}:${action.kind}:${action.action}`;
}

function canonicalMaterial(
  input: Omit<CanonicalPersistencePlanMaterialV2, "persistenceContractVersion">,
): CanonicalPersistencePlanMaterialV2 {
  return {
    persistenceContractVersion: PERSISTENCE_CONTRACT_VERSION_V2,
    provider: input.provider,
    integrationId: input.integrationId,
    evaluationTimestamp: input.evaluationTimestamp,
    status: input.status,
    blockers: input.blockers,
    preconditions: input.preconditions,
    storeInstructions: input.storeInstructions,
    offerInstructions: input.offerInstructions,
    counts: input.counts,
  };
}

function finalize(
  input: Omit<CanonicalPersistencePlanMaterialV2, "persistenceContractVersion">,
): PersistencePlanV2 {
  const material = canonicalMaterial(input);
  const plan: PersistencePlanV2 = {
    ...material,
    canonicalPlanMaterial: material,
    canonicalPlanMaterialString: JSON.stringify(material),
  };
  validatePersistencePlanV2(plan);
  return plan;
}

function emptyFacts(): Record<PersistencePreconditionCodeV2, boolean> {
  return Object.fromEntries(PRECONDITION_ORDER.map((code) => [code, true])) as
    Record<PersistencePreconditionCodeV2, boolean>;
}

function preconditions(
  facts: Record<PersistencePreconditionCodeV2, boolean>,
): PersistencePlanPreconditionV2[] {
  return PRECONDITION_ORDER.map((code) => ({ code, satisfied: facts[code] }));
}

function unsupportedPlan(input: PersistencePlanInputV2): PersistencePlanV2 {
  const facts = emptyFacts();
  facts.provider_is_impact = false;
  const blockers = [blocker("unsupported_provider", "plan")];
  const planCounts = counts([], []);
  return finalize({
    provider: input.context.provider,
    integrationId: input.context.integrationId,
    evaluationTimestamp: input.context.evaluationTimestamp,
    status: "blocked",
    blockers,
    preconditions: preconditions(facts),
    storeInstructions: [],
    offerInstructions: [],
    counts: planCounts,
  });
}

/** Converts settled preview intent into stable create/no-op instructions only. */
export class PersistencePlannerV2 {
  static plan(input: PersistencePlanInputV2): PersistencePlanV2 {
    if (input.context.provider !== "impact") return unsupportedPlan(input);

    const facts = emptyFacts();
    const pendingBlockers: PersistencePlanBlockerV2[] = [];
    const add = (value: PersistencePlanBlockerV2) => pendingBlockers.push(value);
    const preview = input.preview;
    const integrationId = nonempty(input.context.integrationId) ?? "";
    const evaluationTimestamp = input.context.evaluationTimestamp;

    if (
      !integrationId || preview.provider !== "impact" ||
      evaluationTimestamp !== preview.evaluationTimestamp ||
      !explicitTimestamp(evaluationTimestamp)
    ) {
      facts.context_is_consistent = false;
      add(blocker("invalid_context", "plan"));
    }

    const promotionsFetch = preview.rawFetchDiagnostics.promotions;
    const campaignsFetch = preview.rawFetchDiagnostics.campaigns;
    if (promotionsFetch.stopReason !== "completed" || campaignsFetch.stopReason !== "completed") {
      facts.provider_fetches_completed = false;
      add(blocker("preview_not_complete", "plan"));
    }
    if (promotionsFetch.parseFailureReason !== null || campaignsFetch.parseFailureReason !== null) {
      facts.provider_parse_succeeded = false;
      add(blocker("preview_not_complete", "plan"));
    }
    if (preview.identityIntegrityDiagnostics.identityCollapseDetected) {
      facts.identity_not_collapsed = false;
      add(blocker("identity_collapse_detected", "plan"));
    }

    const storeByKey = normalizedStores(preview, add, facts);
    const offersById = normalizedOffers(preview, add, facts);
    const knownSlugs = validKnownSlugs(input.context.knownStoreSlugs, add, facts);
    const knownKinds = validKnownKinds(input.context.knownOfferKinds, add, facts);

    const storeInstructions: PersistenceStoreInstructionV2[] = [];
    const seenStoreKeys = new Set<string>();
    const seenUnmatchedPromotions = new Set<string>();
    for (const action of [...preview.proposedActions.stores].sort((left, right) =>
      compareCodeUnit(storeActionOrder(left), storeActionOrder(right)))) {
      if (action.action === "unmatched") {
        if (seenUnmatchedPromotions.has(action.promotionId)) {
          facts.promotion_identities_unique = false;
          add(blocker("duplicate_offer_identity", "offer", { promotionId: action.promotionId }));
          continue;
        }
        seenUnmatchedPromotions.add(action.promotionId);
        storeInstructions.push({
          action: "noop_unmatched",
          providerStoreKey: null,
          provider: "impact",
          providerEntityId: null,
          promotionId: action.promotionId,
          unresolvedReason: action.unresolvedReason,
          qualified: false,
          projection: null,
        });
        continue;
      }

      if (!validKey(action.providerStoreKey)) {
        facts.store_projections_valid = false;
        add(blocker("invalid_store_projection", "store"));
        continue;
      }
      const identity = keyText(action.providerStoreKey);
      if (seenStoreKeys.has(identity)) {
        facts.store_identities_unique = false;
        add(blocker("duplicate_store_identity", "store", {
          providerStoreKey: action.providerStoreKey,
        }));
        continue;
      }
      seenStoreKeys.add(identity);
      const normalized = storeByKey.get(identity);
      if (!normalized) {
        facts.store_projections_valid = false;
        add(blocker("invalid_store_projection", "store", {
          providerStoreKey: action.providerStoreKey,
        }));
      }

      if (action.action === "create") {
        if (action.matchedStoreId !== null || action.snapshotStoreIds.length !== 0) {
          facts.existing_store_ids_consistent = false;
          add(blocker("inconsistent_existing_store", "store", {
            providerStoreKey: action.providerStoreKey,
            internalIds: action.snapshotStoreIds,
          }));
        }
        if (!action.qualified) {
          facts.writable_parents_qualified = false;
          add(blocker("unqualified_parent_store", "store", {
            providerStoreKey: action.providerStoreKey,
          }));
        }
        const projection = storeProjection(normalized, evaluationTimestamp);
        if (!projection) {
          facts.store_projections_valid = false;
          add(blocker("invalid_store_projection", "store", {
            providerStoreKey: action.providerStoreKey,
          }));
        }
        storeInstructions.push({
          action: "create",
          providerStoreKey: copyKey(action.providerStoreKey),
          provider: "impact",
          providerEntityId: action.providerStoreKey.id,
          qualified: action.qualified,
          expectedExistingStoreId: null,
          projection,
        });
      } else if (action.action === "existing") {
        const ids = [...action.snapshotStoreIds].sort(compareCodeUnit);
        const existingId = nonempty(action.matchedStoreId);
        if (!existingId || ids.length !== 1 || ids[0] !== existingId) {
          facts.existing_store_ids_consistent = false;
          add(blocker("inconsistent_existing_store", "store", {
            providerStoreKey: action.providerStoreKey,
            internalIds: ids,
          }));
        }
        storeInstructions.push({
          action: "noop_existing",
          providerStoreKey: copyKey(action.providerStoreKey),
          provider: "impact",
          providerEntityId: action.providerStoreKey.id,
          qualified: action.qualified,
          expectedExistingStoreId: existingId,
          projection: null,
        });
      } else {
        const ids = [...action.snapshotStoreIds].sort(compareCodeUnit);
        facts.writable_parents_unambiguous = false;
        add(blocker("ambiguous_store_snapshot", "store", {
          providerStoreKey: action.providerStoreKey,
          internalIds: ids,
        }));
        if (action.matchedStoreId !== null || ids.length < 2) {
          facts.existing_store_ids_consistent = false;
          add(blocker("inconsistent_existing_store", "store", {
            providerStoreKey: action.providerStoreKey,
            internalIds: ids,
          }));
        }
        storeInstructions.push({
          action: "blocked_ambiguous",
          providerStoreKey: copyKey(action.providerStoreKey),
          provider: "impact",
          providerEntityId: action.providerStoreKey.id,
          qualified: action.qualified,
          expectedExistingStoreIds: ids,
          projection: null,
        });
      }
    }
    storeInstructions.sort(compareStoreInstructions);

    const resolvedStoreInstructions = new Map<string, PersistenceStoreInstructionV2>();
    for (const instruction of storeInstructions) {
      if (instruction.providerStoreKey) {
        resolvedStoreInstructions.set(keyText(instruction.providerStoreKey), instruction);
      }
    }

    const createBySlug = new Map<string, PersistenceStoreInstructionV2[]>();
    for (const instruction of storeInstructions) {
      if (instruction.action !== "create" || !instruction.projection) continue;
      const entries = createBySlug.get(instruction.projection.slugCandidate);
      if (entries) entries.push(instruction);
      else createBySlug.set(instruction.projection.slugCandidate, [instruction]);
    }
    for (const entries of createBySlug.values()) {
      if (entries.length > 1) {
        facts.slug_candidates_available = false;
        for (const instruction of entries) {
          add(blocker("store_slug_collision", "store", {
            providerStoreKey: instruction.providerStoreKey,
          }));
        }
      }
    }
    for (const instruction of storeInstructions) {
      if (instruction.action !== "create" || !instruction.projection) continue;
      for (const known of knownSlugs.filter((entry) =>
        entry.slug === instruction.projection!.slugCandidate)) {
        facts.slug_candidates_available = false;
        if (known.providerStoreKey && sameKey(known.providerStoreKey, instruction.providerStoreKey)) {
          facts.existing_store_ids_consistent = false;
          add(blocker("inconsistent_existing_store", "store", {
            providerStoreKey: instruction.providerStoreKey,
            internalIds: [known.storeId],
          }));
        } else {
          add(blocker("store_slug_collision", "store", {
            providerStoreKey: instruction.providerStoreKey,
            internalIds: [known.storeId],
          }));
        }
      }
    }

    const selectedIds = new Set<string>();
    for (const offer of [
      ...preview.publishingPolicy.selectedCoupons,
      ...preview.publishingPolicy.selectedDeals,
    ]) {
      if (selectedIds.has(offer.promotionId)) {
        facts.promotion_identities_unique = false;
        add(blocker("duplicate_offer_identity", "offer", { promotionId: offer.promotionId }));
      }
      selectedIds.add(offer.promotionId);
    }

    const knownKindsByPromotion = new Map<string, KnownOfferKindV2[]>();
    for (const known of knownKinds) {
      const entries = knownKindsByPromotion.get(known.promotionId);
      if (entries) entries.push(known);
      else knownKindsByPromotion.set(known.promotionId, [known]);
    }

    const offerInstructions: PersistenceOfferInstructionV2[] = [];
    const seenPromotionIds = new Set<string>();
    for (const action of [...preview.proposedActions.offers].sort((left, right) =>
      compareCodeUnit(offerActionOrder(left), offerActionOrder(right)))) {
      const promotionId = nonempty(action.promotionId);
      if (!promotionId) {
        facts.offer_projections_valid = false;
        add(blocker("invalid_offer_projection", "offer"));
        continue;
      }
      if (seenPromotionIds.has(promotionId)) {
        facts.promotion_identities_unique = false;
        add(blocker("duplicate_offer_identity", "offer", { promotionId }));
        continue;
      }
      seenPromotionIds.add(promotionId);

      const candidates = offersById.get(promotionId) ?? [];
      const sameKind = candidates.filter((entry) => entry.kind === action.kind);
      const normalized = sameKind[0];
      if (sameKind.length !== 1 || candidates.length !== 1) {
        facts.offer_projections_valid = false;
        add(blocker("invalid_offer_projection", "offer", { promotionId }));
      }

      const existingId = nonempty(action.existingOfferId);
      const knownForIdentity = knownKindsByPromotion.get(promotionId) ?? [];
      if (action.existingPromotionIdentity === "existing") {
        const matchingKnown = existingId
          ? knownForIdentity.filter((entry) => entry.offerId === existingId)
          : [];
        if (!existingId || matchingKnown.length !== 1 || knownForIdentity.length !== 1) {
          facts.existing_offer_ids_consistent = false;
          add(blocker("inconsistent_existing_offer", "offer", {
            promotionId,
            internalIds: knownForIdentity.map((entry) => entry.offerId),
          }));
        }
        if (matchingKnown[0] && matchingKnown[0].kind !== action.kind) {
          facts.offer_kinds_consistent = false;
          add(blocker("offer_kind_conflict", "offer", {
            promotionId,
            internalIds: [matchingKnown[0].offerId],
          }));
        }
      } else if (existingId || knownForIdentity.length > 0) {
        facts.existing_offer_ids_consistent = false;
        add(blocker("inconsistent_existing_offer", "offer", {
          promotionId,
          internalIds: knownForIdentity.map((entry) => entry.offerId),
        }));
      }

      const base = {
        promotionId,
        provider: "impact" as const,
        providerEntityId: promotionId,
        kind: action.kind,
        existingOfferId: existingId,
      };

      if (action.action === "unresolved") {
        if (selectedIds.has(promotionId) || normalized?.association.matchMethod !== "unmatched") {
          facts.nonwritable_actions_preserved = false;
          add(blocker("invalid_preview_action", "offer", { promotionId }));
        }
        offerInstructions.push({
          ...base,
          action: "noop_unresolved",
          parentProviderStoreKey: null,
          expectedParentStoreId: null,
          selected: false,
          holdReason: "unresolved_store",
          unresolvedReason: action.unresolvedReason,
          projection: null,
        });
        continue;
      }

      const parent = action.providerStoreKey;
      const parentInstruction = validKey(parent)
        ? resolvedStoreInstructions.get(keyText(parent))
        : undefined;
      if (!validKey(parent) || !parentInstruction) {
        facts.writable_offers_resolved = false;
        add(blocker("missing_parent_store", "offer", {
          providerStoreKey: validKey(parent) ? parent : null,
          promotionId,
        }));
      } else {
        if (parentInstruction.action === "blocked_ambiguous") {
          facts.writable_parents_unambiguous = false;
          add(blocker("ambiguous_store_snapshot", "offer", {
            providerStoreKey: parent,
            promotionId,
            internalIds: parentInstruction.expectedExistingStoreIds,
          }));
        }
        if (!parentInstruction.qualified && (action.action === "create" || action.action === "existing")) {
          facts.writable_parents_qualified = false;
          add(blocker("unqualified_parent_store", "offer", {
            providerStoreKey: parent,
            promotionId,
          }));
        }
        const parentExpectedId = parentInstruction.action === "noop_existing"
          ? parentInstruction.expectedExistingStoreId
          : null;
        if (action.matchedStoreId !== parentExpectedId) {
          facts.existing_store_ids_consistent = false;
          add(blocker("inconsistent_existing_store", "offer", {
            providerStoreKey: parent,
            promotionId,
            internalIds: [action.matchedStoreId ?? "", parentExpectedId ?? ""],
          }));
        }
        if (
          normalized &&
          (normalized.association.matchMethod === "unmatched" ||
            !sameKey(normalized.association.providerStoreKey, parent))
        ) {
          facts.writable_offers_resolved = false;
          add(blocker("missing_parent_store", "offer", {
            providerStoreKey: parent,
            promotionId,
          }));
        }
      }

      const expectedParentStoreId = parentInstruction?.action === "noop_existing"
        ? parentInstruction.expectedExistingStoreId
        : null;
      if (action.action === "create") {
        if (!selectedIds.has(promotionId) || action.existingPromotionIdentity !== "new" || existingId) {
          facts.nonwritable_actions_preserved = false;
          add(blocker("invalid_preview_action", "offer", { promotionId }));
        }
        const projection = validKey(parent) ? offerProjection(normalized, parent) : null;
        if (!projection) {
          facts.offer_projections_valid = false;
          add(blocker("invalid_offer_projection", "offer", {
            providerStoreKey: validKey(parent) ? parent : null,
            promotionId,
          }));
        }
        offerInstructions.push({
          ...base,
          action: "create",
          parentProviderStoreKey: copyKey(parent),
          expectedParentStoreId,
          selected: true,
          projection,
        });
      } else if (action.action === "existing") {
        if (!selectedIds.has(promotionId) || action.existingPromotionIdentity !== "existing") {
          facts.nonwritable_actions_preserved = false;
          add(blocker("invalid_preview_action", "offer", { promotionId }));
        }
        offerInstructions.push({
          ...base,
          action: "noop_existing",
          parentProviderStoreKey: copyKey(parent),
          expectedParentStoreId,
          selected: true,
          projection: null,
        });
      } else {
        if (selectedIds.has(promotionId)) {
          facts.nonwritable_actions_preserved = false;
          add(blocker("invalid_preview_action", "offer", { promotionId }));
        }
        offerInstructions.push({
          ...base,
          action: "noop_held",
          parentProviderStoreKey: copyKey(parent),
          expectedParentStoreId,
          selected: false,
          holdReason: action.holdReason,
          projection: null,
        });
      }
    }
    offerInstructions.sort(compareOfferInstructions);

    if (
      preview.deduplicationDiagnostics.uniquePromotions !== offersById.size ||
      seenPromotionIds.size !== offersById.size
    ) {
      facts.promotion_identities_unique = false;
      add(blocker("instruction_count_mismatch", "plan"));
    }

    const planCounts = counts(storeInstructions, offerInstructions);
    if (countMismatch(preview, planCounts)) {
      facts.instruction_counts_reconcile = false;
      add(blocker("instruction_count_mismatch", "plan"));
    }

    const finalBlockers = orderedBlockers(pendingBlockers);
    const status = finalBlockers.length === 0 ? "ready" : "blocked";
    return finalize({
      provider: "impact",
      integrationId,
      evaluationTimestamp,
      status,
      blockers: finalBlockers,
      preconditions: preconditions(facts),
      storeInstructions,
      offerInstructions,
      counts: planCounts,
    });
  }
}

function assertCondition(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Guards planner output; malformed input is blocked before this boundary. */
export function validatePersistencePlanV2(plan: PersistencePlanV2): void {
  const allCounts = [
    ...Object.values(plan.counts.stores),
    ...Object.values(plan.counts.offers),
    plan.counts.writableStores,
    plan.counts.writableOffers,
    plan.counts.writableEntities,
  ];
  assertCondition(
    allCounts.every((value) => Number.isInteger(value) && value >= 0),
    "persistence_plan_invalid_counts",
  );

  const expectedCounts = counts(plan.storeInstructions, plan.offerInstructions);
  assertCondition(sameJson(plan.counts, expectedCounts), "persistence_plan_count_mismatch");
  assertCondition(
    plan.status === "ready" ? plan.blockers.length === 0 : plan.blockers.length > 0,
    "persistence_plan_status_mismatch",
  );
  assertCondition(
    plan.status !== "ready" || plan.preconditions.every((entry) => entry.satisfied),
    "persistence_plan_ready_precondition",
  );
  assertCondition(
    sameJson(plan.storeInstructions, [...plan.storeInstructions].sort(compareStoreInstructions)),
    "persistence_plan_store_order",
  );
  assertCondition(
    sameJson(plan.offerInstructions, [...plan.offerInstructions].sort(compareOfferInstructions)),
    "persistence_plan_offer_order",
  );
  assertCondition(
    sameJson(plan.blockers, orderedBlockers(plan.blockers)),
    "persistence_plan_blocker_order",
  );
  assertCondition(
    sameJson(plan.preconditions.map((entry) => entry.code), PRECONDITION_ORDER),
    "persistence_plan_precondition_order",
  );

  const writableStoreIds = new Set<string>();
  for (const instruction of plan.storeInstructions) {
    if (instruction.action !== "create") continue;
    assertCondition(validKey(instruction.providerStoreKey), "persistence_plan_store_identity");
    assertCondition(
      instruction.provider === "impact" &&
        instruction.providerEntityId === instruction.providerStoreKey.id,
      "persistence_plan_store_provider_identity",
    );
    const identity = keyText(instruction.providerStoreKey);
    assertCondition(!writableStoreIds.has(identity), "persistence_plan_duplicate_store");
    writableStoreIds.add(identity);
  }

  const resolvedParents = new Map<string, PersistenceStoreInstructionV2>();
  for (const instruction of plan.storeInstructions) {
    if (!instruction.providerStoreKey) continue;
    const identity = keyText(instruction.providerStoreKey);
    assertCondition(!resolvedParents.has(identity), "persistence_plan_duplicate_parent");
    resolvedParents.set(identity, instruction);
  }

  const writableOfferIds = new Set<string>();
  for (const instruction of plan.offerInstructions) {
    if (instruction.action !== "create") continue;
    assertCondition(
      instruction.provider === "impact" && instruction.providerEntityId === instruction.promotionId,
      "persistence_plan_offer_provider_identity",
    );
    assertCondition(!writableOfferIds.has(instruction.promotionId), "persistence_plan_duplicate_offer");
    writableOfferIds.add(instruction.promotionId);
    const parent = resolvedParents.get(keyText(instruction.parentProviderStoreKey));
    if (plan.status === "ready") {
      assertCondition(!!parent, "persistence_plan_missing_parent");
      assertCondition(parent.action !== "blocked_ambiguous", "persistence_plan_ambiguous_parent");
      assertCondition(parent.qualified, "persistence_plan_unqualified_parent");
    }
  }

  const nonwritableOfferCount = plan.offerInstructions.filter((entry) =>
    entry.action !== "create").length;
  assertCondition(
    nonwritableOfferCount === plan.counts.offers.noopExisting +
      plan.counts.offers.noopHeld + plan.counts.offers.noopUnresolved,
    "persistence_plan_nonwritable_count",
  );

  const material = canonicalMaterial({
    provider: plan.provider,
    integrationId: plan.integrationId,
    evaluationTimestamp: plan.evaluationTimestamp,
    status: plan.status,
    blockers: plan.blockers,
    preconditions: plan.preconditions,
    storeInstructions: plan.storeInstructions,
    offerInstructions: plan.offerInstructions,
    counts: plan.counts,
  });
  assertCondition(
    sameJson(plan.canonicalPlanMaterial, material),
    "persistence_plan_material_mismatch",
  );
  assertCondition(
    plan.canonicalPlanMaterialString === JSON.stringify(material),
    "persistence_plan_material_string_mismatch",
  );
  const identityFact = plan.preconditions.find((entry) =>
    entry.code === "identity_not_collapsed");
  assertCondition(
    plan.status !== "ready" || identityFact?.satisfied === true,
    "persistence_plan_identity_collapse",
  );
}
