import {
  isProviderManagedEntity,
  PROVIDER_MANAGED_DELETE_MESSAGE,
  type ProviderEntityIdentity,
} from "./admin-entity-ownership.ts";

type CatalogKind = "coupon" | "store" | "category";

function deleteErrorMessage(kind: CatalogKind, error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "23503") {
    if (kind === "category") {
      return "This category is still referenced by one or more stores or mappings and cannot be deleted.";
    }
    if (kind === "store") {
      return "This store is still referenced by coupons or other related records and cannot be deleted.";
    }
    return "This coupon is still referenced by related records and cannot be deleted.";
  }
  if (code === "42501") {
    return `You do not have permission to delete this ${kind}.`;
  }
  return `Could not delete this ${kind}. Please try again.`;
}

// Keep the guard and success-only refresh in the same controller used by all three list routes.
export async function deleteAdminCatalogRow({
  kind,
  row,
  pendingIds,
  confirmDelete,
  deleteRow,
  onBusyChange,
  onError,
  refresh,
}: {
  kind: CatalogKind;
  row: { id: string } & ProviderEntityIdentity;
  pendingIds: Set<string>;
  confirmDelete: () => boolean;
  deleteRow: () => PromiseLike<{ error: unknown }>;
  onBusyChange: () => void;
  onError: (message: string) => void;
  refresh: () => unknown | Promise<unknown>;
}): Promise<void> {
  if (kind !== "category" && isProviderManagedEntity(row)) {
    onError(PROVIDER_MANAGED_DELETE_MESSAGE);
    return;
  }
  if (pendingIds.has(row.id) || !confirmDelete()) return;

  // The synchronous set also blocks a second invocation before React has rendered the busy state.
  pendingIds.add(row.id);
  onBusyChange();
  let deleted = false;
  try {
    const { error } = await deleteRow();
    if (error) {
      onError(deleteErrorMessage(kind, error));
      return;
    }
    deleted = true;
    await refresh();
  } catch (error) {
    onError(
      deleted
        ? `The ${kind} was deleted, but the list could not be refreshed. Please retry loading the list.`
        : deleteErrorMessage(kind, error),
    );
  } finally {
    pendingIds.delete(row.id);
    onBusyChange();
  }
}
