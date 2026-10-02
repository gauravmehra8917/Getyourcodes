import type { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import { UUID_PATTERN } from "../_shared/affiliate-store-category-v1/taxonomy.ts";
import type {
  CategoryMappingFact,
  StoreCategoryFact,
} from "../_shared/affiliate-store-category-v1/planner.ts";
import type { StoredIntegrationV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import { CATALOG_ROW_LIMIT } from "./types.ts";
import type { CategoryPreviewDataSource } from "./types.ts";

type EdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;
const PAGE_SIZE = 500;

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_read_fact");
  }
  return value as Row;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_read_fact");
  return value;
}
function uuid(value: unknown): string {
  const text = string(value);
  if (!UUID_PATTERN.test(text)) throw new Error("invalid_read_fact");
  return text.toLowerCase();
}
function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** No database client leaves this adapter. Reads fail on truncation or malformed rows. */
export class SupabaseCategoryPreviewDataSource implements CategoryPreviewDataSource {
  private readonly db: EdgeClient;

  constructor(db: EdgeClient) {
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

  async readIntegration(id: string): Promise<StoredIntegrationV2 | null> {
    const { data, error } = await this.db
      .from("affiliate_integrations")
      .select(
        "id,provider_name,authentication_type,base_url,endpoint_configuration,is_enabled,timeout_seconds,retry_attempts,orchestration_page_size,orchestration_max_pages",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("integration_read_failed");
    if (!data) return null;
    const row = data as Row;
    if (
      !row.endpoint_configuration ||
      typeof row.endpoint_configuration !== "object" ||
      Array.isArray(row.endpoint_configuration)
    )
      throw new Error("invalid_read_fact");
    return {
      id: uuid(row.id),
      providerName: string(row.provider_name),
      authenticationType: string(row.authentication_type),
      baseUrl: string(row.base_url),
      endpointConfiguration: row.endpoint_configuration as Row,
      isEnabled: row.is_enabled === true,
      timeoutSeconds: number(row.timeout_seconds, 15),
      retryAttempts: 0,
      pageSize: number(row.orchestration_page_size, 100),
      maxPages:
        row.orchestration_max_pages === null ? null : number(row.orchestration_max_pages, 10),
      publishingPolicyId: null,
    };
  }

  async readCredentialCiphertext(id: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("affiliate_integration_credentials")
      .select("ciphertext")
      .eq("integration_id", id)
      .maybeSingle();
    if (error) throw new Error("credential_read_failed");
    return data ? string((data as Row).ciphertext) : null;
  }

  private async boundedRows(
    table: "stores" | "categories" | "affiliate_store_category_mappings",
    columns: string,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    // One extra row proves overflow. Stable UUID keysets avoid offset drift.
    let lastId: string | null = null;
    for (;;) {
      let query = this.db
        .from(table)
        .select(columns)
        .order("id", { ascending: true })
        .limit(Math.min(PAGE_SIZE, CATALOG_ROW_LIMIT + 1 - rows.length));
      if (lastId !== null) query = query.gt("id", lastId);
      if (table === "stores")
        query = query.eq("provider", "impact").eq("provider_entity_namespace", "campaign");
      if (table === "affiliate_store_category_mappings")
        query = query.eq("provider", "impact").eq("enabled", true);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw new Error("category_facts_read_failed");
      if (data.length === 0) break;
      for (const raw of data) {
        const row = record(raw);
        const id = uuid(row.id);
        if (lastId !== null && id <= lastId) throw new Error("category_facts_read_failed");
        lastId = id;
        rows.push(row);
      }
      if (rows.length > CATALOG_ROW_LIMIT) throw new Error("category_facts_limit_exceeded");
      // Continue until an empty page; a server-side page cap must not imply completion.
    }
    return rows;
  }

  async readStores(): Promise<StoreCategoryFact[]> {
    return (
      await this.boundedRows(
        "stores",
        "id,provider,provider_entity_namespace,provider_entity_id,category_id",
      )
    ).map((row) => ({
      id: uuid(row.id),
      provider: string(row.provider),
      providerEntityNamespace: string(row.provider_entity_namespace),
      providerEntityId: string(row.provider_entity_id),
      categoryId: row.category_id === null ? null : uuid(row.category_id),
    }));
  }

  async readCategoryIds(): Promise<string[]> {
    return (await this.boundedRows("categories", "id")).map((row) => uuid(row.id));
  }

  async readMappings(): Promise<CategoryMappingFact[]> {
    return (
      await this.boundedRows(
        "affiliate_store_category_mappings",
        "id,provider,normalized_provider_category_key,category_id,priority,enabled",
      )
    ).map((row) => {
      if (
        typeof row.priority !== "number" ||
        !Number.isInteger(row.priority) ||
        typeof row.enabled !== "boolean"
      )
        throw new Error("invalid_read_fact");
      return {
        id: uuid(row.id),
        provider: string(row.provider),
        normalizedProviderCategoryKey: string(row.normalized_provider_category_key),
        categoryId: uuid(row.category_id),
        priority: row.priority,
        enabled: row.enabled,
      };
    });
  }
}
