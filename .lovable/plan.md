# P3-A1.1a — Correct public navigation order (preview only, no publish)

## Verified current state (read-only checks, this turn)

- Workspace HEAD is `b18d3e4` ("Work in progress"), one platform auto-commit beyond the expected `f90ac027…`. That extra commit changed ONLY `package.json`, bumping `@lovable.dev/vite-tanstack-config` from `2.23.1` to `2.25.2`.
- `bun.lock` still pins `2.23.1`. So the preflight claim "package.json and bun.lock both use 2.23.1" is NOT currently true: `package.json` = 2.25.2, `bun.lock` = 2.23.1. This is the same drift pattern the P3-A1.1 amendment already resolved once.
- Both source files are byte-identical to the approved parent `ea3fc6b…` — local blob hashes match the parent's GitHub blobs exactly:
  - `src/components/site-header.tsx` = `1376c07…`
  - `src/components/public-search.test.ts` = `98b9e8c…`
- Approved commit `63b68ec…` ("fix: correct primary navigation order"), parent `ea3fc6b…`, changes EXACTLY two files (verified via GitHub API):
  - `src/components/site-header.tsx` → blob `27b4e7a8b5f06c9fd7dd88b8a5417599fb1a968e`
  - `src/components/public-search.test.ts` → blob `a3daab02aeb73828f9f8043066e7c2284e30517e`
- Current nav order (both files) is Home → Stores → Categories → Coupons → Deals → Blog, i.e. the pre-change state, as expected.

## Drift-restore amendment (flagged, needs your approval)

Your instructions say "do not modify package.json", but the platform has already modified it (to 2.25.2) since your preflight. To honor the intent — approved state = `2.23.1` in both files, per the P3-A1.1 amendment — this plan restores `package.json` from `2.25.2` back to `2.23.1` as a drift restore, and leaves `bun.lock` untouched (already correct at 2.23.1). If the platform rewrites package.json or bun.lock during rebuild, both are restored to the approved bytes and re-verified before stopping.

If you want package.json left at 2.25.2 instead, reject the plan and say so — the transplant itself is unaffected.

## Execution steps

1. Download both approved files from GitHub commit `63b68ec…` via the GitHub API (public read access, verified).
2. Verify each downloaded blob SHA equals the approved blobs above, then overwrite the two workspace files in place.
3. Restore `package.json` to `@lovable.dev/vite-tanstack-config` = `2.23.1` (drift restore only; no other package field touched).
4. Verify `bun.lock` unchanged (still 2.23.1, no hash change after the rebuild).
5. Run the focused test: `bun test src/components/public-search.test.ts` — the transplanted test's `expectedNav` must assert Home, Categories, Stores, Coupons, Deals, Blog for BOTH the md+ ribbon and the mobile menu; all tests must pass.
6. Run the TypeScript check (`tsgo`); confirm the platform build log shows "build OK".
7. Optional visual confirmation via Playwright at desktop and mobile widths: header ribbon and mobile menu show the order Home, Categories, Stores, Coupons, Deals, Blog.

## Strictly not done

No publish/deploy, no Edge Function changes, no SQL/migrations/RLS, no database or production mutations, no Impact/affiliate/newsletter calls, no changes to P3-A1 admin files, breakpoints/layout, search/auth/Dealio logic, mobile-menu behavior, styles.css, routeTree.gen.ts, public routes/footer, or any file beyond the two transplanted files plus the package.json drift restore. P3-A2 not started.

## Return

- Exact changed files; resulting Lovable source SHA.
- Hash-match confirmation against `63b68ec…`.
- Focused test result; TypeScript/build result.
- Confirmation nav order is Home, Categories, Stores, Coupons, Deals, Blog in both ribbon and mobile menu.
- Confirmation NO publish occurred.

STOP after preview-ready source update.
