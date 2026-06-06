## Best Deals Globe Banner — Homepage Carousel

Add a bold, Slickdeals-style rotating carousel to the homepage that surfaces the best active deals worldwide. Dismissible with persistent memory.

### Placement
- Mount directly under the hero section on `/` (above "Featured stores"), so it's the first scroll-reveal moment.
- Hidden once dismissed (per browser, via `localStorage`).

### Content source
- Top 8 active coupons from the existing `coupons` table.
- Ranking signal: most clicks in the last 30 days (joined from `coupon_clicks`), with a fallback to most-recent active coupons if click data is sparse.
- Each slide pulls store name + logo from `stores` for branding.
- New read-only server function `getTopGlobalDeals` (public, admin-elevated, projects only safe columns) feeds the carousel via TanStack Query. No new tables required.

### Visual design (Slickdeals-inspired)
- Full-width gradient band with a small "🌍 Best deals across the globe" eyebrow + count of live deals.
- Horizontal scroll-snap rail of large deal tiles (3 visible on desktop, 1.2 on mobile):
  - Store logo chip + store name
  - Bold discount/title (e.g. "60% OFF Sitewide")
  - Coupon code pill OR "Deal" badge
  - "Get deal →" CTA that opens the affiliate URL and tracks a click
- Auto-advance every 5s (pause on hover/focus), prev/next arrows, dot indicators.
- Small close (×) button top-right; click sets `localStorage["savehub:global-banner-dismissed"] = "1"` and unmounts.

### Files
- **New** `src/components/global-deals-banner.tsx` — carousel UI, dismiss logic, click tracking via existing `trackClick`.
- **New** `src/lib/deals.functions.ts` — `getTopGlobalDeals` server function (uses admin client inside handler, returns safe DTO: id, title, code, type, affiliate_url, store name/slug/logo, discount label).
- **Edit** `src/routes/index.tsx` — render `<GlobalDealsBanner />` between hero `<section>` and the content container; prime its query in the route loader.

### Technical notes
- Animations use the existing `animate-fade-in` / `hover-scale` utilities.
- Uses semantic tokens (`primary`, `accent`, `primary-soft`, `card`, `border`); no raw colors.
- Carousel built with native scroll-snap + JS index state (no extra deps).
- SSR-safe: dismiss flag read in a `useEffect` so server render always includes the banner; banner hides on hydrate if dismissed.
- A small "Restore deals banner" link is NOT added — keeping it dismissible-forever per choice.

### Out of scope
- No admin curation UI (uses live data).
- No new DB tables or migrations.
- No changes to other pages.
