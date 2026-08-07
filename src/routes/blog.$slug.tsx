import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { sb } from "@/lib/db";
import { abs, clip, SITE_NAME } from "@/lib/seo";

type Post = { id: string; title: string; slug: string; excerpt: string | null; body: string; cover_image: string | null; published_at: string | null; seo_title: string | null; seo_description: string | null };

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }): Promise<Post> => {
    const { data } = await sb.from("posts").select("*").eq("slug", params.slug).eq("status", "published").maybeSingle();
    if (!data) throw notFound();
    return data as Post;
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [] };
    const p = loaderData;
    const url = abs(`/blog/${params.slug}`);
    const title = `${p.seo_title ?? p.title} — ${SITE_NAME} Blog`;
    const desc = clip(p.seo_description ?? p.excerpt ?? p.body);
    const image = p.cover_image ?? undefined;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
        { name: "twitter:card", content: "summary_large_image" },
        ...(p.published_at ? [{ property: "article:published_time", content: p.published_at }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: p.title,
          description: desc,
          ...(image ? { image } : {}),
          ...(p.published_at ? { datePublished: p.published_at } : {}),
          mainEntityOfPage: url,
        }),
      }],
    };
  },
  component: BlogPost,
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="font-display text-4xl font-bold">Post not found</h1>
      <Link to="/blog" search={{ page: 1 }} className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Back to blog</Link>
    </div>
  ),
});

function BlogPost() {
  const post = Route.useLoaderData();
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Link to="/blog" search={{ page: 1 }} className="text-sm text-muted-foreground hover:text-primary">← Back to blog</Link>
      <header className="mt-6">
        {post.published_at && <time className="text-xs uppercase tracking-wide text-muted-foreground">{new Date(post.published_at).toLocaleDateString()}</time>}
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">{post.title}</h1>
        {post.excerpt && <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>}
      </header>
      {post.cover_image && <img src={post.cover_image} alt={post.title} className="mt-8 aspect-[16/9] w-full rounded-2xl object-cover" />}
      <div className="prose prose-slate mt-10 max-w-none whitespace-pre-wrap text-base leading-relaxed text-foreground">{post.body}</div>
    </article>
  );
}
