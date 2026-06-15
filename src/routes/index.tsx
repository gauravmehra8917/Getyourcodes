import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Search, Sparkles, ShoppingBag, Utensils, Plane, Smartphone, Shirt, Home,
  Store as StoreIcon, LayoutGrid, CalendarDays, Zap, Plus, ArrowRight, Tag,
} from "lucide-react";
import { sb, type Store, type Coupon, type Category } from "@/lib/db";
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
        .limit(8);
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

  const heroDeal = latestDeals.data?.[0];
  const sideDeal = latestDeals.data?.[1];
  const popularOffers = latestDeals.data?.slice(2, 10) ?? [];
  const brandTabs = featured.data?.slice(0, 8) ?? [];

  return (
    <div className="bg-secondary/30">
      {/* Top promo strip */}
      <div className="border-b border-border bg-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2 text-center text-xs text-background sm:px-6">
          <span className="hidden rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground sm:inline-block">New</span>
          <span className="opacity-90">Up to $100 OFF on Travel Bookings with SaveHub Rewards</span>
          <Link to="/search" search={{ q: "travel" }} className="rounded-full bg-primary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground hover:opacity-90">
            Apply now
          </Link>
        </div>
      </div>

      {/* Secondary nav */}
      <nav className="border-b border-border bg-background">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-6 px-4 text-sm sm:px-6">
          <div className="flex items-center gap-6 overflow-x-auto">
            <NavLink icon={StoreIcon} label="Stores" to="/search" search={{ q: "" }} />
            <NavLink icon={LayoutGrid} label="Categories" to="/search" search={{ q: "" }} />
            <NavLink icon={CalendarDays} label="Seasonal Sales" to="/search" search={{ q: "sale" }} />
          </div>
          <div className="flex items-center gap-5">
            <Link to="/contact" className="hidden text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground sm:inline-flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Submit Coupon
            </Link>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <Link to="/search" search={{ q: "" }} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <Zap className="h-3.5 w-3.5 fill-current" /> Deals of the Day
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Featured promo */}
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:col-span-2">
            <div className="grid items-stretch md:grid-cols-2">
              <div className="flex flex-col justify-center gap-5 p-8 sm:p-12">
                {heroDeal?.stores?.logo_url ? (
                  <img src={heroDeal.stores.logo_url} alt={`${heroDeal.stores.name} logo`} width={140} height={40} className="h-10 w-auto object-contain object-left" />
                ) : (
                  <div className="inline-flex items-center gap-2 text-xl font-bold">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Tag className="h-5 w-5" /></span>
                    SaveHub Picks
                  </div>
                )}
                <span className="w-fit rounded-lg border border-success-soft bg-success-soft px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-success">
                  Editor's choice
                </span>
                <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
                  {heroDeal?.title ?? "Save more on every order"}
                  {heroDeal?.description && (
                    <span className="mt-1 block bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent">
                      {heroDeal.description.slice(0, 60)}
                    </span>
                  )}
                </h1>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  {heroDeal?.coupon_code ? (
                    <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft px-5 py-3">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Use code</span>
                      <span className="font-mono text-lg font-bold text-primary">{heroDeal.coupon_code}</span>
                    </div>
                  ) : null}
                  <Link
                    to={heroDeal?.stores ? "/$slug" : "/search"}
                    {...(heroDeal?.stores
                      ? { params: { slug: `${heroDeal.stores.slug}-coupons` } }
                      : { search: { q: "" } })}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:opacity-90"
                  >
                    {heroDeal ? "Grab now" : "Explore deals"} <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              <div className="relative hidden bg-gradient-to-br from-primary-soft via-accent to-background md:block">
                <div className="absolute inset-0 grid place-items-center p-10">
                  {heroDeal?.stores?.logo_url ? (
                    <div className="rotate-3 rounded-3xl border border-border bg-card p-6 shadow-2xl transition-transform hover:rotate-0">
                      <img src={heroDeal.stores.logo_url} alt="" width={200} height={200} className="h-40 w-40 object-contain" />
                    </div>
                  ) : (
                    <Sparkles className="h-32 w-32 text-primary/30" />
                  )}
                </div>
              </div>
            </div>

            {/* Brand tabs */}
            {brandTabs.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto border-t border-border bg-secondary/40 px-4 py-3 sm:px-6">
                {brandTabs.map((s, i) => (
                  <Link
                    key={s.id}
                    to="/$slug"
                    params={{ slug: `${s.slug}-coupons` }}
                    className={`whitespace-nowrap rounded-full border px-5 py-2 text-xs font-bold transition ${
                      i === 0
                        ? "border-primary bg-card text-primary"
                        : "border-transparent bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Side deal card */}
          <SideDeal deal={sideDeal} />
        </div>

        {/* Marketplace label */}
        <div className="my-14 flex items-center justify-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground">
              Leading Coupons &amp; Deals Marketplace
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="h-px flex-1 bg-border" />
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-20 px-4 pb-20 sm:px-6">
        {/* Hero search */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ to: "/search", search: { q: q.trim() } }); }}
          className="mx-auto max-w-2xl"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search brands, categories or coupons…"
              className="h-14 w-full rounded-full border border-border bg-card pl-14 pr-32 text-base shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Search
            </button>
          </div>
        </form>

        {/* Popular offers of the day */}
        <Section title="Popular Offers of the Day" subtitle="Hand-picked deals from top brands" link={{ to: "/search", label: "See all deals" }}>
          {popularOffers.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {popularOffers.map((c) => <OfferCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No deals yet." />}
        </Section>

        {/* Top stores */}
        <Section title="Top stores" subtitle="Shop your favorite brands">
          {featured.data && featured.data.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {featured.data.map((s) => (
                <Link
                  key={s.id}
                  to="/$slug"
                  params={{ slug: `${s.slug}-coupons` }}
                  className="group grid aspect-square place-items-center rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  {s.logo_url ? (
                    <img src={s.logo_url} alt={`${s.name} logo`} width={64} height={64} loading="lazy" decoding="async" className="max-h-12 max-w-full object-contain transition group-hover:scale-105" />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground">{s.name}</span>
                  )}
                </Link>
              ))}
            </div>
          ) : <EmptyHint text="No featured stores yet." />}
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
                    className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                  </Link>
                );
              })}
            </div>
          ) : <EmptyHint text="No categories yet." />}
        </Section>

        {/* Trending coupons */}
        <Section title="Trending coupon codes" subtitle="Most-used codes this week">
          {trending.data && trending.data.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {trending.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No active coupons yet." />}
        </Section>
      </div>
    </div>
  );
}

function NavLink({ icon: Icon, label, to, search }: { icon: typeof StoreIcon; label: string; to: string; search?: { q: string } }) {
  return (
    <Link
      to={to}
      {...(search ? { search } : {})}
      className="flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition hover:text-primary"
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function SideDeal({ deal }: { deal?: Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> } }) {
  if (!deal) {
    return (
      <div className="grid place-items-center rounded-3xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        <Sparkles className="mb-3 h-8 w-8 text-primary/40" />
        More deals coming soon
      </div>
    );
  }
  return (
    <Link
      to="/$slug"
      params={{ slug: `${deal.stores.slug}-coupons` }}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-foreground text-background shadow-sm"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-foreground to-foreground" />
      <div className="relative flex h-full flex-col justify-end gap-3 p-8">
        {deal.stores.logo_url && (
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-background p-2 shadow-xl">
            <img src={deal.stores.logo_url} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          </div>
        )}
        <h3 className="font-display text-3xl font-bold leading-tight tracking-tight">{deal.title}</h3>
        {deal.description && <p className="text-sm text-background/70 line-clamp-2">{deal.description}</p>}
        <span className="mt-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary-foreground/90 transition group-hover:translate-x-1">
          Grab now <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function OfferCard({ coupon, store }: { coupon: Coupon; store?: Pick<Store, "name" | "slug" | "logo_url"> }) {
  const slug = store?.slug ? `${store.slug}-coupons` : "all-coupons";
  return (
    <Link
      to="/$slug"
      params={{ slug }}
      className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="relative h-44 bg-gradient-to-br from-primary-soft via-accent to-background">
        <div className="absolute inset-0 grid place-items-center">
          {store?.logo_url ? (
            <img src={store.logo_url} alt={`${store.name} logo`} width={96} height={96} loading="lazy" decoding="async" className="max-h-20 max-w-[60%] object-contain opacity-90 transition group-hover:scale-105" />
          ) : (
            <Tag className="h-12 w-12 text-primary/40" />
          )}
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-card/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary backdrop-blur">
          {coupon.coupon_type === "code" ? "Code" : "Deal"}
        </span>
        <div className="absolute -bottom-6 left-6 grid h-12 w-12 place-items-center rounded-full border-4 border-card bg-card shadow-md">
          {store?.logo_url ? (
            <img src={store.logo_url} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-contain" />
          ) : (
            <Tag className="h-5 w-5 text-primary" />
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6 pt-9">
        <h3 className="font-bold text-foreground transition group-hover:text-primary">{coupon.title}</h3>
        {coupon.description && <p className="text-sm text-muted-foreground line-clamp-2">{coupon.description}</p>}
        <span className="mt-auto inline-flex items-center justify-center rounded-xl border border-border bg-secondary/50 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground transition group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
          {coupon.coupon_type === "code" ? "Get Code" : "Grab Deal"}
        </span>
      </div>
    </Link>
  );
}

function Section({ title, subtitle, link, children }: { title: string; subtitle?: string; link?: { to: string; label: string }; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {link && (
          <Link to={link.to} search={{ q: "" }} className="hidden shrink-0 items-center gap-1 text-sm font-bold text-primary hover:underline sm:inline-flex">
            {link.label} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
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
