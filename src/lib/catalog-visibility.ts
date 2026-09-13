/**
 * Public catalog visibility rules.
 *
 * Store rule:
 * A store is suppressed only when lifecycle automation manages it and
 * explicitly hid it. Manual/unmanaged rows retain their existing visibility.
 *
 * Offer rule:
 * A public offer must be active, within its UTC start/expiry date window,
 * and belong to a publicly visible parent store.
 */

export const PUBLIC_STORE_VISIBILITY_FILTER =
  "lifecycle_managed.is.null,lifecycle_managed.eq.false,lifecycle_hidden.is.null,lifecycle_hidden.eq.false";

export function isPublicStoreVisible(row: {
  lifecycle_managed?: boolean | null;
  lifecycle_hidden?: boolean | null;
}): boolean {
  return !(row.lifecycle_managed === true && row.lifecycle_hidden === true);
}

export function excludeLifecycleHiddenStores<T>(query: T): T {
  return (query as T & { or(filters: string): T }).or(
    PUBLIC_STORE_VISIBILITY_FILTER,
  );
}

/** Applies the same store rule to an inner `stores` relation on an offer query. */
export function excludeLifecycleHiddenStoreRelation<T>(query: T): T {
  return (
    query as T & {
      or(filters: string, options: { referencedTable: string }): T;
    }
  ).or(PUBLIC_STORE_VISIBILITY_FILTER, { referencedTable: "stores" });
}

/** Exact current UTC calendar date used for date-only database fields. */
export function currentUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function assertDateOnly(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("currentDate must be YYYY-MM-DD");
  }
}

/**
 * Restricts an offer query to the current date window.
 *
 * NULL boundaries are intentionally open-ended:
 * - no start date => already eligible to start
 * - no expiry date => no known expiry
 */
export function applyCurrentOfferWindow<T>(
  query: T,
  currentDate = currentUtcDate(),
): T {
  assertDateOnly(currentDate);

  type OrQuery = T & {
    or(filters: string): T;
  };

  const afterStart = (query as OrQuery).or(
    `start_date.is.null,start_date.lte.${currentDate}`,
  );

  return (afterStart as OrQuery).or(
    `expiry_date.is.null,expiry_date.gte.${currentDate}`,
  );
}

/**
 * Canonical public coupon/deal query guard.
 *
 * The supplied query must include an inner `stores` relation so the parent
 * store lifecycle rule can be applied safely.
 */
export function applyPublicOfferVisibility<T>(
  query: T,
  currentDate = currentUtcDate(),
): T {
  type EqQuery = T & {
    eq(column: string, value: string): T;
  };

  const active = (query as EqQuery).eq("status", "active");
  const current = applyCurrentOfferWindow(active, currentDate);

  return excludeLifecycleHiddenStoreRelation(current);
}

/**
 * Pure equivalent of the coupon-level portion of the public rule.
 * Useful where rows are already in memory rather than being queried.
 */
export function isCurrentlyValidOffer(
  row: {
    status: string | null;
    start_date?: string | null;
    expiry_date?: string | null;
  },
  currentDate = currentUtcDate(),
): boolean {
  assertDateOnly(currentDate);

  if (row.status !== "active") return false;

  if (row.start_date !== null && row.start_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.start_date)) return false;
    if (row.start_date > currentDate) return false;
  }

  if (row.expiry_date !== null && row.expiry_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date)) return false;
    if (row.expiry_date < currentDate) return false;
  }

  return true;
}
