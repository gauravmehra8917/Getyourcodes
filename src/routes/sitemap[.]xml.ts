import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE_URL = "https://getyourcodes.com";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

type Entry = { path: string; lastmod?: string | null };

// Exclude temp/test/draft/deleted slugs from the sitemap.
const EXCLUDE_SLUG = /(^|[-_/])(test|draft|temp|tmp|deleted|demo|sample|preview|staging)([-_/]|$)|\d{10,}/i;
const isCleanSlug = (slug: string | null | undefined): slug is string =>
  !!slug && !EXCLUDE_SLUG.test(slug);

const isValidLastmod = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Treat the Unix epoch/default placeholder as unavailable.
  if (d.getFullYear() <= 1970) return null;
  return d.toISOString().slice(0, 10);
};

const toLastmod = (value: string | null | undefined) =>
  isValidLastmod(value) ?? BUILD_DATE;

const STATIC_SLUG_TO_PATH: Record<string, string> = {
  home: "/",
  search: "/search",
  blog: "/blog",
  about: "/about",
  contact: "/contact",
};

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: Entry[] = Object.values(STATIC_SLUG_TO_PATH).map(
          (path) => ({ path }),
        );

        try {
          const [
            { data: stores },
            { data: categories },
            { data: posts },
            { data: pages },
          ] = await Promise.all([
            supabaseAdmin.from("stores").select("slug, created_at"),
            supabaseAdmin.from("categories").select("slug, created_at"),
            supabaseAdmin
              .from("posts")
              .select("slug, updated_at, published_at")
              .eq("status", "published"),
            supabaseAdmin
              .from("pages")
              .select("slug, updated_at, published")
              .eq("published", true)
              .in("slug", Object.keys(STATIC_SLUG_TO_PATH)),
          ]);

          (pages ?? []).forEach((p) => {
            const path = STATIC_SLUG_TO_PATH[p.slug];
            if (!path) return;
            const lastmod = isValidLastmod(p.updated_at);
            if (!lastmod) return;
            const entry = entries.find((e) => e.path === path);
            if (entry) entry.lastmod = lastmod;
          });

          (stores ?? []).forEach((s) => {
            if (!isCleanSlug(s.slug)) return;
            entries.push({
              path: `/${s.slug}-coupons`,
              lastmod: toLastmod(s.created_at),
            });
          });
          (categories ?? []).forEach((c) => {
            if (!isCleanSlug(c.slug)) return;
            entries.push({
              path: `/${c.slug}-offers`,
              lastmod: toLastmod(c.created_at),
            });
          });
          (posts ?? []).forEach((p) => {
            if (!isCleanSlug(p.slug)) return;
            entries.push({
              path: `/blog/${p.slug}`,
              lastmod: toLastmod(p.updated_at ?? p.published_at),
            });
          });
        } catch {
          /* ignore — emit a partial sitemap rather than 500 */
        }

        // De-duplicate by canonical URL, keep the freshest lastmod.
        const byPath = new Map<string, Entry>();
        for (const e of entries) {
          const existing = byPath.get(e.path);
          if (!existing || (e.lastmod ?? "") > (existing.lastmod ?? "")) {
            byPath.set(e.path, e);
          }
        }

        const urls = Array.from(byPath.values()).map((e) => {
          const lines = [`  <url>`, `    <loc>${BASE_URL}${e.path}</loc>`];
          if (e.lastmod) lines.push(`    <lastmod>${e.lastmod}</lastmod>`);
          lines.push(`  </url>`);
          return lines.join("\n");
        });

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
