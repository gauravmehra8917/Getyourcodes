// Deterministic SEO generation (Phase 3A). No AI, no randomness.
// Deterministic catalog SEO helpers. Administrator-authored values remain
// authoritative in catalog write paths.

import { SITE_URL } from "@/lib/seo";
import { slugify } from "./seo-preview";

export {
  SEO_BRAND,
  currentYear,
  slugify,
  storeSeoTitle,
  storeSeoDescription,
  couponSeoTitle,
  couponSeoDescription,
  ogTitle,
  ogDescription,
} from "./seo-preview";

export const storeCanonical = (storeSlug: string) => `${SITE_URL}/${storeSlug}-coupons`;

/** Coupons are rendered on their store page; the coupon slug is the fragment. */
export const couponCanonical = (storeSlug: string, couponTitle: string) =>
  `${SITE_URL}/${storeSlug}-coupons#${slugify(couponTitle)}`;
