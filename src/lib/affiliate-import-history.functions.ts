import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AffiliateImportRunRow {
  id: string;
  provider: string;
  preview: boolean;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  success: boolean;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  records_published: number | null;
  validation_errors: number;
  warnings: number;
  error_message: string | null;
  policy_name: string | null;
  records_held: number;
  import_strategy: string;
  pages_crawled: number;
  api_calls_used: number;
  records_fetched: number;
  new_provider_identities: number;
  existing_provider_identities: number;
  stop_reason: string | null;
  persistence_contract_version: string | null;
  persistence_execution_status: string | null;
  statistics: {
    lifecycle?: {
      storesHeld: number;
      storesToLifecycleHide: number;
      storesToLifecycleRepublish: number;
    } | null;
  } | null;
}

export const getAffiliateImportHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => z.object({ integrationId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { data: role, error: roleError } = await context.supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !role) throw new Error("Forbidden: admin only");

    const { data: rows, error } = await context.supabase
      .from("affiliate_import_runs")
      .select(
        "id, provider, preview, started_at, finished_at, duration_ms, success, records_processed, records_created, records_updated, records_skipped, records_published, validation_errors, warnings, error_message, policy_name, records_held, import_strategy, pages_crawled, api_calls_used, records_fetched, new_provider_identities, existing_provider_identities, stop_reason, persistence_contract_version, persistence_execution_status, statistics",
      )
      .eq("integration_id", data.integrationId)
      .order("started_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (rows ?? []) as AffiliateImportRunRow[];
  });