export type ProviderEntityIdentity = {
  provider?: unknown;
  provider_entity_namespace?: unknown;
  provider_entity_id?: unknown;
};

export const PROVIDER_MANAGED_DELETE_MESSAGE =
  "Provider-managed records cannot be deleted manually. Use provider lifecycle/import controls instead.";

export function isProviderManagedEntity<T extends ProviderEntityIdentity>(row: T): boolean {
  return [row.provider, row.provider_entity_namespace, row.provider_entity_id].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}
