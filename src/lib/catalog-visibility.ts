/**
 * Public catalog visibility rule. A store is suppressed only when lifecycle
 * automation manages it and explicitly hid it; manual/unmanaged rows retain
 * their existing visibility regardless of lifecycle defaults.
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
  return (query as T & { or(filters: string): T }).or(PUBLIC_STORE_VISIBILITY_FILTER);
}

/** Applies the same rule to an inner `stores` relation on an offer query. */
export function excludeLifecycleHiddenStoreRelation<T>(query: T): T {
  return (query as T & {
    or(filters: string, options: { referencedTable: string }): T;
  }).or(PUBLIC_STORE_VISIBILITY_FILTER, { referencedTable: "stores" });
}
