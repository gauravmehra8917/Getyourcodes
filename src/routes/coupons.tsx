import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { couponPageQuery, parsePage } from "@/lib/home-data";
import { CouponCard } from "@/components/coupon-card";
import { Pagination } from "@/components/pagination";
import { abs, SITE_NAME } from "@/lib/seo";

const PER_PAGE = 24;

export const Route = createFileRoute("/coupons")({
  validateSearch: parsePage,
  search: { middlewares: [stripSearchParams({ page: 1 })] },
  head: () => ({
    meta: [
      { title: `All Verified Coupon Codes — ${SITE_NAME}` },
      { name: "description", content: "Every active promo code on Getyourcodes, newest first — copy the code and save at checkout." },
      { property: "og:title", content: `All Verified Coupon Codes — ${SITE_NAME}` },
      { property: "og:description", content: "Every active promo code, newest first." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: abs("/coupons") }],
  }),
  component: CouponsPage,
});

function CouponsPage() {
  const { page } = Route.useSearch();
  const { data } = useQuery(couponPageQuery("code", page, PER_PAGE));
  const rows = data?.rows ?? [];

  return (
    <div className="container-page py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">All Coupon Codes</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Active promo codes from our affiliate partners, most recently imported first.</p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-secondary/40 p-12 text-center text-sm text-muted-foreground">No active coupon codes right now.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <CouponCard key={c.id} coupon={c} store={c.stores ?? undefined} />
          ))}
        </div>
      )}

      <Pagination page={page} total={data?.total ?? 0} perPage={PER_PAGE} to="/coupons" />
    </div>
  );
}
