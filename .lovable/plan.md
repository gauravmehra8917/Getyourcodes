# Admin Control-Plane Audit (read-only, source only)

No files edited apart from this report, no SQL run, no functions called, no data changed. RLS and live data were not checked, so claims about them are marked "unverified".

Shared pattern ("SILENT"): most simple CRUD screens call `await sb.from(x).insert/update/delete` and never check `error`. They close the modal and refresh the list anyway. A write blocked by RLS looks like it worked until the list reloads without the change. Deletes use `confirm()` and nothing else.

Legend: Wired = writes to the database or a server function. Consumer = something on the public site reads the data.

## Overview
| Tab | Route file | Actions | Wired | Consumer | Errors | Class |
|---|---|---|---|---|---|---|
| Dashboard | admin.index.tsx | none (counts plus recent coupons) | read-only | n/a | reads ignore errors | optional |
| Reports | admin.reports.tsx | Export CSV (client side) | reads coupon_clicks, coupons, categories | data comes from public click tracking | error only goes to console.error; looks the same as "no clicks" | useful |
| Activity Log | admin.activity.tsx | read-only list | admin_activity_log + profiles | written by the log_admin_activity trigger and integrations.functions | errors not shown | useful |

## Catalog
| Tab | Route file(s) | Actions | Wired | Consumer | Errors / gaps | Class |
|---|---|---|---|---|---|---|
| Coupons | admin.coupons.{tsx,index,new,$id}.tsx | Add, Edit (form save), Delete | yes | yes (home-data, $slug, coupons/deals) | form shows the save error; **list Delete is SILENT**. No guard for imported rows (provider, provider_entity_id). Deleting an imported coupon lets the next import bring it back. No start_date/landing_page_url fields in the UI | launch-critical |
| Categories | admin.categories.tsx | Add, Edit, Delete | yes | yes | save shows errors; **Delete SILENT** (fails on an FK if stores reference the category, with no message) | launch-critical |
| Sub Categories | admin.subcategories.*.tsx | Add, Edit, Delete | yes | **no public consumer found** | form shows errors; Delete SILENT | optional / standalone |
| Stores | admin.stores.*.tsx | Add, Edit, Delete, logo action (alert on failure) | yes | yes ($slug with lifecycle filter, sitemap) | form shows errors; **Delete SILENT**, with no cascade warning for coupons. The edit form has no lifecycle_hidden/lifecycle_managed controls and no imported-row protection | launch-critical |
| Store Reviews | admin.reviews.tsx | Approve, Reject, Delete | yes | public review display assumed (not traced) | all SILENT | useful |

## Content
| Tab | Route | Actions | Wired | Consumer | Errors / gaps | Class |
|---|---|---|---|---|---|---|
| Posts | admin.posts.*.tsx + post-form | Add, Edit, Delete | yes | yes (/blog, /blog/$slug, sitemap) | list Delete SILENT | useful |
| Blog Categories | admin.blog-categories.tsx | Add, Edit, Delete | yes | used by blog | SILENT | optional |
| Comments | admin.comments.tsx | Approve, Reject, Spam, Delete | yes | blog comments | SILENT | optional |
| Pages | admin.pages.tsx | Add, Edit, Delete | yes | **partial**: only sitemap.xml reads `pages`, for lastmod on fixed slugs (STATIC_SLUG_TO_PATH). /about, /privacy, /terms and the other public pages are hardcoded. Edited page content and meta are **never shown** | SILENT | dead-ish / misleading |
| Sliders | admin.sliders.tsx | Add, Edit, Delete | yes | **no public consumer** | SILENT | dead UI |
| Ads | admin.ads.tsx | Add, Edit, Delete | yes | **no public consumer** | SILENT | dead UI |

## Audience
| Tab | Route | Actions | Wired | Consumer | Errors / gaps | Class |
|---|---|---|---|---|---|---|
| Users | admin.users.tsx | read-only | profiles + user_roles | n/a | no role grant/revoke, no email (profiles has none). Showing all users depends on admin SELECT policies on profiles and user_roles (unverified) | useful-but-incomplete |
| Subscribers | admin.subscribers.tsx | Toggle active, Delete, Export CSV | yes | used by send-newsletter | toggle and delete SILENT | useful |
| Newsletters | admin.newsletters.tsx | Send now, which invokes the `send-newsletter` edge function | yes | function writes newsletter_logs (success, failure and empty cases) | invoke errors are caught and shown. History reads newsletter_logs | useful |

## System
| Tab | Route | Actions | Wired | Consumer | Errors / gaps | Class |
|---|---|---|---|---|---|---|
| Menus | admin.menus.tsx | Add, Edit, Delete | yes | **no consumer**: header and footer links are hardcoded | SILENT | dead UI |
| Translations | admin.translations.tsx | Add, Edit, Delete | yes | **no consumer** (no i18n lookup anywhere) | SILENT | dead UI |
| Theme | admin.theme.tsx | Save Theme, which upserts site_settings `theme.*` | yes | **no consumer**: nothing outside admin reads site_settings. Colors, logo, favicon and font have no effect | upsert error ignored; "Saved" shows regardless | dead UI / misleading |
| Head Manager | admin.head-manager.tsx (+ import-snippet-dialog) | Add, Edit, Toggle, Delete, Import snippet | yes | **yes**: getEnabledHeadEntries is rendered in __root head | errors shown (setError / alert) | launch-relevant (verification tags) |
| Email Templates | admin.etemplates.tsx | Add, Edit, Delete | yes | **no consumer**: send-newsletter never reads email_templates | SILENT | dead UI |
| API Integrations | admin.integrations.tsx + integrations.functions.ts | Create, Edit, Toggle, Delete, Test, Sync Logos, **Import Impact Coupons** | server functions with requireSupabaseAuth; logs to admin_activity_log | import writes stores and coupons that the public site uses | Import calls `runImpactCouponImport`, which goes to **affiliate-sync-ads-apply-v2** (the Ads/coupon path). **The UI has no button for the deals-only `affiliate-sync-apply-v2` flow.** It is reachable only by calling the function directly. Import errors map to an "indeterminate" result, so the cause is not shown | launch-critical |
| Publishing Policies | admin.publishing-policies.tsx + publishing-policies.functions.ts | Add, Edit, Delete, Set default/enable (inline button), move ranking up/down | server functions | read by the import and publishing pipeline (publishing_policy_id) | save errors shown; delete errors use alert | useful |
| Settings | admin.settings.tsx | Update Settings shows `alert("Settings UI is a placeholder…")` | **not wired** | none | inputs are uncontrolled defaults with hardcoded contact details | placeholder / dead UI |

## Disabled or unavailable actions
Hardcoded unavailable actions: only the Settings placeholder alert. The other disabled states are normal busy, pagination or ordering guards.

## Launch blockers vs follow-ups
- Not blocking, but misleading: Settings, Theme, Menus, Sliders, Ads, Translations and Email Templates all save but nothing on the public site reads them. Pages edits are not rendered either.
- Risk: silent write failures on most CRUD screens, plus deletes of imported stores or coupons with no warning about re-import or provider ownership.
- Gap: no admin button for the deals-only import.
- Unverified: admin read access to profiles and user_roles for the Users tab.

## Next steps (only if you approve later)
1. Show write errors on all CRUD screens.
2. Hide the dead tabs, or connect them to the public site.
3. Protect imported rows from edit and delete.
4. Add a deals-only import button.
