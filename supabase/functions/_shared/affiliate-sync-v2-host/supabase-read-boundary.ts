import { createPrivilegedEdgeClient } from "../edge-supabase.ts";
import type {
  CatalogOfferIdentityRowV2,
  CatalogStoreIdentityRowV2,
  PreviewV2DataSource,
  StoredIntegrationV2,
  StoredPublishingPolicyV2,
} from "./types.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const INTEGRATION_SELECT =
  "id,provider_name,authentication_type,base_url,endpoint_configuration,is_enabled,timeout_seconds,retry_attempts,orchestration_page_size,orchestration_max_pages,publishing_policy_id";
const POLICY_SELECT =
  "enabled,min_coupons_per_store,max_coupons_per_store,min_deals_per_store,max_deals_per_store";
const PAGE_SIZE = 1_000;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integrationFromRow(row: Row): StoredIntegrationV2 {
  return {
    id: String(row.id),
    providerName: text(row.provider_name) ?? "",
    authenticationType: text(row.authentication_type) ?? "",
    baseUrl: text(row.base_url) ?? "",
    endpointConfiguration: objectOrEmpty(row.endpoint_configuration),
    isEnabled: row.is_enabled === true,
    timeoutSeconds: numberOr(row.timeout_seconds, 30),
    retryAttempts: numberOr(row.retry_attempts, 0),
    pageSize: numberOr(row.orchestration_page_size, 100),
    maxPages: numberOrNull(row.orchestration_max_pages),
    publishingPolicyId: text(row.publishing_policy_id),
  };
}

function policyFromRow(row: Row): StoredPublishingPolicyV2 {
  return {
    enabled: row.enabled !== false,
    minimumCouponsPerStore: numberOr(row.min_coupons_per_store, 0),
    maximumCouponsPerStore: numberOr(row.max_coupons_per_store, 0),
    minimumDealsPerStore: numberOr(row.min_deals_per_store, 0),
    maximumDealsPerStore: numberOr(row.max_deals_per_store, 0),
  };
}

/** Narrow privileged read model. No database client leaves this module. */
export class SupabasePreviewV2DataSource implements PreviewV2DataSource {
  private readonly db: PrivilegedEdgeClient;

  constructor(db: PrivilegedEdgeClient = createPrivilegedEdgeClient()) {
    this.db = db;
  }

  async hasAdminRole(userId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) throw new Error("admin_role_read_failed");
    return data !== null;
  }

  async readIntegration(
    integrationId: string,
  ): Promise<StoredIntegrationV2 | null> {
    const { data, error } = await this.db
      .from("affiliate_integrations")
      .select(INTEGRATION_SELECT)
      .eq("id", integrationId)
      .maybeSingle();
    if (error) throw new Error("integration_read_failed");
    return data ? integrationFromRow(data as Row) : null;
  }

  async readCredentialCiphertext(
    integrationId: string,
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from("affiliate_integration_credentials")
      .select("ciphertext")
      .eq("integration_id", integrationId)
      .maybeSingle();
    if (error) throw new Error("credential_read_failed");
    return data ? text((data as Row).ciphertext) : null;
  }

  async readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<StoredPublishingPolicyV2 | null> {
    if (publishingPolicyId) {
      const { data, error } = await this.db
        .from("publishing_policies")
        .select(POLICY_SELECT)
        .eq("id", publishingPolicyId)
        .maybeSingle();
      if (error) throw new Error("publishing_policy_read_failed");
      if (data) return policyFromRow(data as Row);
    }
    const { data, error } = await this.db
      .from("publishing_policies")
      .select(POLICY_SELECT)
      .eq("is_default", true)
      .maybeSingle();
    if (error) throw new Error("publishing_policy_read_failed");
    return data ? policyFromRow(data as Row) : null;
  }

  async readImpactStoreIdentityRows(): Promise<
    readonly CatalogStoreIdentityRowV2[]
  > {
    const rows: CatalogStoreIdentityRowV2[] = [];
    for (let from = 0;; from += PAGE_SIZE) {
      const { data, error } = await this.db
        .from("stores")
        .select("id,provider_entity_id")
        .eq("provider", "impact")
        .not("provider_entity_id", "is", null)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error("catalog_store_read_failed");
      const page = (data ?? []) as Row[];
      rows.push(
        ...page.map((row) => ({
          id: row.id,
          providerEntityId: row.provider_entity_id,
        })),
      );
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async readImpactOfferIdentityRows(): Promise<
    readonly CatalogOfferIdentityRowV2[]
  > {
    const rows: CatalogOfferIdentityRowV2[] = [];
    for (let from = 0;; from += PAGE_SIZE) {
      const { data, error } = await this.db
        .from("coupons")
        .select("id,provider_entity_id")
        .eq("provider", "impact")
        .not("provider_entity_id", "is", null)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error("catalog_offer_read_failed");
      const page = (data ?? []) as Row[];
      rows.push(
        ...page.map((row) => ({
          id: row.id,
          providerEntityId: row.provider_entity_id,
        })),
      );
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }
}
