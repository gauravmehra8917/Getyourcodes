import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { z } from "zod";
import { sb, trackSearch, type Store, type Coupon, type Category } from "@/lib/db";
import { StoreCard } from "@/components/store-card";
import { CouponCard } from "@/components/coupon-card";

export const Route = createFileRoute("/search")({
  validateSearch: z.object({ q: z.string().optional().default("") }),
  head: () => ({
    meta: [
      { title: "Search coupons & stores — SaveHub" },
      { name: "description", content: "Search verified coupons, stores and categories on SaveHub." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q: initialQ } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState(initialQ);

  const results = useQuery({
    queryKey: ["search", initialQ],
    enabled: initialQ.length > 0,
    queryFn: async () => {
      const term = `%${initialQ}%`;
      const [stores, coupons, categories] = await Promise.all([
        sb.from("stores").select("*").ilike("name", term).limit(12),
        sb.from("coupons").select("*, stores(name, slug, logo_url)").eq("status", "active").ilike("title", term).limit(12),
        sb.from("categories").select("*").ilike("name", term).limit(12),
      ]);
      return {
        stores: (stores.data ?? []) as Store[],
        coupons: (coupons.data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[],
        categories: (categories.data ?? []) as Category[],
      };
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Search</h1>
      <form
        className="mt-6"
        onSubmit={(e) => { e.preventDefault(); navigate({ search: { q: q.trim() } }); }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stores, coupons, categories…"
            className="h-12 w-full rounded-full border border-border bg-card pl-12 pr-4 outline-none focus:border-primary"
          />
        </div>
      </form>

      {!initialQ && <p className="mt-10 text-center text-muted-foreground">Start typing to search.</p>}
      {initialQ && results.isLoading && <p className="mt-10 text-center text-muted-foreground">Searching…</p>}

      {results.data && (
        <div className="mt-10 space-y-10">
          {results.data.stores.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-semibold">Stores</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {results.data.stores.map((s) => <StoreCard key={s.id} store={s} />)}
              </div>
            </section>
          )}
          {results.data.categories.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-semibold">Categories</h2>
              <div className="flex flex-wrap gap-2">
                {results.data.categories.map((c) => (
                  <Link key={c.id} to="/$slug" params={{ slug: `${c.slug}-offers` }} className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:border-primary">
                    {c.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {results.data.coupons.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-semibold">Coupons</h2>
              <div className="grid gap-3">
                {results.data.coupons.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
              </div>
            </section>
          )}
          {results.data.stores.length + results.data.coupons.length + results.data.categories.length === 0 && (
            <p className="text-center text-muted-foreground">No results for "{initialQ}".</p>
          )}
        </div>
      )}
    </div>
  );
}
