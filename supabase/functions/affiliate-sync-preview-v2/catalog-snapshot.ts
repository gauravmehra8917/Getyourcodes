import type { ExistingCatalogSnapshotV2 } from "../_shared/affiliate-sync-v2/index.ts";
import type {
  CatalogOfferIdentityRowV2,
  CatalogSnapshotReaderV2,
  CatalogStoreIdentityRowV2,
} from "./types.ts";

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Maps only the persisted provider namespace. Incomplete rows are ignored;
 * presentation fields are intentionally not accepted by this boundary.
 */
export function mapExistingCatalogSnapshotV2(
  stores: readonly CatalogStoreIdentityRowV2[],
  offers: readonly CatalogOfferIdentityRowV2[],
): ExistingCatalogSnapshotV2 {
  return {
    stores: stores.flatMap((row) => {
      const id = nonEmptyText(row.id);
      const campaignId = nonEmptyText(row.providerEntityId);
      return id && campaignId
        ? [{
          id,
          providerStoreKey: {
            provider: "impact" as const,
            namespace: "campaign" as const,
            id: campaignId,
          },
        }]
        : [];
    }),
    offers: offers.flatMap((row) => {
      const id = nonEmptyText(row.id);
      const promotionId = nonEmptyText(row.providerEntityId);
      return id && promotionId ? [{ id, promotionId }] : [];
    }),
  };
}

export async function loadExistingCatalogSnapshotV2(
  reader: CatalogSnapshotReaderV2,
): Promise<ExistingCatalogSnapshotV2> {
  const [stores, offers] = await Promise.all([
    reader.readImpactStoreIdentityRows(),
    reader.readImpactOfferIdentityRows(),
  ]);
  return mapExistingCatalogSnapshotV2(stores, offers);
}
