import {
  type AffiliateSyncPreviewInputV2,
  type AffiliateSyncPreviewV2,
  hasImpactPromotionRedemptionCodeV2,
  type PersistencePlanV2,
  type ProviderStoreKey,
  type RawImpactPromotionV2,
  validatePersistencePlanV2,
} from "../_shared/affiliate-sync-v2/index.ts";
import {
  persistenceRpcArgs,
  type PreparedPersistenceExecutionV2,
} from "./persistence-execution.ts";
import type { DealsOnlyExecutionV2 } from "./types.ts";

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error("deals_only_invariant_failed");
}

function parentIdentity(key: ProviderStoreKey | null): string {
  return JSON.stringify(key ? [key.provider, key.namespace, key.id] : null);
}

export function assertDealsOnlyPreviewEvidenceV2(
  preview: AffiliateSyncPreviewV2,
): void {
  assert(preview.provider === "impact");
  assert(
    preview.identityIntegrityDiagnostics.identityCollapseDetected === false,
  );
  for (
    const stream of [
      preview.rawFetchDiagnostics.promotions,
      preview.rawFetchDiagnostics.campaigns,
    ]
  ) {
    assert(
      stream.stopReason === "completed" && stream.parseFailureReason === null,
    );
  }
}

/**
 * The initial preview validates the complete fetch and retains the canonical
 * duplicate occurrence. Classify those retained records with the normalizer's
 * rule so a later no-code duplicate cannot redefine a coupon as a deal.
 */
export function dealPromotionsV2(
  completePreview: AffiliateSyncPreviewV2,
): RawImpactPromotionV2[] {
  return completePreview.normalizedDeals.map((offer) => offer.raw)
    .filter((promotion) => !hasImpactPromotionRedemptionCodeV2(promotion));
}

/**
 * Only acceptedRecordCount describes the planning subset. Preserve the original
 * raw page, parse, quarantine, and identity-carrier evidence; never synthesize a
 * completed provider fetch for a subset. The complete input is previewed first.
 */
export function promotionsPreviewInputV2(
  completeInput: AffiliateSyncPreviewInputV2,
  promotions: readonly RawImpactPromotionV2[],
): AffiliateSyncPreviewInputV2 {
  return {
    ...completeInput,
    acceptedPromotions: promotions,
    fetchDiagnostics: {
      ...completeInput.fetchDiagnostics,
      promotions: {
        ...completeInput.fetchDiagnostics.promotions,
        acceptedRecordCount: promotions.length,
      },
    },
  };
}

/** Select only policy-selected Deals with a qualified exact Campaign parent. */
export function canaryDealPromotionV2(
  preview: AffiliateSyncPreviewV2,
): RawImpactPromotionV2 | null {
  assertDealsOnlyPreviewEvidenceV2(preview);
  const qualifiedParents = new Set(
    preview.storeQualification.filter((store) => store.qualified)
      .map((store) => parentIdentity(store.providerStoreKey)),
  );
  const candidates = preview.proposedActions.offers.filter((offer) =>
    offer.kind === "deal" &&
    (offer.action === "create" || offer.action === "existing") &&
    qualifiedParents.has(parentIdentity(offer.providerStoreKey))
  ).sort((left, right) =>
    left.promotionId < right.promotionId
      ? -1
      : left.promotionId > right.promotionId
      ? 1
      : 0
  );
  const selected = candidates[0];
  if (!selected) return null;
  const raw = preview.normalizedDeals.find((offer) =>
    offer.promotionId === selected.promotionId
  )?.raw;
  assert(!!raw && !hasImpactPromotionRedemptionCodeV2(raw));
  return raw;
}

/** Validate intent against the read-only preview before preparing any RPC. */
export function assertDealsOnlyPlanV2(
  plan: PersistencePlanV2,
  preview: AffiliateSyncPreviewV2,
  mode: DealsOnlyExecutionV2["mode"],
): void {
  assertDealsOnlyPreviewEvidenceV2(preview);
  validatePersistencePlanV2(plan);
  assert(plan.status === "ready" && plan.provider === "impact");
  assert(preview.normalizedCoupons.length === 0);
  const deals = new Map(
    preview.normalizedDeals.map((offer) => [offer.promotionId, offer]),
  );
  const actions = new Map(
    preview.proposedActions.offers.map((offer) => [offer.promotionId, offer]),
  );
  assert(deals.size === plan.offerInstructions.length);
  const expectedActions = {
    create: "create",
    existing: "noop_existing",
    held: "noop_held",
    unresolved: "noop_unresolved",
  } as const;
  for (const instruction of plan.offerInstructions) {
    const deal = deals.get(instruction.providerEntityId);
    const action = actions.get(instruction.providerEntityId);
    assert(
      !!deal && !!action && instruction.kind === "deal" &&
        instruction.provider === "impact" &&
        instruction.providerEntityNamespace === "promotion" &&
        instruction.providerEntityId === deal.raw.promotionId &&
        instruction.promotionId === instruction.providerEntityId &&
        !hasImpactPromotionRedemptionCodeV2(deal.raw) &&
        instruction.action === expectedActions[action.action],
    );
    if (
      instruction.action !== "create" && instruction.action !== "noop_existing"
    ) continue;
    assert(
      deal.association.matchMethod !== "unmatched" &&
        instruction.parentProviderEntityNamespace === "campaign" &&
        instruction.parentProviderStoreKey.provider === "impact" &&
        instruction.parentProviderStoreKey.namespace === "campaign" &&
        instruction.parentProviderStoreKey.id ===
          deal.association.providerStoreKey.id,
    );
    if (instruction.action === "create") {
      assert(
        instruction.projection !== null &&
          instruction.projection.couponType === "deal" &&
          instruction.projection.couponCode === null &&
          typeof instruction.projection.affiliateUrl === "string" &&
          instruction.projection.affiliateUrl.trim().length > 0,
      );
    } else assert(instruction.projection === null);
  }
  if (mode === "canary") {
    const offers = plan.offerInstructions.filter((entry) =>
      entry.action === "create" || entry.action === "noop_existing"
    );
    const stores = plan.storeInstructions.filter((entry) =>
      entry.action === "create" || entry.action === "noop_existing"
    );
    assert(
      offers.length === 1 && plan.offerInstructions.length === 1 &&
        stores.length <= 1 && plan.storeInstructions.length <= 1 &&
        plan.counts.writableOffers <= 1 && plan.counts.writableStores <= 1,
    );
  }
}

/** Recheck the immutable execution capability at the final host boundary. */
export function assertDealsOnlyExecutionV2(
  prepared: PreparedPersistenceExecutionV2,
  plan: PersistencePlanV2,
  mode: DealsOnlyExecutionV2["mode"],
): void {
  const args = persistenceRpcArgs(prepared);
  assert(
    args._provider === "impact" &&
      args._integration_id === plan.integrationId &&
      args._evaluation_timestamp === plan.evaluationTimestamp &&
      JSON.stringify(args._expected_counts) === JSON.stringify(plan.counts),
  );
  const offers = plan.offerInstructions.filter((entry) =>
    entry.action === "create" || entry.action === "noop_existing"
  );
  const stores = plan.storeInstructions.filter((entry) =>
    entry.action === "create" || entry.action === "noop_existing"
  );
  assert(args._offer_instructions.length === offers.length);
  assert(args._store_instructions.length === stores.length);
  args._offer_instructions.forEach((instruction, index) => {
    const planned = offers[index]!;
    assert(
      instruction.kind === "deal" && instruction.provider === "impact" &&
        instruction.providerEntityNamespace === "promotion" &&
        instruction.parentProviderEntityNamespace === "campaign" &&
        instruction.action === planned.action &&
        instruction.providerEntityId === planned.providerEntityId &&
        instruction.parentProviderEntityId ===
          planned.parentProviderStoreKey.id &&
        instruction.existingOfferId === planned.existingOfferId &&
        instruction.expectedParentStoreId === planned.expectedParentStoreId &&
        JSON.stringify(instruction.projection) ===
          JSON.stringify(planned.projection),
    );
    if (instruction.action === "create") {
      assert(
        instruction.projection !== null &&
          instruction.projection.couponType === "deal" &&
          instruction.projection.couponCode === null &&
          typeof instruction.projection.affiliateUrl === "string" &&
          instruction.projection.affiliateUrl.trim().length > 0,
      );
    }
  });
  args._store_instructions.forEach((instruction, index) => {
    const planned = stores[index]!;
    assert(
      instruction.provider === "impact" &&
        instruction.providerEntityNamespace === "campaign" &&
        instruction.providerEntityId === planned.providerEntityId &&
        instruction.action === planned.action &&
        instruction.expectedExistingStoreId ===
          planned.expectedExistingStoreId &&
        JSON.stringify(instruction.projection) ===
          JSON.stringify(planned.projection),
    );
  });
  if (mode === "canary") {
    assert(
      args._offer_instructions.length === 1 &&
        args._store_instructions.length <= 1,
    );
  }
}
