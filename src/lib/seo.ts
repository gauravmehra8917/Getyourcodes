export const SITE_URL = "https://getyourcodes.com";
export const SITE_NAME = "Getyourcodes";

export const abs = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const clip = (s: string | null | undefined, n = 160) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export type SeoFields = {
  seo_title?: string | null;
  seo_description?: string | null;
  seo_canonical_url?: string | null;
  seo_robots?: string | null;
  seo_og_image?: string | null;
};

export function seoText(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export function seoRobots(value: string | null | undefined): string {
  const robots = value?.trim();
  return robots &&
    ["index,follow", "noindex,follow", "index,nofollow", "noindex,nofollow"].includes(robots)
    ? robots
    : "index,follow";
}

/** Saved canonicals can only resolve to this page's exact public URL. */
export function selfCanonical(value: string | null | undefined, path: string): string {
  const expected = abs(path);
  if (!value?.trim()) return expected;
  try {
    const candidate = new URL(value.trim(), SITE_URL);
    candidate.pathname = candidate.pathname.replace(/\/$/, "");
    return candidate.href === expected ? candidate.href : expected;
  } catch {
    return expected;
  }
}
