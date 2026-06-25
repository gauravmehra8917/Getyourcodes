## Goal

Close remaining Coupstop admin parity gaps and rebuild the public landing page in a Coupstop-style layout using a Midnight Indigo / Outfit + Figtree theme. Keep AI-assisted search, recommendations, and chat assistant intact.

## Part A — Admin parity (4 new module groups)

### 1. Blog (Posts + Categories + Comments)
- New tables: `blog_categories`, `posts`, `post_comments`.
- Posts: title, slug, cover image, excerpt, body (markdown/HTML), category, status (draft/published), SEO title/description, author, published_at.
- Admin routes: `/admin/posts`, `/admin/posts/new`, `/admin/posts/$id`, `/admin/blog-categories`, `/admin/comments` (moderation queue: approve / reject / spam).
- Public routes: `/blog`, `/blog/$slug` with SEO head, OG image from cover.
- RLS: admins full access; published posts/approved comments readable by anon.

### 2. Reviews & Ratings (per store)
- New table: `store_reviews` (store_id, user_id, rating 1–5, title, body, status).
- Admin route `/admin/reviews` with moderation (pending/approved/rejected) + delete.
- Show approved reviews + average rating on store detail page.
- Authenticated users can submit one review per store (RLS).

### 3. Reports & Analytics + CSV export
- Admin route `/admin/reports` with charts (Recharts) and date-range filter:
  - Clicks per day, top 10 stores, top 10 coupons, conversion funnel (impressions → clicks), AI search top queries.
- Server fn `exportReport({ kind, from, to })` returning CSV via a `/api/admin/reports/export` server route (admin-gated).

### 4. Roles & Permissions + Activity Log
- Extend `app_role` enum with `editor` and `moderator`.
- New table: `admin_activity_log` (actor_id, action, entity, entity_id, meta jsonb, created_at).
- Server-side helper `logAdminAction(...)` called by all admin mutations.
- Admin route `/admin/roles` to assign roles (admin only).
- Admin route `/admin/activity` showing recent actions with filters.
- Sidebar gating: editors see content modules only; moderators see reviews/comments only.

### Sidebar additions
Add 6 new items: Posts, Blog Categories, Comments, Reviews, Reports, Roles, Activity. Group by section header (Content / Catalog / Marketing / System).

## Part B — Landing page redesign (Midnight Indigo)

### Theme tokens (src/styles.css)
- Background `#0a0a1a`, surface `#141432`, surface-2 `#1e1e5a`, primary `#4f46e5` (indigo-600), accent `#a78bfa` (violet glow).
- Gradient `--gradient-primary: linear-gradient(135deg,#4f46e5,#a78bfa)`.
- Fonts: Outfit (display) + Figtree (body) via `<link>` in `__root.tsx`, `--font-display`/`--font-sans` in `@theme`.
- Glow shadows + soft noise overlay for premium dark feel.

### Page layout (Coupstop section order, our look)
```text
[ Top utility bar: categories nav + login ]
[ Hero: search bar + tagline + animated coupon stack ]
[ Top Categories grid (8 tiles, icon + name) ]
[ Featured Stores logo strip (marquee) ]
[ Today's Top Offers (carousel of large deal cards) ]
[ Trending Coupons (3-col grid) ]
[ Editor's Picks / Hand-picked Deals ]
[ Blog teasers (3 latest posts) ]
[ Newsletter strip (subscribe) ]
[ Footer: 4 columns + payment/partner logos ]
```

- Keep AI Assistant floating bubble + AI search bar in hero.
- Keep `RecommendedForYou` rail (signed-in users) above Trending.
- All sections SSR via server-fn loaders for SEO; lazy-load below-fold images.

## Technical notes

- DB: 5 migrations (blog set, reviews, activity log + role enum extension, posts/comments RLS, grants).
- Server fns live in `src/lib/blog.functions.ts`, `reviews.functions.ts`, `reports.functions.ts`, `admin-log.functions.ts`. Privileged paths gated by `has_role(auth.uid(),'admin')`.
- CSV export uses a TanStack server route at `src/routes/api/admin/reports/export.ts` with bearer-auth + role check inside handler.
- Sidebar reads role from auth context to filter items.
- Public blog/store-review pages use a server publishable client (anon SELECT policies).

## Out of scope (can do later)
Redirects manager, cache/sitemap tools (sitemap is already dynamic), currency/country/language, store SEO per-row editor, tag taxonomy. Will revisit after this batch ships.

## Rollout order
1. Migrations (blog, reviews, activity, role enum).
2. Admin modules + sidebar groups.
3. Public `/blog` + reviews on store page.
4. Landing redesign (theme + sections).
5. Reports dashboard + CSV.
