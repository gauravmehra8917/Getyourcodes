import { evaluationYearV2 } from "./dates.ts";

export const SEO_BRAND_V2 = "GetYourCodes";

/** Exact established store-slug candidate formula. */
export function storeSlugCandidateV2(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "item";
}

/** Exact established coupon-fragment formula; intentionally differs from store slugs. */
export function couponAnchorSlugV2(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

export function storeSeoTitleV2(
  storeName: string,
  evaluationTimestamp: string,
): string {
  return `${storeName} Coupons, Promo Codes & Deals ${
    evaluationYearV2(evaluationTimestamp)
  } | ${SEO_BRAND_V2}`;
}

export function storeSeoDescriptionV2(storeName: string): string {
  return `Save more with verified ${storeName} coupons, promo codes and exclusive deals updated regularly on ${SEO_BRAND_V2}.`;
}

export function couponSeoTitleV2(
  couponTitle: string,
  storeName: string,
  evaluationTimestamp: string,
): string {
  return `${couponTitle} | ${storeName} Coupons ${
    evaluationYearV2(evaluationTimestamp)
  } | ${SEO_BRAND_V2}`;
}

export function couponSeoDescriptionV2(
  couponTitle: string,
  storeName: string,
): string {
  return `Save with ${storeName} using this verified offer: ${couponTitle}. Updated regularly on ${SEO_BRAND_V2}.`;
}

export function ogTitleV2(seoTitle: string): string {
  return seoTitle;
}

export function ogDescriptionV2(seoDescription: string): string {
  return seoDescription;
}

/** Reduces trusted SITE_URL configuration to an exact HTTP(S) origin. */
export function normalizeSiteOriginV2(value: string | null): string | null {
  if (value === null || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin === "null"
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function requiredSiteOrigin(value: string): string {
  const origin = normalizeSiteOriginV2(value);
  if (origin === null) {
    throw new TypeError("siteOrigin must resolve to an HTTP(S) origin");
  }
  return origin;
}

export function storeCanonicalV2(
  siteOrigin: string,
  storeSlug: string,
): string {
  return `${requiredSiteOrigin(siteOrigin)}/${storeSlug}-coupons`;
}

export function couponCanonicalV2(
  siteOrigin: string,
  storeSlug: string,
  couponTitle: string,
): string {
  return `${storeCanonicalV2(siteOrigin, storeSlug)}#${
    couponAnchorSlugV2(couponTitle)
  }`;
}
