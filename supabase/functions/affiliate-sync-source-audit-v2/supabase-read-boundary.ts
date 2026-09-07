import { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import type { StoredIntegrationV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import type { SourceAuditV2DataSource } from "./types.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const INTEGRATION_SELECT =
  "id,provider_name,authentication_type,base_url,endpoint_configuration,is_enabled,timeout_seconds,retry_attempts,orchestration_page_size,orchestration_max_pages,publishing_policy_id";

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

/** Exactly three privileged SELECT capabilities; no database client escapes. */
export class SupabaseSourceAuditV2DataSource
  implements SourceAuditV2DataSource {
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
}
