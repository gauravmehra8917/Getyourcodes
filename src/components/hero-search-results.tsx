import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { sb, type Category, type Coupon, type Store } from "@/lib/db";
import { categorySlug } from "@/lib/coupon-actions";
import { CouponCard } from "@/components/coupon-card";
import { StoreCard } from "@/components/store-card";
import { excludeLifecycleHiddenStoreRelation, excludeLifecycleHiddenStores } from "@/lib/catalog-visibility";

type CouponWithStore = Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> };

export function useDirectSearch(term: string) {
  return useQuery({
    queryKey: ["hero-search", term],
    enabled: term.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const like = `%${term}%`;
      const [stores, coupons, categories] = await Promise.all([
        excludeLifecycleHiddenStores(sb.from("stores").select("*")).ilike("name", like).limit(6),
        excludeLifecycleHiddenStoreRelation(sb
          .from("coupons")
          .select("*, stores!inner(name, slug, logo_url)"))
          .eq("status", "active")
          .or(`title.ilike.${like},coupon_code.ilike.${like}`)
          .limit(6),
        sb.from("categories").select("*").ilike("name", like).limit(6),
      ]);
      return {
        stores: (stores.data ?? []) as Store[],
        coupons: (coupons.data ?? []) as CouponWithStore[],
        categories: (categories.data ?? []) as Category[],
      };
    },
  });
}

type Props = {
  term: string;
  onAskDealio: () => void;
  onClear: () => void;
};

export function HeroSearchResults({ term, onAskDealio, onClear }: Props) {
  const { data, isLoading } = useDirectSearch(term);

  if (!term) return null;

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Searching offers for “{term}”…
      </div>
    );
  }

  const total = (data?.stores.length ?? 0) + (data?.coupons.length ?? 0) + (data?.categories.length ?? 0);

  if (total === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">No direct matches for “{term}”.</p>
        <button
          type="button"
          onClick={onAskDealio}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-hover"
        >
          <Sparkles className="h-4 w-4 text-glow" /> Ask Dealio instead
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6 rounded-3xl border border-border bg-card p-5 text-left sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} result{total === 1 ? "" : "s"} for <span className="font-semibold text-foreground">“{term}”</span>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onAskDealio} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            Ask Dealio
          </button>
          <button type="button" onClick={onClear} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      </div>

      {data!.stores.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Stores</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data!.stores.map((s) => <StoreCard key={s.id} store={s} />)}
          </div>
        </section>
      )}

      {data!.categories.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Categories</h3>
          <div className="flex flex-wrap gap-2">
            {data!.categories.map((c) => (
              <Link
                key={c.id}
                to="/$slug"
                params={{ slug: categorySlug(c.slug) }}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {data!.coupons.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Coupons & deals</h3>
          <div className="grid gap-3">
            {data!.coupons.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
          </div>
        </section>
      )}
    </div>
  );
}
