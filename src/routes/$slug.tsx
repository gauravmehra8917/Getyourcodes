import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { sb, type Store, type Coupon, type Category } from "@/lib/db";
import { CouponCard } from "@/components/coupon-card";
import { StoreCard } from "@/components/store-card";

type LoaderData =
  | { kind: "store"; store: Store; coupons: Coupon[] }
  | { kind: "category"; category: Category };

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }): Promise<LoaderData> => {
    const slug = params.slug;
    if (slug.endsWith("-coupons")) {
      const storeSlug = slug.slice(0, -"-coupons".length);
      const { data: store } = await sb.from("stores").select("*").eq("slug", storeSlug).maybeSingle();
      if (!store) throw notFound();
      const { data: coupons } = await sb
        .from("coupons").select("*").eq("store_id", store.id).eq("status", "active").order("created_at", { ascending: false });
      return { kind: "store", store: store as Store, coupons: (coupons ?? []) as Coupon[] };
    }
    if (slug.endsWith("-offers")) {
      const catSlug = slug.slice(0, -"-offers".length);
      const { data: category } = await sb.from("categories").select("*").eq("slug", catSlug).maybeSingle();
      if (!category) throw notFound();
      return { kind: "category", category: category as Category };
    }
    throw notFound();
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [] };
    if (loaderData.kind === "store") {
      const s = loaderData.store;
      const title = `${s.name} Coupons & Promo Codes — SaveHub`;
      const desc = `Verified ${s.name} coupon codes and deals. ${s.description ?? "Save more on every order."}`.slice(0, 160);
      return {
        meta: [
          { title }, { name: "description", content: desc },
          { property: "og:title", content: title }, { property: "og:description", content: desc },
          { property: "og:url", content: `/${s.slug}-coupons` },
        ],
        links: [{ rel: "canonical", href: `/${s.slug}-coupons` }],
      };
    }
    const c = loaderData.category;
    const title = `${c.name} Offers & Discounts — SaveHub`;
    const desc = `Top ${c.name} coupons, promo codes and deals updated daily.`;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:url", content: `/${c.slug}-offers` },
      ],
      links: [{ rel: "canonical", href: `/${c.slug}-offers` }],
    };
  },
  component: SlugPage,
  notFoundComponent: () => (
    <div className="py-24 text-center">
      <h1 className="font-display text-3xl font-bold">Not found</h1>
      <p className="mt-2 text-muted-foreground">This store or category doesn't exist.</p>
      <Link to="/" className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Back home</Link>
    </div>
  ),
});

function SlugPage() {
  const data = Route.useLoaderData();
  if (data.kind === "store") return <StorePage store={data.store} coupons={data.coupons} />;
  return <CategoryPage category={data.category} />;
}

function StorePage({ store, coupons }: { store: Store; coupons: Coupon[] }) {
  const codes = coupons.filter((c) => c.coupon_type === "code");
  const deals = coupons.filter((c) => c.coupon_type === "deal");
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="flex flex-col items-start gap-5 rounded-3xl border border-border bg-gradient-to-br from-primary-soft to-accent/40 p-6 sm:flex-row sm:items-center sm:p-8">
        {store.logo_url ? (
          <img src={store.logo_url} alt={`${store.name} logo`} className="h-20 w-20 rounded-2xl border border-border bg-card object-contain p-2" />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-card text-primary"><Tag className="h-8 w-8" /></div>
        )}
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{store.name} Coupons & Promo Codes</h1>
          {store.description && <p className="mt-2 max-w-2xl text-muted-foreground">{store.description}</p>}
          <p className="mt-2 text-sm text-muted-foreground">{coupons.length} active offers</p>
        </div>
      </header>

      {codes.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-bold">Active coupon codes</h2>
          <div className="grid gap-3">{codes.map((c) => <CouponCard key={c.id} coupon={c} store={store} />)}</div>
        </section>
      )}
      {deals.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-bold">Deals</h2>
          <div className="grid gap-3">{deals.map((c) => <CouponCard key={c.id} coupon={c} store={store} />)}</div>
        </section>
      )}
      {coupons.length === 0 && (
        <p className="mt-10 rounded-2xl border border-dashed border-border bg-secondary/30 p-10 text-center text-muted-foreground">No active offers right now. Check back soon!</p>
      )}
    </div>
  );
}

function CategoryPage({ category }: { category: Category }) {
  const stores = useQuery({
    queryKey: ["category-stores", category.id],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("*").eq("category_id", category.id);
      return (data ?? []) as Store[];
    },
  });
  const coupons = useQuery({
    queryKey: ["category-coupons", category.id],
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("*, stores!inner(id, name, slug, logo_url, category_id)")
        .eq("status", "active")
        .eq("stores.category_id", category.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[];
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="rounded-3xl border border-border bg-gradient-to-br from-primary-soft to-accent/40 p-8">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">Category</p>
        <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">{category.name} Offers</h1>
        <p className="mt-2 text-muted-foreground">Top {category.name.toLowerCase()} coupons and deals updated daily.</p>
      </header>

      {stores.data && stores.data.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-bold">Stores in {category.name}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {stores.data.map((s) => <StoreCard key={s.id} store={s} />)}
          </div>
        </section>
      )}

      {coupons.data && coupons.data.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-bold">Latest offers</h2>
          <div className="grid gap-3">{coupons.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}</div>
        </section>
      )}

      {(!stores.data?.length && !coupons.data?.length) && (
        <p className="mt-10 rounded-2xl border border-dashed border-border bg-secondary/30 p-10 text-center text-muted-foreground">No offers yet in this category.</p>
      )}
    </div>
  );
}
