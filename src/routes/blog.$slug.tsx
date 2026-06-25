import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";

export const Route = createFileRoute("/blog/$slug")({
  component: BlogPost,
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="font-display text-4xl font-bold">Post not found</h1>
      <Link to="/blog" className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Back to blog</Link>
    </div>
  ),
});

type Post = { id: string; title: string; slug: string; excerpt: string | null; body: string; cover_image: string | null; published_at: string | null; seo_title: string | null; seo_description: string | null };

function BlogPost() {
  const { slug } = useParams({ from: "/blog/$slug" });
  const { data: post, isLoading } = useQuery({
    queryKey: ["public-post", slug],
    queryFn: async () => {
      const { data } = await sb.from("posts").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
      return data as Post | null;
    },
  });

  if (isLoading) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-muted-foreground">Loading…</div>;
  if (!post) throw notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Link to="/blog" className="text-sm text-muted-foreground hover:text-primary">← Back to blog</Link>
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
