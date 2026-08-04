import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Sparkles, ShoppingBag, Utensils, Plane, Smartphone, Shirt, Home,
  Wand2, Tag, Gift, TrendingUp, Mail, ArrowRight,
} from "lucide-react";
import { sb, trackSearch, type Store, type Coupon, type Category } from "@/lib/db";
import { CouponCard } from "@/components/coupon-card";
import { GlobalDealsBanner } from "@/components/global-deals-banner";
import { RecommendedForYou } from "@/components/recommended-for-you";
import { useAssistant } from "@/components/ai-assistant-provider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Getyourcodes — Verified Coupons, Promo Codes & Deals" },
      { name: "description", content: "Hand-picked coupons and deals from your favorite brands. Save more on fashion, food, electronics, travel and more." },
      { property: "og:title", content: "Getyourcodes — Verified coupons & deals" },
      { property: "og:description", content: "Save more on every order with verified promo codes." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://getyourcodes.com/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://getyourcodes.com/" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Getyourcodes",
        url: "https://getyourcodes.com/",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://getyourcodes.com/search?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      }),
    }],
  }),
  component: HomePage,
});

const ICONS = [ShoppingBag, Utensils, Plane, Smartphone, Shirt, Home, Gift, Tag];

function HomePage() {
  const navigate = useNavigate();
  const assistant = useAssistant();
  const [aiQ, setAiQ] = useState("");

  const offerCounts = useQuery(activeOfferCountsQuery);
  const storesLite = useQuery(storesLiteQuery);
  const allCategories = useQuery(categoriesQuery);

  const topCategories = rankCategories(allCategories.data ?? [], storesLite.data ?? [], offerCounts.data ?? {}).slice(0, 8);
  const topStores = rankStores(storesLite.data ?? [], offerCounts.data ?? {}).slice(0, 12);

  const trending = useQuery({
    queryKey: ["coupons", "trending"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await sb.from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active").eq("coupon_type", "code")
        .order("created_at", { ascending: false }).limit(6);
      return (data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[];
    },
  });
  const latestDeals = useQuery({
    queryKey: ["coupons", "deals"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await sb.from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active").eq("coupon_type", "deal")
        .order("created_at", { ascending: false }).limit(6);
      return (data ?? []) as (Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> })[];
    },
  });
  const blogPosts = useQuery({
    queryKey: ["home-blog"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await sb.from("posts")
        .select("id,title,slug,excerpt,cover_image,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false }).limit(3);
      return (data ?? []) as { id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string | null }[];
    },
  });

  return (
    <div className="bg-background text-foreground">



      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="hero-glow-primary absolute left-1/2 top-0 h-[600px] w-[1200px] -translate-x-1/2 rounded-full blur-3xl" />
          <div className="hero-glow-accent absolute right-0 top-40 h-72 w-72 rounded-full blur-3xl" />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-glow" /> Verified coupons from affiliate partners
          </div>
          <h1 className="mx-auto max-w-4xl font-display text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-7xl">
            Verified coupons,{" "}
            <span className="text-gradient">real savings.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            Getyourcodes brings together promo codes and deals sourced directly from our affiliate
            partners — each listing links straight to the store, so you always know where the offer
            comes from.
          </p>

          {/* AI Deal Assistant */}
          <div className="mx-auto mt-10 max-w-2xl" data-hero-assistant>
            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm backdrop-blur sm:p-6">
              <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-glow">
                <Wand2 className="h-3.5 w-3.5" /> Dealio · AI shopping assistant
              </div>
              <h2 className="mb-4 font-display text-xl font-bold text-foreground sm:text-2xl">
                What are you shopping for today?
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = aiQ.trim();
                  if (!t) return;
                  trackSearch(t, "ai");
                  assistant.open(t);
                  setAiQ("");
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <input
                  value={aiQ}
                  onChange={(e) => setAiQ(e.target.value)}
                  placeholder="Tell Dealio what you need — “running shoes under $100”"
                  aria-label="Ask Dealio: describe what you're shopping for"
                  className="h-12 flex-1 rounded-full border border-border bg-surface-2 px-5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  className="gradient-primary inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-primary-foreground shadow-glow"
                >
                  <Sparkles className="h-4 w-4" /> Ask Dealio
                </button>
              </form>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
                {["Find me laptop deals", "Any food delivery codes?", "Travel offers this week"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => assistant.open(s)}
                    className="rounded-full border border-border bg-surface px-3 py-1 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>




      {/* Top categories grid */}
      <section id="categories" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-6 pb-4 sm:px-6">
        <SectionHeading icon={<Tag className="h-5 w-5" />} title="Top Categories" subtitle="Discover offers across every category" />
        {categories.data && categories.data.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {categories.data.map((c, i) => {
              const Icon = ICONS[i % ICONS.length];
              return (
                <Link
                  key={c.id}
                  to="/$slug"
                  params={{ slug: `${c.slug}-offers` }}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-white/8 bg-surface p-5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-2"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-glow transition group-hover:gradient-primary group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-white/90">{c.name}</p>
                </Link>
              );
            })}
          </div>
        ) : <EmptyHint text="No categories yet." />}
      </section>

      {/* Featured stores logo strip */}
      <section id="stores" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-12 sm:px-6">
        <SectionHeading title="Featured Stores" subtitle="Top brands picked by our editors" />
        {featured.data && featured.data.length > 0 ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9">
            {featured.data.map((s) => (
              <Link
                key={s.id}
                to="/$slug"
                params={{ slug: `${s.slug}-coupons` }}
                className="group grid aspect-square place-items-center rounded-xl border border-white/8 bg-white/95 p-4 transition hover:-translate-y-0.5 hover:shadow-glow"
              >
                {s.logo_url ? (
                  <img src={s.logo_url} alt={`${s.name} logo`} loading="lazy" className="max-h-12 max-w-[80%] object-contain" />
                ) : (
                  <span className="text-sm font-bold text-slate-700">{s.name}</span>
                )}
              </Link>
            ))}
          </div>
        ) : <EmptyHint text="No featured stores yet." />}
      </section>

      {/* Today's Top Offers banner */}
      <GlobalDealsBanner />

      <div className="mx-auto max-w-7xl space-y-16 px-4 py-12 sm:px-6">
        {/* Personalized */}
        <RecommendedForYou />

        {/* Trending coupons */}
        <section id="coupons" className="scroll-mt-24">
          <SectionHeading icon={<TrendingUp className="h-5 w-5" />} title="Trending Coupon Codes" subtitle="Most-used codes this week" />
          {trending.data && trending.data.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {trending.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No active coupons yet." />}
        </section>

        {/* Editor's Picks / Latest Deals */}
        <section>
          <SectionHeading icon={<Gift className="h-5 w-5" />} title="Editor's Picks" subtitle="No code needed — just click and save" />
          {latestDeals.data && latestDeals.data.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {latestDeals.data.map((c) => <CouponCard key={c.id} coupon={c} store={c.stores} />)}
            </div>
          ) : <EmptyHint text="No deals yet." />}
        </section>

        {/* Blog teasers */}
        {blogPosts.data && blogPosts.data.length > 0 && (
          <section>
            <SectionHeading title="From the Blog" subtitle="Guides, deal alerts, and stories" />
            <div className="grid gap-6 md:grid-cols-3">
              {blogPosts.data.map((p) => (
                <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug }} className="group overflow-hidden rounded-2xl border border-white/8 bg-surface transition hover:-translate-y-0.5 hover:border-primary/40">
                  {p.cover_image && <img src={p.cover_image} alt={p.title} loading="lazy" className="aspect-[16/9] w-full object-cover" />}
                  <div className="p-5">
                    <h3 className="font-display text-lg font-bold leading-snug group-hover:text-glow">{p.title}</h3>
                    {p.excerpt && <p className="mt-2 line-clamp-2 text-sm text-white/60">{p.excerpt}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Newsletter strip */}
        <NewsletterStrip />

      </div>
    </div>
  );
}

function SectionHeading({ icon, title, subtitle }: { icon?: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          {icon && <span className="text-glow">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-surface/50 p-10 text-center text-sm text-white/50">
      {text}
    </div>
  );
}




const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function NewsletterStrip() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
      setStatus({ kind: "err", msg: "Please enter a valid email address." });
      return;
    }
    setBusy(true);
    const { error } = await sb.rpc("subscribe_email", { _email: normalized });
    setBusy(false);
    if (error) {
      setStatus({ kind: "err", msg: "Please enter a valid email address." });
      return;
    }
    setEmail("");
    setStatus({ kind: "ok", msg: "You're subscribed! Check your inbox for top deals." });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-primary/30 via-surface-2 to-surface p-8 text-center sm:p-12 shadow-glow">
      <Mail className="mx-auto mb-4 h-8 w-8 text-glow" />
      <h2 className="font-display text-3xl font-bold sm:text-4xl">Never miss a deal.</h2>
      <p className="mx-auto mt-2 max-w-md text-white/70">Any email works — get the best coupons of the week in your inbox. No spam, ever.</p>
      <form className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row" onSubmit={onSubmit} noValidate>
        <input
          type="email"
          required
          name="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (status.kind !== "idle") setStatus({ kind: "idle", msg: "" }); }}
          placeholder="Your email address"
          maxLength={254}
          autoComplete="email"
          aria-label="Email address"
          aria-invalid={status.kind === "err"}
          className="h-12 flex-1 rounded-full border border-white/15 bg-background/40 px-5 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy}
          className="gradient-primary inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-white shadow-glow disabled:opacity-60"
        >
          {busy ? "Subscribing…" : (<>Subscribe <ArrowRight className="h-4 w-4" /></>)}
        </button>
      </form>
      {status.kind !== "idle" && (
        <p role="status" aria-live="polite" className={`mt-4 text-sm ${status.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}>
          {status.msg}
        </p>
      )}
    </section>
  );
}

