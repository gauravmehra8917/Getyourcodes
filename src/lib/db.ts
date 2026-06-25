import { supabase } from "@/integrations/supabase/client";

export type Store = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  affiliate_url: string | null;
  featured: boolean;
  category_id: string | null;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
};

export type CouponType = "code" | "deal";
export type CouponStatus = "active" | "expired" | "draft";

export type Coupon = {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  coupon_code: string | null;
  coupon_type: CouponType;
  affiliate_url: string | null;
  expiry_date: string | null;
  status: CouponStatus;
  terms: string | null;
  created_at: string;
  featured_in_banner: boolean;
};

// Untyped accessor (types.ts is auto-generated and currently empty)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sb = supabase as any;

export async function trackClick(couponId: string, sourcePage: string) {
  try {
    const { data } = await supabase.auth.getUser();
    await sb.from("coupon_clicks").insert({
      coupon_id: couponId,
      source_page: sourcePage,
      user_id: data.user?.id ?? null,
    });
  } catch {
    /* ignore */
  }
}

export async function trackSearch(query: string, source: "search" | "ai" = "search") {
  const q = query.trim();
  if (!q) return;
  try {
    const { data } = await supabase.auth.getUser();
    await sb.from("search_queries").insert({
      query: q.slice(0, 200),
      source,
      user_id: data.user?.id ?? null,
    });
  } catch {
    /* ignore */
  }
}
