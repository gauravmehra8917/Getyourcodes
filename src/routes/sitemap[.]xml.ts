import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE_URL = "https://dealio-dash.lovable.app";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: { path: string; changefreq?: string; priority?: string }[] = [
          { path: "/", changefreq: "daily", priority: "1.0" },
        ];

        try {
          const [{ data: stores }, { data: categories }] = await Promise.all([
            supabaseAdmin.from("stores").select("slug"),
            supabaseAdmin.from("categories").select("slug"),
          ]);
          (stores ?? []).forEach((s: { slug: string }) => entries.push({ path: `/${s.slug}-coupons`, changefreq: "daily", priority: "0.8" }));
          (categories ?? []).forEach((c: { slug: string }) => entries.push({ path: `/${c.slug}-offers`, changefreq: "weekly", priority: "0.7" }));
        } catch { /* ignore */ }

        const urls = entries.map((e) =>
          [`  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`].filter(Boolean).join("\n")
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
