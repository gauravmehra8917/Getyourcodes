import type { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import {
  canonicalCampaignId,
  UUID_PATTERN,
} from "../_shared/affiliate-store-category-v1/taxonomy.ts";
import { SupabaseCategoryPreviewDataSource } from "../affiliate-store-category-preview-v1/supabase-read-boundary.ts";
import { BLOCKED_OUTCOMES } from "./types.ts";
import type {
  CategoryCanaryDataSource,
  CategoryCanaryEvidence,
  CategoryCanaryResult,
} from "./types.ts";

type EdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;

/** Validate the exact closed RPC result, without forwarding database error details. */
export function parseCategoryCanaryResult(value: unknown): CategoryCanaryResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_canary_result");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join(",") !== "outcome,status")
    throw new Error("invalid_canary_result");
  if (result.status === "assigned" && result.outcome === "assigned")
    return { status: "assigned", outcome: "assigned" };
  if (result.status === "noop_existing_category" && result.outcome === "noop_existing_category")
    return { status: "noop_existing_category", outcome: "noop_existing_category" };
  if (result.status === "blocked" && BLOCKED_OUTCOMES.some((outcome) => outcome === result.outcome))
    return { status: "blocked", outcome: result.outcome as (typeof BLOCKED_OUTCOMES)[number] };
  throw new Error("invalid_canary_result");
}

/** The existing adapter owns all bounded reads; this adapter adds one named write. */
export class SupabaseCategoryCanaryDataSource implements CategoryCanaryDataSource {
  private readonly db: EdgeClient;
  private readonly reader: SupabaseCategoryPreviewDataSource;

  constructor(db: EdgeClient) {
    this.db = db;
    this.reader = new SupabaseCategoryPreviewDataSource(db);
  }

  hasAdminRole(userId: string) {
    return this.reader.hasAdminRole(userId);
  }
  readIntegration(id: string) {
    return this.reader.readIntegration(id);
  }
  readCredentialCiphertext(id: string) {
    return this.reader.readCredentialCiphertext(id);
  }
  readStores() {
    return this.reader.readStores();
  }
  readCategoryIds() {
    return this.reader.readCategoryIds();
  }
  readMappings() {
    return this.reader.readMappings();
  }

  async applyCanary(evidence: CategoryCanaryEvidence): Promise<CategoryCanaryResult> {
    if (
      !UUID_PATTERN.test(evidence.storeId) ||
      !UUID_PATTERN.test(evidence.categoryId) ||
      canonicalCampaignId(evidence.campaignId) !== evidence.campaignId ||
      evidence.campaignId.length > 1024 ||
      evidence.providerCategoryKeys.length < 1 ||
      evidence.providerCategoryKeys.length > 32 ||
      new Set(evidence.providerCategoryKeys).size !== evidence.providerCategoryKeys.length ||
      evidence.providerCategoryKeys.some(
        (key) => typeof key !== "string" || key.length < 1 || key.length > 320,
      )
    )
      throw new Error("invalid_canary_evidence");
    const { data, error } = await this.db.rpc("apply_affiliate_store_category_canary_v1", {
      p_store_id: evidence.storeId,
      p_campaign_id: evidence.campaignId,
      p_category_id: evidence.categoryId,
      p_provider_category_keys: [...evidence.providerCategoryKeys],
    });
    if (error) throw new Error("canary_persistence_failed");
    return parseCategoryCanaryResult(data);
  }
}
