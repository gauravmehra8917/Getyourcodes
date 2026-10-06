# Pre-publish smoke audit: results (read-only)

## 1. Source
- HEAD in this workspace: `de1207487b8c10e0c396273392dc5bfa6fceac04`. You expected `062d140a…`, and they don't match. Please confirm that `de12074…` is the commit you want to release.
- Workspace: clean, with no uncommitted changes.
- TypeScript check (`tsgo --noEmit`): passes with 0 errors.
- Build log: no errors and no runtime errors recorded. The dev server log has no warning lines.

## 2. The four Lovable warnings
I can't read them from this workspace: they don't appear in the build, runtime, or dev-server logs. They probably come from the issue scanner, which this audit can't open. Please paste their text so I can classify them.

## 3. Smoke matrix (1280px desktop and 375px mobile)
| Route | HTTP | Header/Footer | Mobile overflow | Robots |
|---|---|---|---|---|
| / /stores /categories /deals /blog /about /contact | 200 | yes | none | default (indexable) |
| /coupons | 200 | yes | **FAIL at 375px**: the coupon card row is 792px wide (the article flex row, caused by the `truncate` h3 inside it) | default |
| /privacy /terms /affiliate-disclosure | 200 | yes | none | index,follow |
| /search?q=test | 200 | yes | none | noindex |
| /login /auth | 200 | yes | none | noindex |
| /admin (signed out, shows the login page) | 200 | n/a | none | noindex |
| /sitemap.xml | 200 | n/a | n/a | includes privacy, terms, affiliate-disclosure, about, contact; excludes /search |

- No page errors appeared in the console on any route.
- Not tested: the admin mobile navigation, the missing Dealio widget in admin (both need a signed-in admin session, and I didn't create one), the coupon reveal dialog, and the dynamic store/category pages. The deal-click path was checked in the source only; I didn't navigate to any affiliate destination.

## 4. Chat/API and headers (source check)
- `/api/chat`: `parseBearerToken` plus a server-side `getUser` check run before the body is read. Unauthenticated requests get a 401.
- Limits are still in place: 96KB body, 40 messages, 24 context messages, 32 parts, 2,000 characters per part, 8,000 total user characters. Tool results are capped at 12–20 coupons and 10 stores. There is a 6-step stop.
- Security headers: `X-Frame-Options: DENY`, and the sensitive-path rules still cover `/admin` and `/admin/*`.

## 5. Release blockers
- No hard blockers.
- **Medium:** the `/coupons` page overflows sideways on phones. It's a layout bug that can wait, but it's worth fixing first because mobile users notice it.
- **Unresolved:** the HEAD mismatch above, and the four warnings I couldn't read.

## 6. Safety
No code edits, SQL, migrations, deployments, publishing, or Impact/Ads/canary/newsletter calls happened. The only file written is this report. The browser checks ran against the local preview only.

## Optional next step (needs approval)
Fix the `/coupons` overflow on phones by adding `min-w-0` and `overflow-hidden` to the coupon row in the list component.
