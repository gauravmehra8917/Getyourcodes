// Phase 3A — presentation-layer server functions (admin only).
// Merchant logo download/caching runs outside the ingestion pipeline.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface LogoSyncReport {
  provider: string;
  processed: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden: admin only");
}

export const syncStoreLogos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        provider: z.string().min(1),
        integrationId: z.string().uuid().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }): Promise<LogoSyncReport> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);

    const { syncStoreLogosForProvider } = await import("@/lib/presentation/logo-sync.server");
    const summary = await syncStoreLogosForProvider(data.provider, data.integrationId ?? null, data.limit ?? 500);
    return { provider: data.provider, ...summary };
  });
