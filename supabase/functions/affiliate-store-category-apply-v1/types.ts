import type {
  CategoryPreviewDataSource,
  CategoryPreviewDependencies,
} from "../affiliate-store-category-preview-v1/types.ts";

export {
  CATALOG_ROW_LIMIT,
  CAMPAIGN_RECORD_LIMIT,
  RESPONSE_BYTE_LIMIT,
} from "../affiliate-store-category-preview-v1/types.ts";

/** Internal evidence only: never accepted from the browser or returned to it. */
export interface CategoryCanaryEvidence {
  storeId: string;
  campaignId: string;
  categoryId: string;
  providerCategoryKeys: readonly string[];
}

export const BLOCKED_OUTCOMES = [
  "invalid_request",
  "store_identity_mismatch",
  "category_not_found",
  "mapping_unmapped",
  "mapping_ambiguous",
  "mapping_stale",
  "internal_failure",
] as const;

export type CategoryCanaryResult =
  | { status: "assigned"; outcome: "assigned" }
  | { status: "noop_existing_category"; outcome: "noop_existing_category" }
  | { status: "blocked"; outcome: (typeof BLOCKED_OUTCOMES)[number] };

/** Only the bounded category RPC extends the existing read interface. */
export interface CategoryCanaryDataSource extends CategoryPreviewDataSource {
  applyCanary(evidence: CategoryCanaryEvidence): Promise<CategoryCanaryResult>;
}

export interface CategoryCanaryDependencies extends Omit<
  CategoryPreviewDependencies,
  "createDataSource"
> {
  createDataSource(): CategoryCanaryDataSource;
}

export const CATEGORY_CANARY_VERSION = "p1c-a2-v1";
