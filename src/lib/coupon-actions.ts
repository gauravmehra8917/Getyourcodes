/**
 * Canonical routing + action helpers for offers.
 * Every "Get" action anywhere on the site must go through these so behaviour
 * (tracking, affiliate redirect, code reveal) is identical everywhere.
 */
import { trackClick, type Coupon } from "@/lib/db";

/** Canonical store page slug (matches $slug route conventions). */
export function storeSlug(slug: string) {
  return slug.endsWith("-coupons") ? slug : `${slug}-coupons`;
}

/** Canonical category page slug. */
export function categorySlug(slug: string) {
  return slug.endsWith("-offers") ? slug : `${slug}-offers`;
}

/**
 * Canonical coupon activation.
 * Deals open the affiliate URL, codes resolve to the reveal modal (caller shows it).
 */
export async function activateCoupon(
  coupon: Pick<Coupon, "id" | "coupon_type" | "affiliate_url">,
): Promise<"opened" | "reveal"> {
  await trackClick(coupon.id, typeof window !== "undefined" ? window.location.pathname : "");
  if (coupon.coupon_type === "deal") {
    if (coupon.affiliate_url) window.open(coupon.affiliate_url, "_blank", "noopener,noreferrer");
    return "opened";
  }
  return "reveal";
}

const CONVERSATIONAL = [
  /\b(best|cheap|cheapest|recommend|suggest|compare|help|which|what|why|how|when|where|should|any|find me|show me|looking for|need)\b/i,
  /\b(under|below|less than|between)\s*\$?\d/i,
  /\b(this|next)\s+(week|month|weekend)\b/i,
  /\?$/,
];

/**
 * True when a query reads like a conversation/recommendation request rather than
 * a direct lookup of a store, brand, coupon or code.
 */
export function isConversationalQuery(q: string) {
  const t = q.trim();
  if (!t) return false;
  if (CONVERSATIONAL.some((re) => re.test(t))) return true;
  return t.split(/\s+/).length > 4;
}
