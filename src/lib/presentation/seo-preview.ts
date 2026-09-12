// Pure SEO helpers used by import-preview presentation. Canonical URL helpers
// remain source-side because they depend on the application SITE_URL.

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

export const ogTitle = (seoTitle: string) => seoTitle;
export const ogDescription = (seoDescription: string) => seoDescription;
