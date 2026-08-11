// Preview-only identity accounting for normalized offers. This is deliberately
// independent of planning and publishing so it cannot affect import behavior.

import type { CanonicalCoupon, CanonicalDeal } from "@/lib/normalizers";

export const UNASSIGNED_STORE_KEY = "**unassigned**";

type NormalizedOffer = CanonicalCoupon | CanonicalDeal;

export interface IdentityDiagnosticStoreKey {
  effectiveStoreKey: string;
  coupons: number;
  deals: number;
  merchantNames: string[];
}

export interface IdentityDiagnosticOfferSample {
  offerTitle: string;
  merchantName: string | null;
  providerEntityId: string;
  providerAdvertiserId: string | null;
  providerStoreId: string | null;
  providerCampaignId: string | null;
  effectiveStoreKey: string;
}

export interface IdentityDiagnostics {
  totalNormalizedCoupons: number;
  totalNormalizedDeals: number;
  uniqueProviderAdvertiserIds: number;
  uniqueProviderStoreIds: number;
  uniqueProviderCampaignIds: number;
  uniqueEffectiveStoreKeys: number;
  offersResolvingToUnassigned: number;
  topStoreKeys: IdentityDiagnosticStoreKey[];
  sampleOffers: IdentityDiagnosticOfferSample[];
}

type StoreKeyAggregate = IdentityDiagnosticStoreKey & { nameKeys: Set<string> };

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

/** Matches the current qualification precedence exactly. */
export function effectiveStoreKey(offer: NormalizedOffer): string {
  return (
    nonEmpty(offer.providerAdvertiserId) ??
    nonEmpty(offer.providerStoreId) ??
    nonEmpty(offer.providerCampaignId) ??
    UNASSIGNED_STORE_KEY
  );
}

function merchantName(offer: NormalizedOffer): string | null {
  const metadata = offer.metadata ?? {};
  for (const key of [
    "advertiserName",
    "AdvertiserName",
    "campaignName",
    "CampaignName",
    "merchantName",
    "MerchantName",
    "storeName",
    "StoreName",
  ]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sampleFor(offer: NormalizedOffer): IdentityDiagnosticOfferSample {
  return {
    offerTitle: offer.title,
    merchantName: merchantName(offer),
    providerEntityId: "providerCouponId" in offer ? offer.providerCouponId : offer.providerDealId,
    providerAdvertiserId: nonEmpty(offer.providerAdvertiserId),
    providerStoreId: nonEmpty(offer.providerStoreId),
    providerCampaignId: nonEmpty(offer.providerCampaignId),
    effectiveStoreKey: effectiveStoreKey(offer),
  };
}

/**
 * Builds a bounded, read-only view of the normalized offers immediately before
 * publishing policy is evaluated. It intentionally does not deduplicate or
 * otherwise transform the collections it reports on.
 */
export function buildIdentityDiagnostics(
  coupons: CanonicalCoupon[],
  deals: CanonicalDeal[],
): IdentityDiagnostics {
  const advertisers = new Set<string>();
  const stores = new Set<string>();
  const campaigns = new Set<string>();
  const byStoreKey = new Map<string, StoreKeyAggregate>();
  let offersResolvingToUnassigned = 0;

  const add = (offer: NormalizedOffer, entity: "coupon" | "deal") => {
    const advertiserId = nonEmpty(offer.providerAdvertiserId);
    const storeId = nonEmpty(offer.providerStoreId);
    const campaignId = nonEmpty(offer.providerCampaignId);
    if (advertiserId) advertisers.add(advertiserId);
    if (storeId) stores.add(storeId);
    if (campaignId) campaigns.add(campaignId);

    const key = effectiveStoreKey(offer);
    if (key === UNASSIGNED_STORE_KEY) offersResolvingToUnassigned += 1;
    let aggregate = byStoreKey.get(key);
    if (!aggregate) {
      aggregate = { effectiveStoreKey: key, coupons: 0, deals: 0, merchantNames: [], nameKeys: new Set() };
      byStoreKey.set(key, aggregate);
    }
    aggregate[entity === "coupon" ? "coupons" : "deals"] += 1;

    const name = merchantName(offer);
    if (name && aggregate.merchantNames.length < 3) {
      const nameKey = name.toLocaleLowerCase();
      if (!aggregate.nameKeys.has(nameKey)) {
        aggregate.nameKeys.add(nameKey);
        aggregate.merchantNames.push(name);
      }
    }
  };

  coupons.forEach((offer) => add(offer, "coupon"));
  deals.forEach((offer) => add(offer, "deal"));

  return {
    totalNormalizedCoupons: coupons.length,
    totalNormalizedDeals: deals.length,
    uniqueProviderAdvertiserIds: advertisers.size,
    uniqueProviderStoreIds: stores.size,
    uniqueProviderCampaignIds: campaigns.size,
    uniqueEffectiveStoreKeys: byStoreKey.size,
    offersResolvingToUnassigned,
    topStoreKeys: [...byStoreKey.values()]
      .sort((a, b) => b.coupons + b.deals - (a.coupons + a.deals) || a.effectiveStoreKey.localeCompare(b.effectiveStoreKey))
      .slice(0, 20)
      .map(({ nameKeys: _nameKeys, ...aggregate }) => aggregate),
    sampleOffers: [...coupons, ...deals].slice(0, 10).map(sampleFor),
  };
}
