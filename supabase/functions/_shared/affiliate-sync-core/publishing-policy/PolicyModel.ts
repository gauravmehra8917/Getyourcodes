// Runtime-neutral mapping of an already-read policy row. Database reads and
// Runtime-specific policy loading remains outside this policy model.

import { FALLBACK_POLICY, RANKING_KEYS, type PublishingPolicy, type RankingKey } from "./types.ts";

export type PublishingPolicyRow = Record<string, unknown>;

const num = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

export function mapPolicyRow(row: PublishingPolicyRow): PublishingPolicy {
  const ranking = Array.isArray(row.ranking_priority)
    ? (row.ranking_priority as string[]).filter((key): key is RankingKey => (RANKING_KEYS as string[]).includes(key))
    : [];
  return {
    id: String(row.id), name: String(row.name ?? "Publishing policy"), description: (row.description as string | null) ?? null,
    enabled: bool(row.enabled, true), isDefault: bool(row.is_default, false),
    minCouponsPerStore: num(row.min_coupons_per_store), maxCouponsPerStore: num(row.max_coupons_per_store),
    minDealsPerStore: num(row.min_deals_per_store), maxDealsPerStore: num(row.max_deals_per_store),
    rankingPriority: [...ranking, ...RANKING_KEYS.filter((key) => !ranking.includes(key))],
    fairDistribution: bool(row.fair_distribution, false), rotation: bool(row.rotation, false),
    publishOnlyActive: bool(row.publish_only_active, true), skipExpired: bool(row.skip_expired, true),
    skipDuplicateIdentities: bool(row.skip_duplicate_identities, true), respectManualDisable: bool(row.respect_manual_disable, true),
    neverOverwriteAdminEdits: bool(row.never_overwrite_admin_edits, true), previewBeforeImport: bool(row.preview_before_import, true),
  };
}

export { FALLBACK_POLICY };
