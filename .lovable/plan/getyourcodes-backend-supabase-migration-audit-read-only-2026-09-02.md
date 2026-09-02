# GetYourCodes — Backend & Supabase Migration Audit (read-only)

Nothing was changed. All findings below come from live catalog queries against the current production database plus a full read of `src/` and `supabase/`. Items I could not confirm are marked NOT VERIFIED.

## A. Executive summary

**Ready with fixes.** The schema, functions, triggers, RLS and Edge Functions are all reproducible, and the live data volume is small (6 stores, 8 coupons, 12 categories, 1 auth user, 2 subscribers, 225 storage objects, 3,283 audit rows). The blocking issues are not data-shape issues — they are history and configuration issues: five migration files are not recorded in the applied-migration ledger, admin rights depend on a first-user trigger plus a single existing user id, and every secret / storage object / Edge config must be recreated by hand.

**Readiness score: 72/100.** Critical: 3 · High: 5 · Medium: 6 · Low: 4. Database migration can begin on a staging Supabase project now; production cutover should wait until the three critical items are closed.

## B. Backend inventory (verified counts)

| Item | Count |
| --- | --- |
| Public tables | 33 |
| Views / materialized views | 0 / 0 |
| Public PostgreSQL functions | 17 (11 SECURITY DEFINER) |
| Functions called as RPC from app | 5 (`import_apply`, `subscribe_email`, `unsubscribe_by_token`, `get_top_searches`, `get_top_ai_searches`) |
| Triggers (public) | 30 (audit `trg_log_activity` on 10 tables, `updated_at` on 18, plus 2 auth-user triggers on `auth.users` — NOT VERIFIED, `auth` schema not readable from this session) |
| RLS policies (public) | 74 across all 33 tables; RLS enabled on every table, zero exceptions |
| Storage policies | 4 (`store-logos`, all `authenticated`-scoped) |
| Enums | 3 (`app_role`, `coupon_status`, `coupon_type`) |
| Extensions | `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql` |
| Storage buckets | 1 (`store-logos`, public, no size limit, 225 objects) |
| Edge Functions | 5 (`send-newsletter`, `affiliate-sync-preflight`, `affiliate-sync-preview`, `affiliate-sync-preview-v2`, `affiliate-sync-apply-v2`) |
| Cron jobs | 0 — `cron.job` does not exist; pg_cron is not installed. Newsletter sending is manual only |
| Migration files | 47 |
| Applied-migration ledger rows | 43, newest `20260810081805` |
| Env vars referenced in code | 10 distinct |
| External services | Impact affiliate API, Resend, Lovable AI gateway, Google Search Console meta tag |

## C. Critical migration blockers

1. **Migration ledger is 5 files behind the repository.** Files `20260810090000_import_orchestration`, `20260810100000_store_lifecycle_foundation`, `20260810110000_store_lifecycle_persistence`, `20260819090000_affiliate_sync_v2_persistence`, `20260826160000_affiliate_sync_v2_contention_revalidation` are **not** in `supabase_migrations.schema_migrations`, yet their objects exist in production (orchestration columns, lifecycle columns, `apply_affiliate_persistence_plan_v2`, the six `affiliate_sync_v2_*` validators, `affiliate_import_run_mutations_v2`). On a fresh project, running the folder in filename order does reproduce them — but the ledger cannot be used to prove parity, so schema equivalence must be proved by diff, not by ledger.
2. **Admin access is bootstrap-dependent.** `handle_new_user_role` promotes the *first* auth user to `admin`; every admin RLS policy resolves through `is_admin(auth.uid())` against `public.user_roles.user_id`, which is a FK to `auth.users.id`. If auth users are re-created with new UUIDs during migration, `user_roles` (1 row), `profiles` (1 row), `admin_activity_log.actor_id` (3,283 rows) and `affiliate_integrations.created_by` all break, and whoever signs up first on the new project silently becomes admin. Auth users must be transferred with **preserved UUIDs**, or `user_roles` must be re-seeded immediately after cutover.
3. **Encrypted affiliate credentials are keyed to `INTEGRATION_CREDENTIAL_SECRET`.** `affiliate_integration_credentials` holds 1 ciphertext row and the table is fully locked (0 policies, no anon/authenticated access). Copying the row without carrying the exact same secret value into the new project makes Impact sync fail at decrypt with no obvious error. This secret is not in `.env` and is Edge-only.

## D. Migration-compatibility classification

GREEN — redeploy as-is: enums, extensions, `updated_at` triggers, audit trigger + `log_admin_activity`, all 74 RLS policies (no Lovable-specific predicates found; all resolve through `is_admin()` or `auth.uid()`), SEO code (`SITE_URL` is already the hardcoded literal `https://getyourcodes.com`; no `dealio-dash.lovable.app` remains in shipped code), translations table (0 rows), reports queries.

YELLOW — needs configuration: frontend env (`VITE_SUPABASE_URL` / `_PUBLISHABLE_KEY` / `_PROJECT_ID` become Vercel env vars), `src/lib/mcp/index.ts` (builds the OAuth issuer from `VITE_SUPABASE_PROJECT_ID` — follows automatically, but MCP client registrations must be re-authorized), `src/integrations/supabase/previewAuthStorage.ts` (Lovable preview-zone list; harmless on Vercel but dead code), `supabase/config.toml` (`project_id` plus the four `verify_jwt = false` blocks must be recreated), generated types (`src/integrations/supabase/types.ts` must be regenerated against the new ref), storage objects (225 files must be copied bucket-to-bucket; SQL does not move them and `stores.logo_url` stores absolute URLs that will need rewriting), Resend (`RESEND_API_KEY`, `NEWSLETTER_FROM_EMAIL=news@getyourcodes.com`, `SITE_URL`; DNS SPF/DKIM for getyourcodes.com must exist on the sending domain).

RED — special work: the 5 unledgered migrations (C1), auth user transfer incl. the one Google identity (password hash export from a Lovable-managed project is NOT VERIFIED — assume email/password users may need a reset), `INTEGRATION_CREDENTIAL_SECRET`, and `import_apply` / `apply_affiliate_persistence_plan_v2` which must remain byte-identical because the V2 apply host sends a `sha256-canonical-plan-v1` fingerprint the function re-validates.

## E. Notable per-area findings

- **Schema/data integrity is clean.** Zero duplicate store or category slugs, zero orphan coupons, zero orphan clicks, zero orphan store→category refs, zero duplicate subscriber emails. Two low-severity items: 1 coupon has `status='active'` with a past `expiry_date` (no expiry job exists — pg_cron is absent), and 2 of 6 stores have `provider IS NULL` (manual legacy stores; `import_apply` treats these as legacy-store matches).
- **Unused / empty tables (13):** `ads`, `blog_categories`, `posts`, `post_comments`, `pages`, `menus`, `sliders`, `email_templates`, `translations`, `newsletter_logs`, `subcategories`, `saved_coupons`, `saved_stores`, plus `affiliate_import_run_mutations_v2` and `publishing_rotation_state` at 0 rows. Schema still required — the admin UI reads all of them.
- **Reports zero-values:** the previously reported cause (`created_at` vs `clicked_at` on `coupon_clicks`) is fixed in code; the remaining reason numbers look small is simply data volume — 13 clicks, 40 searches. No view or materialized view backs Reports, so nothing can be lost in migration beyond the raw tables.
- **Auth surface:** email/password + Google OAuth, forgot/reset password, `/_authenticated/*` route gate, admin guard in `src/routes/admin.tsx` (client-side) backed by `is_admin()` in RLS and by explicit admin re-checks inside the Edge Functions. Redirect/callback URLs and the Google provider must be reconfigured in the new project.
- **Edge Functions:** all four affiliate functions run `verify_jwt = false` and verify the bearer token themselves, then check the admin role; `send-newsletter` uses `SUPABASE_SERVICE_ROLE_KEY`. CORS allow-lists include Lovable preview origins and must be re-pointed at getyourcodes.com. None are scheduled.
- **Secrets exposure:** none found in frontend code. Only the publishable key, URL and project id reach the browser, which is correct.

## F. Recommended sequence

1. Create the new Supabase project; enable `pgcrypto`, `uuid-ossp`.
2. Run all 47 migrations in filename order on an empty staging project, then diff the resulting schema against production (`pg_dump --schema-only`) and resolve any delta before touching production.
3. Recreate secrets: `INTEGRATION_CREDENTIAL_SECRET` (exact same value), `RESEND_API_KEY`, `NEWSLETTER_FROM_EMAIL`, `SITE_URL`.
4. Transfer `auth.users` and `auth.identities` with preserved UUIDs; verify the admin user id matches the existing `user_roles` row before importing any public data.
5. Data order (from real FK graph): `categories` → `subcategories` → `stores` → `coupons` → `publishing_policies` → `affiliate_integrations` → `affiliate_integration_credentials` → `affiliate_import_runs` → `affiliate_import_run_mutations_v2` → `blog_categories` → `posts` → `post_comments` → `pages` → `store_reviews` → `saved_*` → `coupon_clicks` → `search_queries` → `subscribers` → `translations` / `site_settings` / `head_entries` / `menus` / `sliders` / `ads` / `email_templates` → `admin_activity_log` last (import with triggers disabled so the audit trigger does not regenerate rows).
6. Copy the 225 `store-logos` objects, then rewrite absolute logo URLs in `stores`.
7. Deploy the 5 Edge Functions, recreate `config.toml`, regenerate types, point Vercel env at the new project, then switch DNS.
8. Rollback: keep the Lovable project untouched and running until validation passes; reverting is a DNS/env change back to the old ref, provided no writes were made on the new project during validation.

## G. NOT VERIFIED (needs manual check)

- Contents of `auth` schema (users, identities, triggers on `auth.users`) — this session has no `auth` read permission; the two auth triggers are inferred from function names.
- Whether the applied production schema is byte-identical to the 5 unledgered migration files (only object existence was confirmed).
- Whether password hashes can be exported from the Lovable-managed project.
- Whether Impact / Google Search Console / Resend accounts need callback or domain re-verification for the new backend host.

Nothing in this audit changed code, schema, policies, secrets or deployments.
