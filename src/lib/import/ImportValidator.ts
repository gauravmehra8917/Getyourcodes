// Stage 1 – validation of canonical entities. Never throws, never rejects a
// whole batch: invalid records are reported and excluded individually.

import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
} from "@/lib/normalizers";
import type { ImportEntityKind, ImportIssue } from "./ImportPlan";

const STATUSES = new Set(["active", "inactive", "expired", "pending", "unknown"]);

export interface ValidationOutcome<T> {
  valid: T[];
  errors: ImportIssue[];
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function issue(
  entity: ImportEntityKind,
  providerEntityId: string | null,
  reason: string,
  field?: string,
): ImportIssue {
  return { entity, providerEntityId, field, reason };
}

function checkCommon(
  entity: ImportEntityKind,
  id: string | null | undefined,
  status: string | undefined,
  errors: ImportIssue[],
): boolean {
  let ok = true;
  if (!id || !String(id).trim()) {
    errors.push(issue(entity, null, "missing provider entity id", "providerId"));
    ok = false;
  }
  if (status != null && !STATUSES.has(status)) {
    errors.push(issue(entity, id ?? null, `invalid status "${status}"`, "status"));
    ok = false;
  }
  return ok;
}

export const ImportValidator = {
  stores(items: CanonicalStore[]): ValidationOutcome<CanonicalStore> {
    const valid: CanonicalStore[] = [];
    const errors: ImportIssue[] = [];
    for (const s of items) {
      let ok = checkCommon("store", s.providerStoreId, s.status, errors);
      if (!s.name?.trim()) {
        errors.push(issue("store", s.providerStoreId ?? null, "empty name", "name"));
        ok = false;
      }
      if (s.website && !isUrl(s.website)) {
        errors.push(issue("store", s.providerStoreId ?? null, "invalid website url", "website"));
        ok = false;
      }
      if (s.logo && !isUrl(s.logo)) {
        errors.push(issue("store", s.providerStoreId ?? null, "invalid logo url", "logo"));
        ok = false;
      }
      if (ok) valid.push(s);
    }
    return { valid, errors };
  },

  categories(items: CanonicalCategory[]): ValidationOutcome<CanonicalCategory> {
    const valid: CanonicalCategory[] = [];
    const errors: ImportIssue[] = [];
    for (const c of items) {
      let ok = checkCommon("category", c.providerCategoryId, undefined, errors);
      if (!c.name?.trim()) {
        errors.push(issue("category", c.providerCategoryId ?? null, "empty name", "name"));
        ok = false;
      }
      if (ok) valid.push(c);
    }
    return { valid, errors };
  },

  coupons(items: CanonicalCoupon[]): ValidationOutcome<CanonicalCoupon> {
    const valid: CanonicalCoupon[] = [];
    const errors: ImportIssue[] = [];
    for (const c of items) {
      let ok = checkCommon("coupon", c.providerCouponId, c.status, errors);
      if (!c.title?.trim()) {
        errors.push(issue("coupon", c.providerCouponId ?? null, "empty title", "title"));
        ok = false;
      }
      if (!c.providerStoreId) {
        errors.push(issue("coupon", c.providerCouponId ?? null, "missing store reference", "providerStoreId"));
        ok = false;
      }
      if (!c.trackingUrl) {
        errors.push(issue("coupon", c.providerCouponId ?? null, "missing tracking url", "trackingUrl"));
        ok = false;
      } else if (!isUrl(c.trackingUrl)) {
        errors.push(issue("coupon", c.providerCouponId ?? null, "invalid tracking url", "trackingUrl"));
        ok = false;
      }
      for (const [field, value] of [["startDate", c.startDate], ["endDate", c.endDate]] as const) {
        if (value && !isDate(value)) {
          errors.push(issue("coupon", c.providerCouponId ?? null, `invalid ${field}`, field));
          ok = false;
        }
      }
      if (ok) valid.push(c);
    }
    return { valid, errors };
  },

  deals(items: CanonicalDeal[]): ValidationOutcome<CanonicalDeal> {
    const valid: CanonicalDeal[] = [];
    const errors: ImportIssue[] = [];
    for (const d of items) {
      let ok = checkCommon("deal", d.providerDealId, d.status, errors);
      if (!d.title?.trim()) {
        errors.push(issue("deal", d.providerDealId ?? null, "empty title", "title"));
        ok = false;
      }
      if (!d.providerStoreId) {
        errors.push(issue("deal", d.providerDealId ?? null, "missing store reference", "providerStoreId"));
        ok = false;
      }
      if (!d.trackingUrl) {
        errors.push(issue("deal", d.providerDealId ?? null, "missing tracking url", "trackingUrl"));
        ok = false;
      } else if (!isUrl(d.trackingUrl)) {
        errors.push(issue("deal", d.providerDealId ?? null, "invalid tracking url", "trackingUrl"));
        ok = false;
      }
      for (const [field, value] of [["startDate", d.startDate], ["endDate", d.endDate]] as const) {
        if (value && !isDate(value)) {
          errors.push(issue("deal", d.providerDealId ?? null, `invalid ${field}`, field));
          ok = false;
        }
      }
      if (ok) valid.push(d);
    }
    return { valid, errors };
  },
};
