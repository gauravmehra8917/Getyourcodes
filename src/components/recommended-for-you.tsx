import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sb, type Coupon, type Store } from "@/lib/db";
import { CouponCard } from "@/components/coupon-card";
import { rankCoupons, type RankableCoupon } from "@/lib/ranking";

type CouponRow = Coupon & {
  stores: Pick<Store, "name" | "slug" | "logo_url"> | null;
};

export function RecommendedForYou() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.user?.id ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setUserId(s?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const scroller = useRef<HTMLDivElement>(null);

  const rec = useQuery({
    queryKey: ["recommendations", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      // 1. Collect signal store IDs from saved stores + recent clicks.
      const [savedStores, savedCoupons, recentClicks] = await Promise.all([
        sb.from("saved_stores").select("store_id").eq("user_id", userId).limit(50),
        sb.from("saved_coupons").select("coupon_id, coupons(store_id)").eq("user_id", userId).limit(50),
        sb
          .from("coupon_clicks")
          .select("coupon_id, coupons(store_id)")
          .eq("user_id", userId)
          .order("clicked_at", { ascending: false })
          .limit(50),
      ]);

      const storeIds = new Set<string>();
      (savedStores.data ?? []).forEach((r: { store_id: string }) => storeIds.add(r.store_id));
      (savedCoupons.data ?? []).forEach((r: { coupons: { store_id: string } | null }) => {
        if (r.coupons?.store_id) storeIds.add(r.coupons.store_id);
      });
      (recentClicks.data ?? []).forEach((r: { coupons: { store_id: string } | null }) => {
        if (r.coupons?.store_id) storeIds.add(r.coupons.store_id);
      });

      if (storeIds.size === 0) return [] as CouponRow[];

      // 2. Fetch active coupons from those stores.
      const { data } = await sb
        .from("coupons")
        .select("*, stores(name, slug, logo_url)")
        .eq("status", "active")
        .in("store_id", Array.from(storeIds))
        .order("created_at", { ascending: false })
        .limit(40);

      const coupons = (data ?? []) as CouponRow[];
      if (coupons.length === 0) return coupons;

      // 3. Pull engagement signals to rank.
      const couponIds = coupons.map((c) => c.id);
      const [clickRes, savedRes] = await Promise.all([
        sb.from("coupon_clicks").select("coupon_id").in("coupon_id", couponIds),
        sb.from("saved_coupons").select("coupon_id").in("coupon_id", couponIds),
      ]);
      const clicks: Record<string, number> = {};
      (clickRes.data ?? []).forEach((r: { coupon_id: string }) => {
        clicks[r.coupon_id] = (clicks[r.coupon_id] ?? 0) + 1;
      });
      const saves: Record<string, number> = {};
      (savedRes.data ?? []).forEach((r: { coupon_id: string }) => {
        saves[r.coupon_id] = (saves[r.coupon_id] ?? 0) + 1;
      });

      const ranked = rankCoupons(
        coupons.map<RankableCoupon>((c) => ({
          id: c.id,
          title: c.title,
          created_at: c.created_at,
          expiry_date: c.expiry_date,
          coupon_type: c.coupon_type,
          coupon_code: c.coupon_code,
          clicks: clicks[c.id] ?? 0,
          saves: saves[c.id] ?? 0,
        })),
      );
      const byId = new Map(coupons.map((c) => [c.id, c]));
        return ranked
          .slice(0, 6)
          .map((r: { id: string }) => byId.get(r.id))
          .filter((c): c is CouponRow => !!c);
    },
  });

  if (!ready || !userId) return null;
  if (rec.isLoading) {
    return (
      <section className="py-14 sm:py-16">
        <Header />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 w-[260px] shrink-0 animate-pulse rounded-2xl bg-secondary/50" />
          ))}
        </div>
      </section>
    );
  }
  if (!rec.data || rec.data.length === 0) return null;

  return (
    <section className="py-14 sm:py-16">
      <Header scroller={scroller} />
      <div
        ref={scroller}
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:mx-0 sm:px-0"
      >
        {rec.data.map((c) => (
          <div key={c.id} className="w-[260px] shrink-0 snap-start sm:w-[280px]">
            <CouponCard coupon={c} store={c.stores ?? undefined} variant="tile" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({ scroller }: { scroller?: React.RefObject<HTMLDivElement | null> }) {
  const nudge = (dir: -1 | 1) => {
    const el = scroller?.current;
    if (el) el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent-foreground text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          Recommended for you
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Based on the stores you've saved and deals you've explored.
        </p>
      </div>
      {scroller && (
        <div className="hidden shrink-0 gap-2 sm:flex">
          <button type="button" aria-label="Scroll recommendations left" onClick={() => nudge(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Scroll recommendations right" onClick={() => nudge(1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
