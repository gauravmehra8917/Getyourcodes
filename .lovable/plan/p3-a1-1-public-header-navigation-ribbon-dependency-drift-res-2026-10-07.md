# P3-A1.1 Public Header Navigation Ribbon + Dependency Drift Restore (preview only, no publish)

## Verified before this plan
- Approved GitHub commit `ea3fc6b88e84e65055759a00575f2bd1502edded` on `p3-public-header-nav-ribbon` is reachable; its only parent is `586caf660048030b64a16bde6afebd54673223fc` (P3-A1), and it changes exactly two files:
  - `src/components/site-header.tsx` (modified)
  - `src/components/public-search.test.ts` (modified)
- Both source files in the current workspace are byte-identical to the approved parent (blob hashes `edb0261…` and `ec0612a…` match GitHub), so the preflight claim holds.
- Dependency drift confirmed in the current workspace: `package.json` and `bun.lock` both reference `@lovable.dev/vite-tanstack-config` = `2.25.2`. The approved commit pins `2.23.1` in both (blob hashes `8f629c6…` and `439d013…`). Restoring only `bun.lock` would leave the inconsistency, so both files are restored to the approved bytes.
- Workspace HEAD is `e585ff1a…` ("Work in progress"), one platform commit beyond the expected `fba406ab…`, with `bun.lock` modified in the working tree — platform drift, subsumed by this plan.

## Steps
1. Download the four files exactly as they are at commit `ea3fc6b…` from raw.githubusercontent.com:
   - `src/components/site-header.tsx`
   - `src/components/public-search.test.ts`
   - `package.json`
   - `bun.lock`
   and overwrite the workspace copies. Nothing is installed or upgraded.
2. Verify each file's git blob SHA equals the blob at commit `ea3fc6b…` (tree API blob SHAs vs `git hash-object`). Any mismatch stops the work there.
3. Confirm `git diff --stat` against the pre-transplant HEAD lists exactly these four paths.
4. Checks:
   - TypeScript check (`tsgo`).
   - Focused tests: `bunx vitest run src/components/public-search.test.ts`.
   - Build log in `/tmp/observability/build-errors.log` shows "build OK".
5. If the platform rewrites `package.json` or `bun.lock` during its rebuild/reinstall, restore BOTH to the approved GitHub bytes and re-verify the blob hashes before stopping.
6. Leave the preview running for manual browser verification of the ribbon behavior:
   - <768px: no persistent ribbon; hamburger + mobile nav available
   - ≥768px: persistent ribbon, order Home, Stores, Categories, Coupons, Deals, Blog; hamburger hidden
   - first row preserved: logo, search, Dealio, theme, account; sticky header kept; no horizontal overflow
7. Report: exact files changed, resulting Lovable source SHA, hash-match confirmation for all four files (with `package.json` and `bun.lock` confirmed at 2.23.1), test results, TypeScript/build results.

## Not done
- No publish or site deploy.
- No Edge Function deploys, no SQL, no migrations, no RLS/database changes.
- No P3-A1 admin file, `routeTree.gen.ts`, `styles.css`, public route, or footer changes.
- No Impact, affiliate sync, or newsletter calls; no secrets changes; no production data mutation.
- No other dependency or package.json field is changed — both files are restored whole, to the exact approved commit bytes, which by definition differ from the current workspace only in the drift.
- P3-A2 not started.
