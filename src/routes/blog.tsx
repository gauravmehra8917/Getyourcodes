import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { parsePage } from "@/lib/home-data";
import { Pagination } from "@/components/pagination";

const PER_PAGE = 12;

export const Route = createFileRoute("/blog")({
  validateSearch: parsePage,
  head: () => ({
    meta: [
      { title: "Deals Blog — Getyourcodes" },
      { name: "description", content: "Money-saving guides, deal alerts, and brand-by-brand promo breakdowns from Getyourcodes." },
      { property: "og:title", content: "Deals Blog — Getyourcodes" },
      { property: "og:description", content: "Guides and stories about saving money on the brands you love." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://getyourcodes.com/blog" },
    ],
    links: [{ rel: "canonical", href: "https://getyourcodes.com/blog" }],
  }),
  component: BlogIndex,
});

type Post = { id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string | null };

function BlogIndex() {
  const { page } = Route.useSearch();
  const { data } = useQuery({
    queryKey: ["public-posts", page],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const from = (page - 1) * PER_PAGE;
      const { data, count } = await sb
        .from("posts")
        .select("id,title,slug,excerpt,cover_image,published_at", { count: "exact" })
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .range(from, from + PER_PAGE - 1);
      return { rows: (data ?? []) as Post[], total: count ?? 0 };
    },
  });
  const posts = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="mb-12 text-center">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">The Getyourcodes Blog</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Buying guides, deal alerts, and money-saving stories.</p>
      </header>
      {posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-16 text-center text-sm text-muted-foreground">
          No posts published yet.
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug }} className="group block overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-1 hover:shadow-lg">
              {p.cover_image && <img src={p.cover_image} alt={p.title} loading="lazy" className="aspect-[16/9] w-full object-cover" />}
              <div className="p-5">
                {p.published_at && <time className="text-xs uppercase tracking-wide text-muted-foreground">{new Date(p.published_at).toLocaleDateString()}</time>}
                <h2 className="mt-2 font-display text-xl font-bold leading-tight group-hover:text-primary">{p.title}</h2>
                {p.excerpt && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{p.excerpt}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination page={page} total={data?.total ?? 0} perPage={PER_PAGE} to="/blog" />
    </div>
  );
}
