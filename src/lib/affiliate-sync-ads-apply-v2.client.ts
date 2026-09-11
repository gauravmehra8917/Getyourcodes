import { supabase } from "@/integrations/supabase/client";

export const AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION = "affiliate-sync-ads-apply-v2" as const;
export const ADMIN_IMPACT_IMPORT_MUTATION_OPTIONS = { retry: false } as const;

export type AffiliateSyncAdsApplyV2Success = {
  status: "committed" | "replayed_existing";
  runId: string;
  mode: "full";
  evaluationTimestamp: string;
  refreshedPlan: true;
  counts: {
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
  };
  created: { stores: number; coupons: number };
  noops: { stores: number; coupons: number };
  ledgerRows: number;
};

export type AffiliateSyncAdsApplyV2Result =
  | AffiliateSyncAdsApplyV2Success
  | { status: "blocked" | "failed" | "indeterminate" };

export type AffiliateSyncAdsApplyV2Invoke = (
  functionName: typeof AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION,
  options: { body: { integrationId: string; execute: true; mode: "full" } },
) => Promise<{ data: unknown; error: unknown }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMPACT_PROVIDER_NAMES = new Set(["impact", "impact.com", "impact radius"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parsePair(value: unknown): { stores: number; coupons: number } | null {
  if (!isRecord(value) || !hasExactKeys(value, ["stores", "coupons"])) return null;
  if (!nonnegativeInteger(value.stores) || !nonnegativeInteger(value.coupons)) return null;
  return { stores: value.stores, coupons: value.coupons };
}

function parseCounts(value: unknown): AffiliateSyncAdsApplyV2Success["counts"] | null {
  if (!isRecord(value) || !hasExactKeys(value, ["expected", "actual"])) return null;
  if (!isRecord(value.expected) || !isRecord(value.actual)) return null;
  return { expected: { ...value.expected }, actual: { ...value.actual } };
}

export function isExactImpactProvider(providerName: unknown): boolean {
  return typeof providerName === "string" && IMPACT_PROVIDER_NAMES.has(providerName.trim().toLowerCase());
}

export function parseAffiliateSyncAdsApplyV2Response(value: unknown): AffiliateSyncAdsApplyV2Result | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "blocked" || value.status === "failed" || value.status === "indeterminate") {
    return { status: value.status };
  }
  if (value.status !== "committed" && value.status !== "replayed_existing") return null;
  if (!hasExactKeys(value, [
    "status",
    "runId",
    "mode",
    "evaluationTimestamp",
    "refreshedPlan",
    "counts",
    "created",
    "noops",
    "ledgerRows",
  ])) return null;
  const created = parsePair(value.created);
  const noops = parsePair(value.noops);
  const counts = parseCounts(value.counts);
  if (
    typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId) ||
    value.mode !== "full" || typeof value.evaluationTimestamp !== "string" ||
    !Number.isFinite(Date.parse(value.evaluationTimestamp)) || value.refreshedPlan !== true ||
    !counts || !created || !noops || !nonnegativeInteger(value.ledgerRows)
  ) return null;
  return {
    status: value.status,
    runId: value.runId,
    mode: "full",
    evaluationTimestamp: value.evaluationTimestamp,
    refreshedPlan: true,
    counts,
    created,
    noops,
    ledgerRows: value.ledgerRows,
  };
}

export async function requestAffiliateSyncAdsApplyV2(
  integrationId: string,
  invoke: AffiliateSyncAdsApplyV2Invoke,
): Promise<AffiliateSyncAdsApplyV2Result> {
  if (!UUID_PATTERN.test(integrationId)) return { status: "failed" };
  try {
    const { data, error } = await invoke(AFFILIATE_SYNC_ADS_APPLY_V2_FUNCTION, {
      body: { integrationId, execute: true, mode: "full" },
    });
    const parsed = parseAffiliateSyncAdsApplyV2Response(data);
    if (parsed && (parsed.status === "blocked" || parsed.status === "failed")) return parsed;
    if (error) return { status: "indeterminate" };
    return parsed ?? { status: "indeterminate" };
  } catch {
    return { status: "indeterminate" };
  }
}

export function importImpactCoupons(integrationId: string): Promise<AffiliateSyncAdsApplyV2Result> {
  return requestAffiliateSyncAdsApplyV2(integrationId, (functionName, options) =>
    supabase.functions.invoke(functionName, options),
  );
}