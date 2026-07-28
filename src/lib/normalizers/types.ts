// Canonical, provider-independent models produced by the normalization layer.
// These are the only shapes the future Sync Engine (Phase 2D) consumes.

export type EntityKind = "store" | "coupon" | "deal" | "category";

export type CanonicalStatus = "active" | "inactive" | "expired" | "pending" | "unknown";

export type DiscountType = "percentage" | "fixed" | "free_shipping" | "bogo" | "other" | "unknown";

/** Anything the provider returned that has no canonical home. Never lossy. */
export type Metadata = Record<string, unknown>;

export interface CanonicalStore {
  provider: string;
  providerStoreId: string;
  /** Program/campaign identifier, when the provider distinguishes it. */
  providerCampaignId?: string | null;
  /** Advertiser/merchant identifier, when the provider distinguishes it. */
  providerAdvertiserId?: string | null;
  name: string;
  description: string | null;
  website: string | null;
  logo: string | null;
  categories: string[];
  country: string | null;
  status: CanonicalStatus;
  commission: string | null;
  metadata: Metadata;
}

export interface CanonicalCoupon {
  provider: string;
  providerCouponId: string;
  providerStoreId: string | null;
  /** Preferred store reference when the provider exposes advertiser ids. */
  providerAdvertiserId?: string | null;
  providerCampaignId?: string | null;
  title: string;
  description: string | null;
  code: string | null;
  discountType: DiscountType;
  discountValue: number | null;
  startDate: string | null;
  endDate: string | null;
  trackingUrl: string | null;
  terms: string | null;
  status: CanonicalStatus;
  metadata: Metadata;
}

export interface CanonicalDeal {
  provider: string;
  providerDealId: string;
  providerStoreId: string | null;
  providerAdvertiserId?: string | null;
  providerCampaignId?: string | null;
  title: string;
  description: string | null;
  trackingUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: CanonicalStatus;
  metadata: Metadata;
}

export interface CanonicalCategory {
  provider: string;
  providerCategoryId: string;
  name: string;
  parentId: string | null;
  metadata: Metadata;
}

export type CanonicalEntity =
  | CanonicalStore
  | CanonicalCoupon
  | CanonicalDeal
  | CanonicalCategory;

/** Per-record failure detail for bulk normalization. */
export interface NormalizationIssue {
  index: number;
  reason: string;
}

/** Body shape returned by every bulk normalizer call. */
export interface NormalizationBatch<T> {
  items: T[];
  received: number;
  normalized: number;
  skipped: number;
  issues: NormalizationIssue[];
  durationMs: number;
}

/** Mixed output of promotions normalization (coupons + deals). */
export interface PromotionSplit {
  coupons: CanonicalCoupon[];
  deals: CanonicalDeal[];
}
