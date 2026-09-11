import { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import { SupabasePreviewV2DataSource } from "../_shared/affiliate-sync-v2-host/supabase-read-boundary.ts";
import type { StoredIntegrationV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import { loadAdsCatalogPlanningContextV2 } from "./catalog-planning-context.ts";
import {
  adsPersistenceRpcArgsV2,
  type ApplyAffiliateAdsPersistencePlanV2Args,
  type PreparedAdsPersistenceExecutionV2,
} from "./persistence-execution.ts";
import type { AdsApplyV2RpcTransportResult } from "./types.ts";

type PrivilegedEdgeClient = ReturnType<typeof createPrivilegedEdgeClient>;

/** Narrow service-role boundary; the RPC is the sole mutation capability. */
export class SupabaseAdsApplyV2DataSource {
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

  loadCatalogPlanningContext() {
    return loadAdsCatalogPlanningContextV2(this.db);
  }

  async applyPersistencePlan(
    prepared: PreparedAdsPersistenceExecutionV2,
  ): Promise<AdsApplyV2RpcTransportResult> {
    const args: ApplyAffiliateAdsPersistencePlanV2Args =
      adsPersistenceRpcArgsV2(prepared);
    try {
      const { data, error } = await this.db.rpc(
        "apply_affiliate_persistence_plan_v2",
        args,
      );
      return error
        ? { kind: "transport_error" }
        : { kind: "response", value: data };
    } catch {
      return { kind: "transport_error" };
    }
  }
}
