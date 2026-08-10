// Loads immutable offer identities once per run. Range pagination prevents a
// single oversized Supabase response and avoids per-provider-record lookups.

const BATCH_SIZE = 1000;

export async function loadExistingProviderOfferIds(provider: string): Promise<Set<string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ids = new Set<string>();
  for (let from = 0; ; from += BATCH_SIZE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any)
      .from("coupons")
      .select("provider_entity_id")
      .eq("provider", provider)
      .not("provider_entity_id", "is", null)
      .range(from, from + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) if (typeof row.provider_entity_id === "string") ids.add(row.provider_entity_id);
    if (rows.length < BATCH_SIZE) break;
  }
  return ids;
}
