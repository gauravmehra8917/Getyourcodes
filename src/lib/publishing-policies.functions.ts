import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PublishingPolicyRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  is_default: boolean;
  min_coupons_per_store: number;
  max_coupons_per_store: number;
  min_deals_per_store: number;
  max_deals_per_store: number;
  ranking_priority: string[];
  fair_distribution: boolean;
  rotation: boolean;
  publish_only_active: boolean;
  skip_expired: boolean;
  skip_duplicate_identities: boolean;
  respect_manual_disable: boolean;
  never_overwrite_admin_edits: boolean;
  preview_before_import: boolean;
  created_at: string;
  updated_at: string;
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

const POLICY_SELECT =
  "id, name, description, enabled, is_default, min_coupons_per_store, max_coupons_per_store, min_deals_per_store, max_deals_per_store, ranking_priority, fair_distribution, rotation, publish_only_active, skip_expired, skip_duplicate_identities, respect_manual_disable, never_overwrite_admin_edits, preview_before_import, created_at, updated_at";

const policySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  enabled: z.boolean().default(true),
  is_default: z.boolean().default(false),
  min_coupons_per_store: z.number().int().min(0).max(1000).default(0),
  max_coupons_per_store: z.number().int().min(0).max(1000).default(0),
  min_deals_per_store: z.number().int().min(0).max(1000).default(0),
  max_deals_per_store: z.number().int().min(0).max(1000).default(0),
  ranking_priority: z
    .array(z.enum(["merchant_priority", "discount", "newest", "expiry"]))
    .default(["merchant_priority", "discount", "newest", "expiry"]),
  fair_distribution: z.boolean().default(true),
  rotation: z.boolean().default(false),
  publish_only_active: z.boolean().default(true),
  skip_expired: z.boolean().default(true),
  skip_duplicate_identities: z.boolean().default(true),
  respect_manual_disable: z.boolean().default(true),
  never_overwrite_admin_edits: z.boolean().default(true),
  preview_before_import: z.boolean().default(true),
});

export const listPublishingPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { data, error } = await ctx.supabase
      .from("publishing_policies")
      .select(POLICY_SELECT)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PublishingPolicyRow[];
  });

export const savePublishingPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid().nullable().default(null), policy: policySchema }).parse(v))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const values = { ...data.policy, description: data.policy.description || null };

    if (values.is_default) {
      await db
        .from("publishing_policies")
        .update({ is_default: false })
        .eq("is_default", true)
        .neq("id", data.id ?? "00000000-0000-0000-0000-000000000000");
      values.enabled = true;
    }

    if (data.id) {
      const { error } = await db.from("publishing_policies").update(values).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: inserted, error } = await db
      .from("publishing_policies")
      .insert(values)
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create policy");
    return { id: inserted.id as string };
  });

export const deletePublishingPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: row } = await db
      .from("publishing_policies")
      .select("is_default")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.is_default) throw new Error("The global default policy cannot be deleted");
    const { error } = await db.from("publishing_policies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setDefaultPublishingPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    await db.from("publishing_policies").update({ is_default: false }).eq("is_default", true);
    const { error } = await db
      .from("publishing_policies")
      .update({ is_default: true, enabled: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Assigns a policy to an integration. Null means "use the global default". */
export const setIntegrationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ integrationId: z.string().uuid(), policyId: z.string().uuid().nullable() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("affiliate_integrations")
      .update({ publishing_policy_id: data.policyId })
      .eq("id", data.integrationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
