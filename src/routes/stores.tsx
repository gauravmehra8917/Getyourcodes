import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { activeOfferCountsQuery, parsePage, rankStores, storesLiteQuery } from "@/lib/home-data";
import { StoreCard } from "@/components/store-card";
import { Pagination } from "@/components/pagination";
import { abs, SITE_NAME } from "@/lib/seo";
import type { Store } from "@/lib/db";

const PER_PAGE = 24;

export const Route = createFileRoute("/stores")({
  validateSearch: parsePage,
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

  const ranked = rankStores(stores.data ?? [], counts.data ?? {});
  const slice = ranked.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="container-page py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">All Stores</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Every brand we track, ordered by the number of active offers available right now.</p>
      </header>

      {slice.length === 0 ? (
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
  );
}
