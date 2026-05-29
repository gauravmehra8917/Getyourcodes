import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Sparkles, ShoppingBag, Utensils, Plane, Smartphone, Shirt, Home } from "lucide-react";
import { sb, type Store, type Coupon, type Category } from "@/lib/db";
import { StoreCard } from "@/components/store-card";
import { CouponCard } from "@/components/coupon-card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SaveHub — Verified coupons, promo codes & deals" },
      { name: "description", content: "Hand-picked coupons and deals from your favorite brands. Save more on fashion, food, electronics, travel and more." },
      { property: "og:title", content: "SaveHub — Verified coupons & deals" },
      { property: "og:description", content: "Save more on every order with verified promo codes." },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: HomePage,
});

const ICONS = [ShoppingBag, Utensils, Plane, Smartphone, Shirt, Home];

function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const featured = useQuery({
    queryKey: ["stores", "featured"],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("*").eq("featured", true).limit(12);
      return (data ?? []) as Store[];
    },
  });
  const trending = useQuery({
    queryKey: ["coupons", "trending"],
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active")
        .eq("coupon_type", "code")
        .order("created_at", { ascending: false })
        .limit(6);
      return (data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[];
    },
  });
  const latestDeals = useQuery({
    queryKey: ["coupons", "deals"],
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active")
        .eq("coupon_type", "deal")
        .order("created_at", { ascending: false })
        .limit(6);
      return (data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[];
    },
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("*").order("name");
      return (data ?? []) as Category[];
    },
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-soft via-background to-accent">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card px-4 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Updated daily · Verified codes
          </div>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-6xl">
            Save more on every order with{" "}
            <span className="bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent">verified coupons</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Promo codes and deals from thousands of brands — all in one clean, fast place.
          </p>
          <form
            className="mx-auto mt-10 max-w-2xl"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ to: "/search", search: { q: q.trim() } }); }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search Amazon, Nike, Uber Eats…"
                className="h-14 w-full rounded-full border border-border bg-card pl-14 pr-32 text-base shadow-sm outline-none focus:border-primary"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Search
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-20 px-4 py-16 sm:px-6">
        {/* Featured stores */}
        <Section title="Featured stores" subtitle="Top brands picked by our editors">
          {featured.data && featured.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {featured.data.map((s) => <StoreCard key={s.id} store={s} />)}
            </div>
          ) : <EmptyHint text="No featured stores yet. Add some from the admin dashboard." />}
        </Section>

        {/* Trending coupons */}
        <Section title="Trending coupon codes" subtitle="Most-used codes this week">
          {trending.data && trending.data.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {trending.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No active coupons yet." />}
        </Section>

        {/* Latest deals */}
        <Section title="Latest deals" subtitle="No code needed — just click and save">
          {latestDeals.data && latestDeals.data.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {latestDeals.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No deals yet." />}
        </Section>

        {/* Categories */}
        <Section title="Shop by category" subtitle="Browse offers across every category">
          {categories.data && categories.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {categories.data.map((c, i) => {
                const Icon = ICONS[i % ICONS.length];
                return (
                  <Link
                    key={c.id}
                    to="/$slug"
                    params={{ slug: `${c.slug}-offers` }}
                    className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-5 text-center transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">{c.name}</p>
                  </Link>
                );
              })}
            </div>
          ) : <EmptyHint text="No categories yet." />}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
