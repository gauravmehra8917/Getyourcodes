import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Search as SearchIcon, TrendingUp, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sb } from "@/lib/db";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Deal Analytics — SaveHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

type TopSearchRow = { query: string; count: number };
type ClickRow = { coupon_id: string; coupons: { title: string; stores: { name: string; slug: string } | null } | null };

function AnalyticsPage() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { navigate({ to: "/login" }); return; }
      setAuthed(true);
    });
  }, [navigate]);

  const topSearched = useQuery({
    queryKey: ["analytics", "top-searches"],
    enabled: !!authed,
    queryFn: async () => {
      const { data } = await sb.rpc("get_top_searches", { _limit: 10 });
      return (data ?? []) as TopSearchRow[];
    },
  });

  const topAi = useQuery({
    queryKey: ["analytics", "top-ai-searches"],
    enabled: !!authed,
    queryFn: async () => {
      const { data } = await sb.rpc("get_top_ai_searches", { _limit: 8 });
      return (data ?? []) as TopSearchRow[];
    },
  });

  const clicks = useQuery({
    queryKey: ["analytics", "clicks"],
    enabled: !!authed,
    queryFn: async () => {
      const { data } = await sb
        .from("coupon_clicks")
        .select("coupon_id, coupons(title, stores(name, slug))")
        .order("clicked_at", { ascending: false })
        .limit(1000);
      return (data ?? []) as ClickRow[];
    },
  });

  if (authed === null) return <p className="py-16 text-center text-muted-foreground">Loading…</p>;

  // Aggregate searches (server-side, via SECURITY DEFINER RPCs)
  const topSearchedItems = (topSearched.data ?? []).map((r) => ({ label: r.query, count: Number(r.count) }));
  const topAiItems = (topAi.data ?? []).map((r) => ({ label: r.query, count: Number(r.count) }));
  const totalSearches = topSearchedItems.reduce((acc, it) => acc + it.count, 0);
  const totalAi = topAiItems.reduce((acc, it) => acc + it.count, 0);

  // Aggregate clicks → coupons + stores
  const allClicks = clicks.data ?? [];
  const couponCounts = new Map<string, { title: string; store: string | null; storeSlug: string | null; count: number }>();
  const storeCounts = new Map<string, { name: string; slug: string; count: number }>();
  for (const c of allClicks) {
    const title = c.coupons?.title ?? "Unknown coupon";
    const storeName = c.coupons?.stores?.name ?? null;
    const storeSlug = c.coupons?.stores?.slug ?? null;
    const prev = couponCounts.get(c.coupon_id);
    couponCounts.set(c.coupon_id, {
      title,
      store: storeName,
      storeSlug,
      count: (prev?.count ?? 0) + 1,
    });
    if (storeName && storeSlug) {
      const ps = storeCounts.get(storeSlug);
      storeCounts.set(storeSlug, { name: storeName, slug: storeSlug, count: (ps?.count ?? 0) + 1 });
    }
  }
  const topCoupons = [...couponCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  const topStores = [...storeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" /> Community insights
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Deal Analytics</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          What everyone on SaveHub is searching for, asking Dealio about, and clicking on right now. Aggregated across all users.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<SearchIcon className="h-4 w-4" />} title="Most searched" subtitle={`${allSearches.length.toLocaleString()} searches tracked`}>
          <BarList items={topSearched} emptyText="No searches yet." />
        </Card>

        <Card icon={<Tag className="h-4 w-4" />} title="Top requested with Dealio AI" subtitle={`${aiSearches.length.toLocaleString()} AI conversations`}>
          <BarList items={topAi} emptyText="No AI requests yet." />
        </Card>

        <Card icon={<TrendingUp className="h-4 w-4" />} title="Top converting coupons" subtitle="Most clicked codes & deals">
          {topCoupons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clicks yet.</p>
          ) : (
            <ul className="space-y-3">
              {topCoupons.map(([id, c], i) => {
                const max = topCoupons[0]?.[1].count ?? 1;
                const pct = Math.max(6, Math.round((c.count / max) * 100));
                return (
                  <li key={id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span className="mr-2 text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                        <span className="font-medium">{c.title}</span>
                        {c.store && c.storeSlug && (
                          <Link to="/$slug" params={{ slug: c.storeSlug }} className="ml-2 text-xs text-primary hover:underline">
                            {c.store}
                          </Link>
                        )}
                      </div>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent-foreground" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card icon={<BarChart3 className="h-4 w-4" />} title="Most popular brands" subtitle="By coupon clicks">
          {topStores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No brand activity yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {topStores.map((s, i) => (
                <li key={s.slug}>
                  <Link
                    to="/$slug"
                    params={{ slug: s.slug }}
                    className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm hover:border-primary/40"
                  >
                    <span className="truncate">
                      <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                      {s.name}
                    </span>
                    <span className="ml-2 shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{s.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</span>
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function BarList({ items, emptyText }: { items: { label: string; count: number }[]; emptyText: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const max = items[0]?.count ?? 1;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const pct = Math.max(6, Math.round((it.count / max) * 100));
        return (
          <li key={`${it.label}-${i}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                {it.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{it.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function topN(values: string[], n: number): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
