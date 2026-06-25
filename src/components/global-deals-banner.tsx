import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Globe2, X, Sparkles } from "lucide-react";
import { sb, trackClick, type Coupon, type Store } from "@/lib/db";

type DealRow = Coupon & { stores: Pick<Store, "name" | "slug" | "logo_url"> | null };

export function GlobalDealsBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  const { data: deals } = useQuery({
    queryKey: ["global-deals-banner"],
    queryFn: async () => {
      // Prefer admin-curated featured coupons
      const { data: featured } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active")
        .eq("featured_in_banner", true)
        .order("created_at", { ascending: false })
        .limit(8);
      if (featured && featured.length > 0) return featured as DealRow[];

      // Fallback: rank active coupons by recent clicks
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: clicks } = await sb
        .from("coupon_clicks")
        .select("coupon_id")
        .gte("created_at", since);
      const counts = new Map<string, number>();
      (clicks ?? []).forEach((c: { coupon_id: string }) => {
        counts.set(c.coupon_id, (counts.get(c.coupon_id) ?? 0) + 1);
      });

      const { data } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(24);
      const rows = (data ?? []) as DealRow[];
      rows.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
      return rows.slice(0, 8);
    },
    staleTime: 5 * 60_000,
  });

  const slides = deals ?? [];
  const total = slides.length;

  useEffect(() => {
    if (total < 2) return;
    const t = setInterval(() => {
      if (!pausedRef.current) setIndex((i) => (i + 1) % total);
    }, 5000);
    return () => clearInterval(t);
  }, [total]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const child = rail.children[index] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, [index]);

  if (dismissed || total === 0) return null;

  const dismiss = () => {
    setDismissed(true);
  };

  const go = (dir: -1 | 1) => setIndex((i) => (i + dir + total) % total);

  return (
    <section
      className="relative overflow-hidden border-b border-border bg-gradient-to-r from-primary/10 via-accent/40 to-primary/10 animate-fade-in"
      onMouseEnter={() => (pausedRef.current = true)}
      onMouseLeave={() => (pausedRef.current = false)}
      onFocusCapture={() => (pausedRef.current = true)}
      onBlurCapture={() => (pausedRef.current = false)}
      aria-label="Best deals across the globe"
    >
      <div className="pointer-events-none absolute -left-20 -top-20 h-60 w-60 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-accent/60 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-card px-3 py-1 text-xs font-semibold text-primary">
              <Globe2 className="h-3.5 w-3.5" />
              Best deals across the globe
            </span>
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Sparkles className="h-3 w-3" /> {total} live offers
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => go(-1)}
              aria-label="Previous deal"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground hover:border-primary/40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => go(1)}
              aria-label="Next deal"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground hover:border-primary/40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss banner"
              className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-transparent text-muted-foreground transition hover:border-border hover:bg-card hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={railRef}
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((d) => (
            <DealTile key={d.id} deal={d} />
          ))}
        </div>

        {total > 1 && (
          <div className="mt-4 flex justify-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to deal ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DealTile({ deal }: { deal: DealRow }) {
  const store = deal.stores;
  const isCode = deal.coupon_type === "code";

  const onClick = () => {
    trackClick(deal.id, "global-banner");
    if (deal.affiliate_url) window.open(deal.affiliate_url, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="group relative flex w-[88%] shrink-0 snap-start flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:w-[48%] lg:w-[32%]">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-secondary">
          {store?.logo_url ? (
            <img src={store.logo_url} alt={store.name} width={44} height={44} loading="lazy" decoding="async" className="h-full w-full object-contain" />
          ) : (
            <span className="text-sm font-bold text-muted-foreground">
              {(store?.name ?? "?").charAt(0)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-muted-foreground">{store?.name ?? "Store"}</p>
          <span
            className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isCode ? "bg-primary-soft text-primary" : "bg-success-soft text-success"
            }`}
          >
            {isCode ? "Promo code" : "Deal"}
          </span>
        </div>
      </div>

      <h3 className="line-clamp-2 font-display text-lg font-bold leading-snug">{deal.title}</h3>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {isCode && deal.coupon_code ? (
          <span className="truncate rounded-lg border border-dashed border-primary/40 bg-primary-soft px-2.5 py-1 font-mono text-xs font-bold text-primary">
            {deal.coupon_code}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No code needed</span>
        )}
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Get deal →
        </button>
      </div>
    </article>
  );
}
