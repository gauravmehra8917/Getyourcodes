// Deterministic SEO generation (Phase 3A). No AI, no randomness.
// Values produced here are only ever applied to EMPTY fields — administrator
// edits are preserved by the importer (see public.import_apply).

import { SITE_URL } from "@/lib/seo";

export const SEO_BRAND = "GetYourCodes";

export const currentYear = () => new Date().getFullYear();

export function slugify(value: string): string {
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

export const storeSeoTitle = (storeName: string, year = currentYear()) =>
  `${storeName} Coupons, Promo Codes & Deals ${year} | ${SEO_BRAND}`;

export const storeSeoDescription = (storeName: string) =>
  `Save more with verified ${storeName} coupons, promo codes and exclusive deals updated regularly on ${SEO_BRAND}.`;

export const couponSeoTitle = (couponTitle: string, storeName: string, year = currentYear()) =>
  `${couponTitle} | ${storeName} Coupons ${year} | ${SEO_BRAND}`;

export const couponSeoDescription = (couponTitle: string, storeName: string) =>
  `Save with ${storeName} using this verified offer: ${couponTitle}. Updated regularly on ${SEO_BRAND}.`;

export const storeCanonical = (storeSlug: string) => `${SITE_URL}/${storeSlug}-coupons`;

/** Coupons are rendered on their store page; the coupon slug is the fragment. */
export const couponCanonical = (storeSlug: string, couponTitle: string) =>
  `${SITE_URL}/${storeSlug}-coupons#${slugify(couponTitle)}`;

/** Open Graph reuses the generated SEO title / description verbatim. */
export const ogTitle = (seoTitle: string) => seoTitle;
export const ogDescription = (seoDescription: string) => seoDescription;
