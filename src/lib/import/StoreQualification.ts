import type { PlannedRecord } from "./ImportPlan";
import type { CanonicalCoupon, CanonicalDeal } from "@/lib/normalizers";
import type { PublishingPolicy } from "@/lib/publishing-policy";

export type QualificationReason = "qualified_coupon_threshold" | "qualified_deal_threshold" | "insufficient_publishable_offers";
export interface StoreQualification { storeKey: string; eligibleCoupons: number; eligibleDeals: number; selectedCoupons: number; selectedDeals: number; qualified: boolean; reason: QualificationReason; }
const key = (s: { providerAdvertiserId?: string | null; providerStoreId?: string | null; providerCampaignId?: string | null }) => s.providerAdvertiserId || s.providerStoreId || s.providerCampaignId || "__unassigned__";
export function qualifyStores(
  eligibleCoupons: PlannedRecord<CanonicalCoupon>[], eligibleDeals: PlannedRecord<CanonicalDeal>[],
  selectedCoupons: PlannedRecord<CanonicalCoupon>[], selectedDeals: PlannedRecord<CanonicalDeal>[], policy: PublishingPolicy,
): StoreQualification[] {
  const rows = new Map<string, StoreQualification>();
  const row = (storeKey: string) => rows.get(storeKey) ?? (rows.set(storeKey, { storeKey, eligibleCoupons: 0, eligibleDeals: 0, selectedCoupons: 0, selectedDeals: 0, qualified: false, reason: "insufficient_publishable_offers" }), rows.get(storeKey)!);
  for (const r of eligibleCoupons) row(key(r.source)).eligibleCoupons++;
  for (const r of eligibleDeals) row(key(r.source)).eligibleDeals++;
  for (const r of selectedCoupons) row(key(r.source)).selectedCoupons++;
  for (const r of selectedDeals) row(key(r.source)).selectedDeals++;
  for (const r of rows.values()) { r.qualified = r.eligibleCoupons >= policy.minCouponsPerStore || r.eligibleDeals >= policy.minDealsPerStore; r.reason = r.eligibleCoupons >= policy.minCouponsPerStore ? "qualified_coupon_threshold" : r.eligibleDeals >= policy.minDealsPerStore ? "qualified_deal_threshold" : "insufficient_publishable_offers"; }
  return [...rows.values()];
}
