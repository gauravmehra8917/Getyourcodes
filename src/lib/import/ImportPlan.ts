// Provider-independent import plan. Always produced before any DB write.

import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
} from "@/lib/normalizers";

export type ImportEntityKind = "store" | "coupon" | "deal" | "category";
export type ImportAction = "create" | "update" | "skip";

export interface ImportIssue {
  entity: ImportEntityKind;
  providerEntityId: string | null;
  field?: string;
  reason: string;
}

export interface PlannedRecord<T> {
  entity: ImportEntityKind;
  action: Exclude<ImportAction, "skip">;
  providerEntityId: string;
  /** Existing internal row id when the action is an update. */
  existingId: string | null;
  /** Slug reserved for this record (stores and categories only). */
  slug: string | null;
  source: T;
}

export interface ImportPlan {
  provider: string;
  integrationId: string;
  createdAt: string;
  storesToCreate: PlannedRecord<CanonicalStore>[];
  storesToUpdate: PlannedRecord<CanonicalStore>[];
  couponsToCreate: PlannedRecord<CanonicalCoupon>[];
  couponsToUpdate: PlannedRecord<CanonicalCoupon>[];
  dealsToCreate: PlannedRecord<CanonicalDeal>[];
  dealsToUpdate: PlannedRecord<CanonicalDeal>[];
  categoriesToCreate: PlannedRecord<CanonicalCategory>[];
  categoriesToUpdate: PlannedRecord<CanonicalCategory>[];
  skipped: ImportIssue[];
  validationErrors: ImportIssue[];
  conflicts: ImportIssue[];
  warnings: ImportIssue[];
}

export function emptyPlan(provider: string, integrationId: string): ImportPlan {
  return {
    provider,
    integrationId,
    createdAt: new Date().toISOString(),
    storesToCreate: [],
    storesToUpdate: [],
    couponsToCreate: [],
    couponsToUpdate: [],
    dealsToCreate: [],
    dealsToUpdate: [],
    categoriesToCreate: [],
    categoriesToUpdate: [],
    skipped: [],
    validationErrors: [],
    conflicts: [],
    warnings: [],
  };
}

export function planTotals(plan: ImportPlan) {
  const creates =
    plan.storesToCreate.length +
    plan.couponsToCreate.length +
    plan.dealsToCreate.length +
    plan.categoriesToCreate.length;
  const updates =
    plan.storesToUpdate.length +
    plan.couponsToUpdate.length +
    plan.dealsToUpdate.length +
    plan.categoriesToUpdate.length;
  return { creates, updates };
}
