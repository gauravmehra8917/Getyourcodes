import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { activeOfferCountsQuery, parsePage, rankStores, storesLiteQuery } from "@/lib/home-data";
import { StoreCard } from "@/components/store-card";
import { Pagination } from "@/components/pagination";
import { abs, SITE_NAME } from "@/lib/seo";
import type { Store } from "@/lib/db";

const PER_PAGE = 24;

export const Route = createFileRoute("/stores")({
  validateSearch: parsePage,
  search: { middlewares: [stripSearchParams({ page: 1 })] },
  head: () => ({
    meta: [
      { title: `All Stores with Coupons & Promo Codes — ${SITE_NAME}` },
      { name: "description", content: "Browse every partner store on Getyourcodes, ranked by live verified coupons and deals." },
      { property: "og:title", content: `All Stores with Coupons — ${SITE_NAME}` },
      { property: "og:description", content: "Browse every partner store ranked by live verified offers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: abs("/stores") }],
  }),
  component: StoresPage,
});

function StoresPage() {
  const { page } = Route.useSearch();
  const stores = useQuery(storesLiteQuery);
  const counts = useQuery(activeOfferCountsQuery);

  const hasError = stores.isError || counts.isError;
  const isLoading = (stores.isPending || counts.isPending) && !hasError;
  // Wait for both queries so the first grid has its final counts and ordering.
  const ranked = stores.data && counts.data ? rankStores(stores.data, counts.data) : [];
  const slice = ranked.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    // Allow for the shared header/footer gap without reserving a 24-card page.
    <div className="container-page min-h-[calc(100svh-10rem)] py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">All Stores</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Every brand we track, ordered by the number of active offers available right now.</p>
      </header>

      <p role="status" className="sr-only">
        {isLoading ? "Loading stores…" : ""}
      </p>
      <div aria-busy={isLoading}>
        {hasError && (
          <p
            role="alert"
            className="mb-6 rounded-2xl border border-border bg-secondary/40 p-6 text-center text-sm text-muted-foreground"
          >
            Unable to load the latest stores and offer counts. Please try again later.
          </p>
        )}
        {isLoading ? (
          <div
            aria-hidden="true"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          >
            {[
              "flex",
              "flex",
              "hidden sm:flex",
              "hidden lg:flex",
              "hidden xl:flex",
              "hidden xl:flex",
            ].map((display, i) => (
              <div
                key={i}
                className={`${display} min-w-0 flex-col items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-5`}
              >
                <div className="h-16 w-16 rounded-xl bg-secondary" />
                <div className="w-full">
                  <div className="mx-auto h-6 w-3/4 rounded bg-secondary" />
                  <div className="mx-auto h-4 w-12 rounded bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        ) : !stores.data || !counts.data ? null : slice.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-secondary/40 p-12 text-center text-sm text-muted-foreground">No stores yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {slice.map((s) => (
              <StoreCard key={s.id} store={s as unknown as Store} count={s.offers} />
            ))}
          </div>
        )}

        <Pagination page={page} total={ranked.length} perPage={PER_PAGE} to="/stores" />
      </div>
    </div>
  );
}
