// Provider-agnostic output of a sync run. Consumed unchanged by the future
// Import Pipeline (Phase 2D.2). No persistence, no validation.

import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
} from "@/lib/normalizers";
import type { SyncEntityType } from "./SyncOptions";
import type { SyncProgress } from "./SyncProgress";
import type { SyncStatistics } from "./SyncStatistics";

export interface SyncIssue {
  entity: SyncEntityType | null;
  page: number | null;
  stage: "fetch" | "normalize" | "engine";
  message: string;
}

export interface SyncResult {
  provider: string;
  integrationId: string;
  startedAt: string;
  finishedAt: string;
  entityTypes: SyncEntityType[];
  stores: CanonicalStore[];
  coupons: CanonicalCoupon[];
  deals: CanonicalDeal[];
  categories: CanonicalCategory[];
  statistics: SyncStatistics | null;
  progress: SyncProgress;
  warnings: SyncIssue[];
  errors: SyncIssue[];
}
