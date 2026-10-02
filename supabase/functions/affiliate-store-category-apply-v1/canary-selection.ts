import { planStoreCategories } from "../_shared/affiliate-store-category-v1/planner.ts";
import type { CategoryPlanningInput } from "../_shared/affiliate-store-category-v1/planner.ts";
import type { CategoryCanaryEvidence } from "./types.ts";

/** Keep the authoritative planner unchanged; join its decision to its source evidence. */
export function selectCategoryCanary(input: CategoryPlanningInput): {
  selected: CategoryCanaryEvidence | null;
  assignable: number;
} {
  const assignments = planStoreCategories(input)
    .flatMap((decision, index) =>
      decision.action === "assign"
        ? [
            {
              storeId: decision.storeId,
              campaignId: decision.campaignId,
              categoryId: decision.categoryId,
              // All observed keys, including currently unmapped/weaker ones, must be
              // re-resolved: a newly enabled or stronger mapping can change the winner.
              providerCategoryKeys: [
                ...new Set(input.campaigns[index]!.labels.map((label) => label.key)),
              ],
            },
          ]
        : [],
    )
    .sort((a, b) => (a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0));
  return { selected: assignments[0] ?? null, assignable: assignments.length };
}
