// Server-side loading of publishing policies, rotation state and ranking hints.
// Kept separate from the engine so the engine stays pure and testable.

import { FALLBACK_POLICY, type PolicyContext, type PublishingPolicy } from "./types";
import { mapPolicyRow } from "./PolicyModel";

type Row = Record<string, unknown>;

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
export { mapPolicyRow } from "./PolicyModel";

const SELECT =
  "id, name, description, enabled, is_default, min_coupons_per_store, max_coupons_per_store, min_deals_per_store, max_deals_per_store, ranking_priority, fair_distribution, rotation, publish_only_active, skip_expired, skip_duplicate_identities, respect_manual_disable, never_overwrite_admin_edits, preview_before_import";

/** Resolves the policy for an integration: custom when assigned, else global default. */
export async function loadPolicyForIntegration(integrationId: string): Promise<PublishingPolicy> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { data: integration } = await db
    .from("affiliate_integrations")
    .select("publishing_policy_id")
    .eq("id", integrationId)
    .maybeSingle();

  const assigned = integration?.publishing_policy_id as string | null | undefined;
  if (assigned) {
    const { data } = await db.from("publishing_policies").select(SELECT).eq("id", assigned).maybeSingle();
    if (data) return mapPolicyRow(data);
  }

  const { data: fallback } = await db
    .from("publishing_policies")
    .select(SELECT)
    .eq("is_default", true)
    .maybeSingle();
  return fallback ? mapPolicyRow(fallback) : FALLBACK_POLICY;
}

/** Rotation cursors + merchant priority + manually disabled offers. */
export async function loadPolicyContext(
  policy: PublishingPolicy,
  provider: string,
): Promise<PolicyContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const ctx: PolicyContext = { rotation: {}, merchantPriority: {}, manuallyDisabledIds: [] };

  if (policy.rotation && policy.id !== FALLBACK_POLICY.id) {
    const { data } = await db
      .from("publishing_rotation_state")
      .select("store_key, cursor")
      .eq("policy_id", policy.id)
      .eq("provider", provider);
    for (const r of (data ?? []) as Row[]) {
      ctx.rotation![String(r.store_key)] = num(r.cursor);
    }
  }

  const { data: stores } = await db
    .from("stores")
    .select("provider_entity_id, featured")
    .eq("provider", provider)
    .eq("featured", true);
  for (const s of (stores ?? []) as Row[]) {
    if (s.provider_entity_id) ctx.merchantPriority![String(s.provider_entity_id)] = 1;
  }

  if (policy.respectManualDisable) {
    const { data: drafts } = await db
      .from("coupons")
      .select("id")
      .eq("provider", provider)
      .eq("status", "draft");
    ctx.manuallyDisabledIds = ((drafts ?? []) as Row[]).map((r) => String(r.id));
  }

  return ctx;
}

/** Persists rotation cursors after a committed import. Never throws. */
export async function saveRotationState(
  policy: PublishingPolicy,
  provider: string,
  cursors: Record<string, number>,
): Promise<void> {
  if (!policy.rotation || policy.id === FALLBACK_POLICY.id) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const rows = Object.entries(cursors).map(([store_key, cursor]) => ({
      policy_id: policy.id,
      provider,
      store_key,
      cursor,
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) return;
    await db.from("publishing_rotation_state").upsert(rows, { onConflict: "policy_id,provider,store_key" });
  } catch {
    // rotation bookkeeping must never fail an import
  }
}
