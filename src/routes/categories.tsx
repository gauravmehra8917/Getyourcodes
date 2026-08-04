import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { activeOfferCountsQuery, categoriesQuery, parsePage, rankCategories, storesLiteQuery } from "@/lib/home-data";
import { Pagination } from "@/components/pagination";
import { abs, SITE_NAME } from "@/lib/seo";

const PER_PAGE = 24;

export const Route = createFileRoute("/categories")({
  validateSearch: parsePage,
  search: { middlewares: [stripSearchParams({ page: 1 })] },
  head: () => ({
    meta: [
      { title: `All Coupon Categories — ${SITE_NAME}` },
      { name: "description", content: "Browse every shopping category with verified coupons and deals, ranked by live offer count." },
      { property: "og:title", content: `All Coupon Categories — ${SITE_NAME}` },
      { property: "og:description", content: "Browse every shopping category with verified coupons and deals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: abs("/categories") }],
  }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { page } = Route.useSearch();
  const categories = useQuery(categoriesQuery);
  const stores = useQuery(storesLiteQuery);
  const counts = useQuery(activeOfferCountsQuery);

  const ranked = rankCategories(categories.data ?? [], stores.data ?? [], counts.data ?? {});
  const slice = ranked.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="container-page py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">All Categories</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Every category we cover, ranked by the number of live offers.</p>
      </header>

      {slice.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-secondary/40 p-12 text-center text-sm text-muted-foreground">No categories yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {slice.map((c) => (
            <Link
              key={c.id}
              to="/$slug"
              params={{ slug: `${c.slug}-offers` }}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Tag className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{c.offers} active offers</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={page} total={ranked.length} perPage={PER_PAGE} to="/categories" />
    </div>
  );
}
