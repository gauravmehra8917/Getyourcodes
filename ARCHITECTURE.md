# Getyourcodes Architecture

> Living technical reference for contributors and future coding sessions.  
> Last reviewed: 2026-08-07  
> Scope: repository structure and static code review. Update this document whenever a major module, data flow, or deployment responsibility changes.

## System overview

Getyourcodes is a coupon, promo-code, and deals website. It combines a public content and commerce-discovery experience with an admin-operated affiliate-ingestion pipeline.

The application is a TypeScript React application using TanStack Start and Vite. Supabase supplies PostgreSQL, authentication, row-level security (RLS), storage, server-side RPCs, and an Edge Function. Affiliate data is ingested through a provider-neutral framework, normalized to a canonical model, evaluated by publishing policies, then written into the public catalogue.

```text
Affiliate API
  -> Integration Engine
  -> Provider Adapter
  -> Enrichment
  -> Normalization
  -> Sync Engine
  -> Import Planning + Validation + Dedupe
  -> Publishing Policy
  -> Supabase import_apply RPC
  -> stores / categories / coupons
  -> public TanStack routes
```

## Technology stack

| Area | Technology |
| --- | --- |
| Language | TypeScript, ESM |
| UI | React 19, Tailwind CSS 4, Radix UI, Lucide |
| Application framework | TanStack Start, TanStack Router, Vite |
| Client data | TanStack React Query |
| Database/backend | Supabase PostgreSQL, Auth, Storage, RLS, RPC |
| Validation | Zod |
| AI | Vercel AI SDK with Lovable AI gateway |
| Email | Supabase Edge Function + Resend |
| MCP | `@lovable.dev/mcp-js` |
| Styling/helpers | clsx, CVA, tailwind-merge |
| Build/runtime | Nitro is provided through the Lovable TanStack Vite configuration |

Package scripts:

- `npm run dev` — development server
- `npm run build` — production build
- `npm run preview` — preview build
- `npm run lint` — lint
- `npm run format` — format/write

There is currently no test script or checked-in CI workflow.

## Repository layout

```text
.
├── public/
│   ├── robots.txt
│   └── llms.txt
├── src/
│   ├── components/
│   │   ├── admin/                 # Admin views and workflow components
│   │   ├── ui/                    # Reusable Radix/shadcn-style primitives
│   │   └── ...                    # Public-site components
│   ├── integrations/
│   │   ├── supabase/              # Browser/admin clients, generated types, auth middleware
│   │   └── lovable/               # Lovable OAuth integration
│   ├── lib/
│   │   ├── enrichment/            # Provider metadata enrichment
│   │   ├── head/                  # Global head-tag manager
│   │   ├── import/                # Plan, validation, matching, persistence
│   │   ├── integration-engine/    # Generic outbound HTTP layer
│   │   ├── mcp/                   # MCP server and tools
│   │   ├── normalizers/           # Canonical entity conversion
│   │   ├── presentation/          # SEO, terms, logo sync, lifecycle
│   │   ├── providers/             # Adapter contract/factory/adapters
│   │   ├── publishing-policy/     # Offer-selection policy engine
│   │   ├── sync/                  # Fetch/paginate/normalize orchestration
│   │   └── ...                    # DB, home ranking, analytics, AI, shared utilities
│   ├── routes/                    # File-based TanStack routes
│   ├── router.tsx
│   ├── server.ts                  # SSR error wrapper and cache headers
│   └── start.ts
├── supabase/
│   ├── functions/send-newsletter/
│   └── migrations/
├── package.json
└── vite.config.ts
```

## Routing

Routes are file-based under `src/routes`.

### Public routes

- `/` — homepage
- `/stores`, `/categories`, `/coupons`, `/deals`
- `/search`
- `/blog` and `/blog/$slug`
- `/$slug` — dynamic store/category pages
  - `/<store>-coupons`
  - `/<category>-offers`
- `/about`, `/contact`, `/unsubscribe`

### Authentication and account routes

- `/auth` — regular email/password and Google OAuth
- `/login` — admin-oriented login screen
- password-recovery/reset routes
- `/_authenticated/*` — protected user account area

### Admin routes

`/admin/*` covers dashboard, stores, coupons, categories, subcategories, CMS, blog, reviews, subscribers, newsletters, analytics, affiliate integrations, publishing policies, and Head Manager.

The admin shell performs a client-side role check for navigation/UI. Sensitive server functions also validate the bearer token and verify the `admin` role; Supabase RLS protects direct database operations.

### Server and machine-facing routes

- `/api/chat` — Dealio AI assistant
- `/sitemap.xml` — generated sitemap
- `/mcp` and `/.mcp/*` — MCP server and tool endpoints

## Supabase and data model

### Client separation

- `src/integrations/supabase/client.ts` is the browser client. It uses the publishable key and browser-local session persistence.
- `src/integrations/supabase/client.server.ts` is server-only and uses the Supabase service-role key. It bypasses RLS and must never be imported into browser code.
- `src/integrations/supabase/auth-middleware.ts` validates a bearer token using Supabase claims and adds an authenticated Supabase client and user ID to server-function context.

### Main tables

| Domain | Tables / purpose |
| --- | --- |
| Roles and accounts | `user_roles`, `profiles`, `chat_messages` |
| Catalogue | `categories`, `subcategories`, `stores`, `coupons` |
| Personalization | `saved_coupons`, `saved_stores` |
| Analytics | `coupon_clicks`, `search_queries` |
| CMS | `pages`, `posts`, `blog_categories`, `post_comments`, `sliders`, `menus`, `ads`, `translations`, `site_settings`, `email_templates` |
| Community | `store_reviews` |
| Operations | `admin_activity_log`, `newsletter_logs`, `subscribers` |
| Affiliate | `affiliate_integrations`, `affiliate_integration_credentials`, integration tests, `affiliate_import_runs` |
| Publishing | `publishing_policies`, `publishing_rotation_state` |
| SEO | Entity SEO fields and `head_entries` |

The primary catalogue relationship is:

```text
Category 1 --- * Store 1 --- * Coupon
```

Coupons represent both code-based offers and no-code deals through the `coupon_type` field. Public RLS allows only active coupons to be read by anonymous users.

### Database responsibilities

Supabase migrations define:

- enums for roles, coupon type, and coupon lifecycle
- RLS policies for public, user-owned, and admin-only data
- profile/role triggers
- public subscription/unsubscribe RPCs
- `import_apply(jsonb)`, the transactional import RPC
- activity/audit triggers
- storage policies for public merchant-logo assets

## Authentication and authorization

Regular users authenticate with Supabase email/password or Lovable-mediated Google OAuth. Account users can save offers and stores and persist chat messages.

Admin authorization is role-based through `user_roles`. The first user created in Supabase is automatically promoted to admin by a database trigger; subsequent users receive the standard `user` role. This is a bootstrap convenience and should be treated carefully in production.

Security boundaries:

- Browser clients operate under RLS.
- Server functions use `requireSupabaseAuth` and explicit admin checks for privileged work.
- Service-role access is isolated in `.server.ts` modules.
- Affiliate credentials are stored encrypted, not as plain-text fields.

## Public website

### Homepage

The homepage has:

- hero search and Dealio AI entry point
- featured deals
- trending stores
- latest coupon codes
- personalized recommendations
- category browsing
- recent blog posts
- newsletter signup

Homepage ranking is derived from store/category data plus active-offer counts in `src/lib/home-data.ts`.

### Search

`/search` performs direct Supabase queries for:

- store names
- active coupon titles
- category names

The search page is marked `noindex`. The AI assistant and MCP search tools also query active coupons/stores, with percent/underscore stripped from search input before constructing `ILIKE` patterns.

### Store and category pages

Dynamic `/$slug` routes use suffixes to distinguish entities:

- store: `/<slug>-coupons`
- category: `/<slug>-offers`

Store pages server-load the store and active offers. Category pages server-load the category, then client-fetch related stores and offers.

### Blog and CMS

Blog posts live in `posts` and published entries are publicly readable. The blog index is paginated client-side; the article route provides per-post metadata.

The admin CMS includes pages, menus, sliders, ads, translations, email templates, and site settings. When adding a new CMS feature, confirm it has both:

1. an admin editing surface, and
2. a public rendering/query path.

## SEO and global head management

SEO is implemented through route `head` functions and `src/lib/seo.ts`.

Features include:

- title, description, Open Graph, Twitter metadata
- canonical URLs
- JSON-LD for organization, website, breadcrumbs, stores, and offers
- `robots.txt`, `llms.txt`, and a dynamic sitemap
- per-entity SEO fields for stores, categories, coupons, posts, and pages
- Head Manager entries rendered by `src/lib/head/render.ts`

The Head Manager supports verification tags, analytics scripts, structured data, and sanitized custom head HTML. It is an admin-only, high-trust feature because it can intentionally inject scripts into every public page.

The sitemap currently lists static routes, stores, categories, and published blog posts.

## Affiliate integration architecture

### Integration records and credentials

An affiliate integration stores provider metadata, base URL, endpoints, retry/timeout options, status, and optional publishing-policy assignment.

Secrets are held in the separate `affiliate_integration_credentials` table. `src/lib/integration-crypto.server.ts` encrypts/decrypts them with `INTEGRATION_CREDENTIAL_SECRET`.

### Generic Integration Engine

`src/lib/integration-engine/` provides reusable outbound HTTP capabilities:

- config loading and validation
- URL/path/query/header construction
- placeholder resolution such as `{AccountSID}`
- API key, bearer, basic, OAuth2-token, and custom-header authentication
- request timeout
- retry/backoff and rate-limit response handling
- standardized response shape
- bounded response reads (default 5 MB)
- debug/request logging

OAuth2 access-token use is supported; client-credential token exchange and refresh are not implemented.

### Provider adapters

`ProviderFactory` resolves provider aliases and constructs an adapter.

Configured keys:

- `impact`
- `cj`
- `awin`
- `rakuten`
- `shareasale`
- `custom_rest`

Only Impact currently has a complete normalizer and substantive adapter implementation. The other adapters are placeholders and should not be treated as production ingestion paths until both adapter and normalizer support are implemented.

### Impact

`ImpactAdapter` maps:

- Campaigns -> stores
- Promotions -> coupons and deals
- Coupon Ads + Campaigns -> optional enrichment sources
- Catalogs -> available as an adapter call

Impact offer enrichment loads coupon-ad and campaign data, then augments raw promotion records with provider-supplied:

- tracking links
- coupon code
- description
- landing page
- discount
- terms
- start/end dates
- currency
- country and shipping regions
- matching diagnostics

## Normalization, sync, and import pipeline

### Canonical model

Normalizers convert provider-specific data into canonical:

- `CanonicalStore`
- `CanonicalCoupon`
- `CanonicalDeal`
- `CanonicalCategory`

The normalizer should preserve provider identity and useful source metadata. It must not write to the database.

### Sync Engine

`SyncEngine` orchestrates pagination and normalization. It:

1. creates the adapter and normalizer for an integration;
2. fetches pages by entity type;
3. optionally enriches offer pages;
4. normalizes raw payloads;
5. tracks progress, warnings, errors, and statistics;
6. returns a provider-neutral `SyncResult`.

Default admin sync settings are currently page size 100 and maximum two pages.

### Import Pipeline

The import pipeline is deliberately separated into stages:

1. Load existing rows.
2. Validate individual canonical records.
3. Deduplicate provider identities.
4. Match existing stores/categories by provider ID, then slug.
5. Resolve offer-to-store references.
6. Build an `ImportPlan`.
7. Optionally apply a publishing policy.
8. Preview the plan or call `import_apply`.
9. Record import history and optional presentation/coverage information.

`ImportExecutor` creates a JSON payload, then calls the single transactional `public.import_apply` RPC. The RPC creates/updates categories, stores, coupons, and deals as one database transaction.

### Presentation after import

After a committed import, the application can:

- generate deterministic SEO defaults
- generate terms text from provider-supplied structured terms
- cache provider store logos in Supabase Storage
- report coverage for hosted logos, descriptions, and terms

## Publishing Policy Engine

The policy engine runs after planning and before persistence.

A policy can:

- skip expired or non-active offers
- respect manually disabled records supplied through policy context
- set per-store minimum/maximum coupon/deal counts
- rank by merchant priority, discount, newness, and expiry
- distribute offers fairly across merchants
- rotate selections across runs

Rotation cursor state is stored in `publishing_rotation_state`.

When changing publication behavior, keep these layers aligned:

- `src/lib/publishing-policy/` for selection decisions
- `src/lib/presentation/publishing.ts` for lifecycle status
- `ImportExecutor` for payload creation
- `import_apply` SQL for final persisted status

## Newsletter and Edge Function

The only Supabase Edge Function is `supabase/functions/send-newsletter/index.ts`.

It:

1. verifies that the caller is an authenticated admin;
2. finds active, verified subscribers;
3. finds newly created active, unexpired coupons since the previous successful send;
4. renders escaped HTML;
5. sends individual messages through Resend;
6. writes a summary to `newsletter_logs`.

Public unsubscribe is handled by a token-based `unsubscribe_by_token` RPC.

There is no scheduler or cron configuration in the repository. Imports and newsletters are manually triggered from the admin interface.

## AI and MCP

### Dealio AI assistant

`/api/chat` uses the Lovable AI gateway and a Gemini-compatible model. It exposes tools that query active coupons and stores and instructs the model not to invent offers.

Authenticated users can save and load conversation history via server functions and the `chat_messages` table.

### MCP

The MCP server uses Supabase OAuth. It exposes:

- `search_coupons`
- `search_stores`
- `list_my_saved_coupons`

The saved-coupons tool uses the caller's token and RLS, while public search tools operate over public active catalogue data.

## Environment configuration

Expected environment variables include:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Browser Supabase URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser publishable key |
| `VITE_SUPABASE_PROJECT_ID` | MCP OAuth issuer project reference |
| `SUPABASE_URL` | Server/Edge Supabase URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server public-key client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only RLS-bypass client |
| `INTEGRATION_CREDENTIAL_SECRET` | Affiliate credential encryption key material |
| `LOVABLE_API_KEY` | AI gateway access |
| `RESEND_API_KEY` | Newsletter email delivery |
| `NEWSLETTER_FROM_EMAIL` | Verified Resend sender |
| `SITE_URL` | Newsletter/public-site base URL |

Do not commit secret-bearing environment files. Publishable Supabase values are expected to be exposed to the browser; service-role and integration encryption secrets are not.

## Operational constraints and known gaps

These are important current constraints, not guarantees of future behavior:

- Only Impact is a complete ingestion path.
- No queue, worker, cron, or scheduled import runner exists.
- Importing is request-bound and default runs are capped at two pages per entity.
- Search is simple `ILIKE` matching, not full-text search.
- The homepage performs broad client-side ranking/count work.
- CMS pages require explicit public-route support to be visible.
- The sitemap needs pagination/sitemap-index support before very large catalogues.
- There is no repository test suite or CI workflow.
- The current first-user-is-admin bootstrap should be reviewed before production launch.
- Admin-configured external API/logo/head-script capabilities are high-trust surfaces and require careful access control.

## Contributor guidelines

When adding a feature:

1. Keep browser code on the publishable Supabase client and RLS.
2. Keep service-role imports in server-only modules.
3. Add Zod validation at server-function/API boundaries.
4. Preserve the pipeline boundary: adapters fetch, normalizers map, sync orchestrates, import plans, the RPC persists.
5. Add provider support in both the adapter and normalizer factories.
6. Update migrations, generated Supabase types, and this document together when changing schema.
7. Add a public render/query path for every new CMS-managed entity.
8. Update SEO metadata and sitemap behavior for indexable public routes.
9. Consider pagination, indexing, rate limiting, and retention before expanding high-volume features.
10. Update this document when the architecture changes materially.
