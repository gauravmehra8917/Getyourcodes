import { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import { SupabasePreviewV2DataSource } from "../_shared/affiliate-sync-v2-host/supabase-read-boundary.ts";
import type {
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";
import {
  type CatalogPlanningContextV2,
  loadCatalogPlanningContextV2,
} from "./catalog-planning-context.ts";
import {
  type ApplyAffiliatePersistencePlanV2ArgsV2,
  persistenceRpcArgs,
  type PreparedPersistenceExecutionV2,
} from "./persistence-execution.ts";
import type { ApplyV2PublishingPolicy } from "./types.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;
type Row = Record<string, unknown>;

const POLICY_SELECT =
  "enabled,min_coupons_per_store,max_coupons_per_store,min_deals_per_store,max_deals_per_store";

function rawPublishingPolicy(row: Row): ApplyV2PublishingPolicy {
  return {
    enabled: row.enabled,
    minimumCouponsPerStore: row.min_coupons_per_store,
    maximumCouponsPerStore: row.max_coupons_per_store,
    minimumDealsPerStore: row.min_deals_per_store,
    maximumDealsPerStore: row.max_deals_per_store,
  };
}

export type ApplyV2RpcTransportResult =
  | { kind: "response"; value: unknown }
  | { kind: "transport_error" };

/**
 * Trusted service-role boundary. Shared integration reads are delegated to the
 * settled preview boundary; apply-only policy evidence remains raw. The sole
 * mutation capability is the A9C transactional RPC.
 */
export class SupabaseApplyV2DataSource {
  private readonly db: PrivilegedEdgeClient;
  private readonly reads: SupabasePreviewV2DataSource;

  constructor(db: PrivilegedEdgeClient = createPrivilegedEdgeClient()) {
    this.db = db;
    this.reads = new SupabasePreviewV2DataSource(db);
  }

  hasAdminRole(userId: string): Promise<boolean> {
    return this.reads.hasAdminRole(userId);
  }

  readIntegration(integrationId: string): Promise<StoredIntegrationV2 | null> {
    return this.reads.readIntegration(integrationId);
  }

  readCredentialCiphertext(integrationId: string): Promise<string | null> {
    return this.reads.readCredentialCiphertext(integrationId);
  }

  async readPublishingPolicy(
    publishingPolicyId: string | null,
  ): Promise<ApplyV2PublishingPolicy | null> {
    if (publishingPolicyId) {
      const { data, error } = await this.db
        .from("publishing_policies")
        .select(POLICY_SELECT)
        .eq("id", publishingPolicyId)
        .maybeSingle();
      if (error) throw new Error("publishing_policy_read_failed");
      if (data) return rawPublishingPolicy(data as Row);
    }
    const { data, error } = await this.db
      .from("publishing_policies")
      .select(POLICY_SELECT)
      .eq("is_default", true)
      .maybeSingle();
    if (error) throw new Error("publishing_policy_read_failed");
    return data ? rawPublishingPolicy(data as Row) : null;
  }

  loadCatalogPlanningContext(): Promise<CatalogPlanningContextV2> {
    return loadCatalogPlanningContextV2(this.db);
  }

  async applyPersistencePlan(
    prepared: PreparedPersistenceExecutionV2,
  ): Promise<ApplyV2RpcTransportResult> {
    const args: ApplyAffiliatePersistencePlanV2ArgsV2 = persistenceRpcArgs(
      prepared,
    );
    try {
      const { data, error } = await this.db.rpc(
        "apply_affiliate_persistence_plan_v2",
        args,
      );
      if (error) return { kind: "transport_error" };
      return { kind: "response", value: data };
    } catch {
      return { kind: "transport_error" };
    }
  }
}
