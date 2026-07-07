import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE_URL = "https://getyourcodes.com";

type Entry = { path: string; lastmod?: string; changefreq?: string; priority?: string };

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: Entry[] = [
          { path: "/", changefreq: "daily", priority: "1.0" },
          { path: "/search", changefreq: "weekly", priority: "0.5" },
          { path: "/blog", changefreq: "weekly", priority: "0.7" },
          { path: "/about", changefreq: "monthly", priority: "0.4" },
          { path: "/contact", changefreq: "monthly", priority: "0.4" },
        ];

        try {
          const [{ data: stores }, { data: categories }, { data: posts }] = await Promise.all([
            supabaseAdmin.from("stores").select("slug"),
            supabaseAdmin.from("categories").select("slug"),
            supabaseAdmin
              .from("posts")
              .select("slug, updated_at, published_at")
              .eq("status", "published"),
          ]);
          (stores ?? []).forEach((s) =>
            entries.push({
              path: `/${s.slug}-coupons`,
              changefreq: "daily",
              priority: "0.8",
            }),
          );
          (categories ?? []).forEach((c) =>
            entries.push({
              path: `/${c.slug}-offers`,
              changefreq: "weekly",
              priority: "0.7",
            }),
          );
          (posts ?? []).forEach((p) =>
            entries.push({
              path: `/blog/${p.slug}`,
              lastmod: (p.updated_at ?? p.published_at ?? undefined)?.slice(0, 10),
              changefreq: "monthly",
              priority: "0.6",
            }),
          );
        } catch {
          /* ignore — emit a partial sitemap rather than 500 */
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
