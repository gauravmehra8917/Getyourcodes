// Provider-agnostic publishing policy model.
// The engine only ever sees these shapes — never provider payloads.

export type RankingKey = "merchant_priority" | "discount" | "newest" | "expiry";

export const RANKING_KEYS: RankingKey[] = ["merchant_priority", "discount", "newest", "expiry"];

export const RANKING_LABELS: Record<RankingKey, string> = {
  merchant_priority: "Merchant Priority",
  discount: "Discount %",
  newest: "Newest",
  expiry: "Expiry Date",
};

export interface PublishingPolicy {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  isDefault: boolean;
  minCouponsPerStore: number;
  maxCouponsPerStore: number;
  minDealsPerStore: number;
  maxDealsPerStore: number;
  rankingPriority: RankingKey[];
  fairDistribution: boolean;
  rotation: boolean;
  publishOnlyActive: boolean;
  skipExpired: boolean;
  skipDuplicateIdentities: boolean;
  respectManualDisable: boolean;
  neverOverwriteAdminEdits: boolean;
  previewBeforeImport: boolean;
}

/** Used when no policy row exists yet — behaviour identical to pre-policy imports. */
export const FALLBACK_POLICY: PublishingPolicy = {
  id: "fallback",
  name: "Global Default",
  description: "Built-in fallback policy (publish everything valid).",
  enabled: true,
  isDefault: true,
  minCouponsPerStore: 0,
  maxCouponsPerStore: 0,
  minDealsPerStore: 0,
  maxDealsPerStore: 0,
  rankingPriority: RANKING_KEYS,
  fairDistribution: false,
  rotation: false,
  publishOnlyActive: true,
  skipExpired: true,
  skipDuplicateIdentities: true,
  respectManualDisable: true,
  neverOverwriteAdminEdits: true,
  previewBeforeImport: true,
};

export interface DistributionRow {
  storeKey: string;
  storeName: string;
  couponsPublished: number;
  couponsHeld: number;
  dealsPublished: number;
  dealsHeld: number;
}

export interface HoldReason {
  reason: string;
  count: number;
}

export interface PublishingSummary {
  policyId: string;
  policyName: string;
  /** False when the policy is disabled — the plan passed through untouched. */
  applied: boolean;
  couponsFetched: number;
  couponsPublished: number;
  couponsHeld: number;
  dealsFetched: number;
  dealsPublished: number;
  dealsHeld: number;
  storesCovered: number;
  averageCouponsPerStore: number;
  averageDealsPerStore: number;
  /** Published / fetched offers, as a percentage. */
  coveragePercent: number;
  holdReasons: HoldReason[];
  distribution: DistributionRow[];
  rules: {
    fairDistribution: boolean;
    rotation: boolean;
    publishOnlyActive: boolean;
    skipExpired: boolean;
    skipDuplicateIdentities: boolean;
    respectManualDisable: boolean;
    neverOverwriteAdminEdits: boolean;
    rankingPriority: RankingKey[];
    minCouponsPerStore: number;
    maxCouponsPerStore: number;
    minDealsPerStore: number;
    maxDealsPerStore: number;
  };
}

/** Everything the engine needs beyond the plan itself. Loaded by the caller. */
export interface PolicyContext {
  /** Rotation cursor per store key, from the previous run. */
  rotation?: Record<string, number>;
  /** Higher wins when ranking by merchant priority (e.g. featured stores). */
  merchantPriority?: Record<string, number>;
  /** Existing row ids an administrator disabled manually — never re-published. */
  manuallyDisabledIds?: string[];
  now?: Date;
}

export interface PolicyOutcome<TPlan> {
  plan: TPlan;
  summary: PublishingSummary;
  /** New rotation cursors to persist (run mode only). */
  rotationCursors: Record<string, number>;
}
