import { queryOptions } from "@tanstack/react-query";
import { sb, type Category, type Coupon, type Store } from "@/lib/db";

export type StoreLite = Pick<Store, "id" | "name" | "slug" | "logo_url" | "category_id">;

/** One query for all active offers' owning store — reused to rank stores and categories. */
export const activeOfferCountsQuery = queryOptions({
  queryKey: ["active-offer-counts"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () => {
    const { data } = await sb
      .from("coupons")
      .select("store_id")
      .eq("status", "active")
      .limit(10000);
    const byStore: Record<string, number> = {};
    for (const row of (data ?? []) as { store_id: string | null }[]) {
      if (!row.store_id) continue;
      byStore[row.store_id] = (byStore[row.store_id] ?? 0) + 1;
    }
    return byStore;
  },
});

export const storesLiteQuery = queryOptions({
  queryKey: ["stores-lite"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () => {
    const { data } = await sb
      .from("stores")
      .select("id,name,slug,logo_url,category_id")
      .order("name")
      .limit(2000);
    return (data ?? []) as StoreLite[];
  },
});

export const categoriesQuery = queryOptions({
  queryKey: ["categories-all"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () => {
    const { data } = await sb.from("categories").select("id,name,slug").order("name").limit(500);
    return (data ?? []) as Category[];
  },
});

export function rankStores(stores: StoreLite[], counts: Record<string, number>) {
  return stores
    .map((s) => ({ ...s, offers: counts[s.id] ?? 0 }))
    .sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name));
}

export function rankCategories(
  categories: Category[],
  stores: StoreLite[],
  counts: Record<string, number>,
) {
  const byCategory: Record<string, number> = {};
  for (const s of stores) {
    if (!s.category_id) continue;
    byCategory[s.category_id] = (byCategory[s.category_id] ?? 0) + (counts[s.id] ?? 0);
  }
  return categories
    .map((c) => ({ ...c, offers: byCategory[c.id] ?? 0 }))
    .sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name));
}

export type CouponWithStore = Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> | null };

export function couponPageQuery(type: "code" | "deal", page: number, perPage = 24) {
  return queryOptions({
    queryKey: ["coupon-page", type, page, perPage],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const from = (page - 1) * perPage;
      const { data, count } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)", { count: "exact" })
        .eq("status", "active")
        .eq("coupon_type", type)
        .order("created_at", { ascending: false })
        .range(from, from + perPage - 1);
      return { rows: (data ?? []) as CouponWithStore[], total: count ?? 0 };
    },
  });
}

export const parsePage = (search: Record<string, unknown>) => ({
  page: Math.max(1, Math.floor(Number(search?.page) || 1)),
});
