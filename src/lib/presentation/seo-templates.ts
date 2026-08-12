// Deterministic SEO generation (Phase 3A). No AI, no randomness.
// Values produced here are only ever applied to EMPTY fields — administrator
// edits are preserved by the importer (see public.import_apply).

import { SITE_URL } from "@/lib/seo";
import { slugify } from "../../../supabase/functions/_shared/affiliate-sync-core/presentation/seo-preview";

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
} from "../../../supabase/functions/_shared/affiliate-sync-core/presentation/seo-preview";

export const storeCanonical = (storeSlug: string) => `${SITE_URL}/${storeSlug}-coupons`;

/** Coupons are rendered on their store page; the coupon slug is the fragment. */
export const couponCanonical = (storeSlug: string, couponTitle: string) =>
  `${SITE_URL}/${storeSlug}-coupons#${slugify(couponTitle)}`;
