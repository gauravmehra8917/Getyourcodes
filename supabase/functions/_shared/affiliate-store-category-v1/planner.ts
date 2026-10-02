import { exactCampaignId, normalizeCategoryLabel, UUID_PATTERN } from "./taxonomy.ts";
import type { CampaignCategoryFact } from "./taxonomy.ts";

export interface StoreCategoryFact {
  id: string;
  provider: string;
  providerEntityNamespace: string;
  providerEntityId: string;
  categoryId: string | null;
}

export interface CategoryMappingFact {
  id: string;
  provider: string;
  normalizedProviderCategoryKey: string;
  categoryId: string;
  priority: number;
  enabled: boolean;
}

export type CategoryDecision =
  | { action: "assign"; storeId: string; categoryId: string; campaignId: string }
  | {
      action:
        | "noop_existing_category"
        | "unmapped"
        | "ambiguous_mapping"
        | "unknown_store"
        | "ambiguous_store"
        | "invalid_source";
    };

export interface CategoryPlanningInput {
  campaigns: readonly CampaignCategoryFact[];
  stores: readonly StoreCategoryFact[];
  categoryIds: readonly string[];
  mappings: readonly CategoryMappingFact[];
}

/** Pure preview evidence only. Lower integer priority is stronger. */
export function planStoreCategories(input: CategoryPlanningInput): CategoryDecision[] {
  const occurrences = new Map<string, number>();
  for (const campaign of input.campaigns) {
    if (campaign.campaignId !== null) {
      occurrences.set(campaign.campaignId, (occurrences.get(campaign.campaignId) ?? 0) + 1);
    }
  }
  return input.campaigns.map((campaign): CategoryDecision => {
    if (
      campaign.campaignId === null ||
      exactCampaignId(campaign.campaignId) !== campaign.campaignId
    ) {
      return { action: "invalid_source" };
    }
    const stores = input.stores.filter(
      (store) =>
        store.provider === "impact" &&
        store.providerEntityNamespace === "campaign" &&
        store.providerEntityId === campaign.campaignId,
    );
    if (stores.length === 0) return { action: "unknown_store" };
    if (stores.length !== 1) return { action: "ambiguous_store" };
    const store = stores[0]!;
    if (!UUID_PATTERN.test(store.id) || store.categoryId === undefined) {
      return { action: "invalid_source" };
    }
    // Any existing editorial choice wins, even if provider taxonomy disappears.
    if (store.categoryId !== null) return { action: "noop_existing_category" };
    if (
      campaign.invalid ||
      occurrences.get(campaign.campaignId) !== 1 ||
      campaign.labels.length > 32 ||
      campaign.labels.some((label) => normalizeCategoryLabel(label.label)?.key !== label.key)
    ) {
      return { action: "invalid_source" };
    }
    const keys = new Set(campaign.labels.map((label) => label.key));
    const mappings = input.mappings.filter(
      (mapping) =>
        mapping.enabled &&
        mapping.provider === "impact" &&
        keys.has(mapping.normalizedProviderCategoryKey),
    );
    if (mappings.length === 0) return { action: "unmapped" };
    if (
      mappings.some(
        (mapping) =>
          !UUID_PATTERN.test(mapping.id) ||
          !UUID_PATTERN.test(mapping.categoryId) ||
          !input.categoryIds.includes(mapping.categoryId) ||
          !Number.isInteger(mapping.priority) ||
          mapping.priority < -2147483648 ||
          mapping.priority > 2147483647,
      )
    )
      return { action: "invalid_source" };
    const bestPriority = Math.min(...mappings.map((mapping) => mapping.priority));
    const targets = new Set(
      mappings
        .filter((mapping) => mapping.priority === bestPriority)
        .map((mapping) => mapping.categoryId),
    );
    if (targets.size !== 1) return { action: "ambiguous_mapping" };
    return {
      action: "assign",
      storeId: store.id,
      categoryId: [...targets][0]!,
      campaignId: campaign.campaignId,
    };
  });
}

export function summarizeCategoryPlan(
  input: CategoryPlanningInput,
  decisions: readonly CategoryDecision[],
) {
  const count = (action: CategoryDecision["action"]) =>
    decisions.filter((d) => d.action === action).length;
  const unmappedKeys = new Set<string>();
  input.campaigns.forEach((campaign, index) => {
    if (decisions[index]?.action !== "unmapped") return;
    for (const label of campaign.labels) unmappedKeys.add(label.key);
  });
  const exactStoresMatched = input.campaigns.filter(
    (campaign) =>
      campaign.campaignId !== null &&
      input.stores.filter(
        (store) =>
          store.provider === "impact" &&
          store.providerEntityNamespace === "campaign" &&
          store.providerEntityId === campaign.campaignId,
      ).length === 1,
  ).length;
  return {
    campaignsEvaluated: decisions.length,
    exactStoresMatched,
    assignable: count("assign"),
    alreadyCategorized: count("noop_existing_category"),
    unmapped: count("unmapped"),
    ambiguous: count("ambiguous_mapping") + count("ambiguous_store"),
    ambiguousMapping: count("ambiguous_mapping"),
    ambiguousStore: count("ambiguous_store"),
    unknownStore: count("unknown_store"),
    invalidSource: count("invalid_source"),
    distinctUnmappedLabels: unmappedKeys.size,
  };
}
