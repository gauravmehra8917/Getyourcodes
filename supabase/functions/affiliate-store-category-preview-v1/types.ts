import type {
  CategoryMappingFact,
  StoreCategoryFact,
} from "../_shared/affiliate-store-category-v1/planner.ts";
import type { ImpactAdsTransportV2 } from "../_shared/affiliate-sync-v2-ads/ads-diagnostics.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";

/** Only bounded read methods cross the host boundary. */
export interface CategoryPreviewDataSource {
  hasAdminRole(userId: string): Promise<boolean>;
  readIntegration(id: string): Promise<StoredIntegrationV2 | null>;
  readCredentialCiphertext(id: string): Promise<string | null>;
  readStores(): Promise<readonly StoreCategoryFact[]>;
  readCategoryIds(): Promise<readonly string[]>;
  readMappings(): Promise<readonly CategoryMappingFact[]>;
}

export interface CategoryPreviewDependencies {
  siteUrl: string | null;
  verifyUser(authorization: string, jwt: string): Promise<{ id: string } | null>;
  createDataSource(): CategoryPreviewDataSource;
  decryptCredentialEnvelope(ciphertext: string): Promise<string>;
  createImpactTransport(credentials: ImpactHostCredentialsV2, origin: string): ImpactAdsTransportV2;
}

export const CATEGORY_PREVIEW_VERSION = "p1c-a1-v1";
export const CATALOG_ROW_LIMIT = 10_000;
export const CAMPAIGN_RECORD_LIMIT = 1_000;
export const RESPONSE_BYTE_LIMIT = 2_000_000;
