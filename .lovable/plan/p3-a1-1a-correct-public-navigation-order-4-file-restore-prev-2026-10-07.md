# P3-A1.1a — Correct public navigation order (4-file restore, preview only, no publish)

## Verified current state (read-only checks, this turn)

- Both dependency files have drifted to `@lovable.dev/vite-tanstack-config` = 2.25.2 (`package.json` line 76 and `bun.lock` both re-verified locally just now). Approved state is 2.23.1 in both — full manifest/lock drift, matching your independent check.
- Both source files are byte-identical to the approved parent `ea3fc6b…` — local blob hashes match the parent's GitHub blobs exactly:
  - `src/components/site-header.tsx` = `1376c07…`
  - `src/components/public-search.test.ts` = `98b9e8c…`
- Approved commit `63b68ec…` ("fix: correct primary navigation order"), parent `ea3fc6b…`, verified via GitHub API: it changes exactly the two source files, to blobs:
  - `src/components/site-header.tsx` → `27b4e7a8b5f06c9fd7dd88b8a5417599fb1a968e`
  - `src/components/public-search.test.ts` → `a3daab02aeb73828f9f8043066e7c2284e30517e`
- `package.json` and `bun.lock` blobs at `63b68ec…` (i.e. the approved 2.23.1 bytes) will be fetched and hash-verified in step 1 before overwriting.
- Current nav order (both source files) is Home → Stores → Categories → …, the pre-change state, as expected.

## Execution steps

1. Download all four approved files from GitHub commit `63b68ec…` via the GitHub API (public read access, verified): the two source files plus `package.json` and `bun.lock`. Verify each blob SHA against that commit before any overwrite.
2. Overwrite the four workspace files with the approved bytes — whole-file restore for `package.json` and `bun.lock`, not a hand-edited version string.
3. Verify `bun.lock` and `package.json` blobs hash-match `63b68ec…` after the platform rebuild; if the rebuild rewrites either, restore BOTH from approved bytes again and re-verify before stopping.
4. Run the focused test: `bun test src/components/public-search.test.ts` — the transplanted test's `expectedNav` must assert Home → Categories → Stores → Coupons → Deals → Blog for BOTH the md+ ribbon and the mobile menu; all tests must pass.
5. Run the TypeScript check (`tsgo`); confirm the platform build log shows "build OK".
6. Optional visual confirmation via Playwright at desktop and mobile widths: header ribbon and mobile menu show Home, Categories, Stores, Coupons, Deals, Blog.

## Strictly not done

No publish/deploy, no Edge Function changes, no SQL/migrations/RLS, no database or production mutations, no Impact/affiliate/newsletter calls, no changes to P3-A1 admin files, breakpoints/layout, search/auth/Dealio logic, mobile-menu behavior, styles.css, routeTree.gen.ts, public routes/footer, or any file beyond the four approved files. P3-A2 not started.

## Return

- Exact changed files (4); resulting Lovable source SHA.
- Hash-match confirmation of all four files against `63b68ec…`.
- Focused test result; TypeScript/build result.
- Confirmation nav order is Home → Categories → Stores → Coupons → Deals → Blog in both ribbon and mobile menu.
- Confirmation NO publish occurred.

STOP after preview-ready source update.
