import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { couponPageQuery, parsePage } from "@/lib/home-data";
import { CouponCard } from "@/components/coupon-card";
import { Pagination } from "@/components/pagination";
import { abs, SITE_NAME } from "@/lib/seo";

const PER_PAGE = 24;

export const Route = createFileRoute("/deals")({
  validateSearch: parsePage,
  head: () => ({
    meta: [
      { title: `All Deals & Offers — ${SITE_NAME}` },
      { name: "description", content: "Active no-code deals from our affiliate partners — click through and the discount applies automatically." },
      { property: "og:title", content: `All Deals & Offers — ${SITE_NAME}` },
      { property: "og:description", content: "Active no-code deals — click through and save." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: abs("/deals") }],
  }),
  component: DealsPage,
});

function DealsPage() {
  const { page } = Route.useSearch();
  const { data } = useQuery(couponPageQuery("deal", page, PER_PAGE));
  const rows = data?.rows ?? [];

  return (
    <div className="container-page py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">All Deals</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">No code needed — just click through to the store and the offer applies.</p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-secondary/40 p-12 text-center text-sm text-muted-foreground">No active deals right now.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <CouponCard key={c.id} coupon={c} store={c.stores ?? undefined} />
          ))}
        </div>
      )}

      <Pagination page={page} total={data?.total ?? 0} perPage={PER_PAGE} to="/deals" />
    </div>
  );
}
