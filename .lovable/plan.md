# P3-A1.1 Public Header Navigation Ribbon (preview only, no publish)

## Verified before this plan
- Approved GitHub commit `ea3fc6b88e84e65055759a00575f2bd1502edded` on `p3-public-header-nav-ribbon` is reachable; its only parent is `586caf660048030b64a16bde6afebd54673223fc` (P3-A1), and it changes exactly two files:
  - `src/components/site-header.tsx` (modified)
  - `src/components/public-search.test.ts` (modified)
- Both files in the current workspace are byte-identical to the approved parent (blob hashes `edb0261…` and `ec0612a…` match GitHub), so the preflight claim holds.
- Workspace discrepancy: HEAD is `e585ff1a…` ("Work in progress"), one platform commit beyond the expected `fba406ab…`, and the working tree shows `bun.lock` modified (platform drift, no package.json change). This matches the drift pattern seen in earlier phases and will be restored, not accepted.

## Steps
1. Restore `bun.lock` to its committed baseline (`git checkout -- bun.lock`); confirm `package.json` stays untouched and `git status` is clean except nothing else.
2. Download the two files exactly as they are at commit `ea3fc6b…` from raw.githubusercontent.com and overwrite the workspace copies.
3. Verify each file's git blob SHA equals the blob at commit `ea3fc6b…` (fetch blob SHAs from the GitHub tree API; compare against `git hash-object`). Any mismatch stops the work there.
4. Confirm `git diff --stat` against the pre-transplant HEAD lists exactly these two paths (plus the earlier bun.lock restore commit, if the platform commits it separately).
5. Checks:
   - TypeScript check (`tsgo`).
   - Focused tests: `bunx vitest run src/components/public-search.test.ts` (plus the header-related assertions it contains).
   - Build log in `/tmp/observability/build-errors.log` shows "build OK".
6. Leave the preview running for manual browser verification of the ribbon behavior:
   - <768px: no persistent ribbon; hamburger + mobile nav available
   - ≥768px: persistent ribbon, order Home, Stores, Categories, Coupons, Deals, Blog; hamburger hidden
   - first row preserved: logo, search, Dealio, theme, account; sticky header kept; no horizontal overflow
7. Report: exact files changed, resulting Lovable source SHA, hash-match confirmation, test results, TypeScript/build results.

## Not done
- No publish or site deploy.
- No changes to P3-A1 admin files, `package.json`, `bun.lock` (beyond restoring baseline), `routeTree.gen.ts`, `styles.css`, public routes, footer, or admin sidebar.
- No Edge Function deploys, no SQL, no migrations, no RLS/database changes.
- No Impact, affiliate sync, or newsletter calls; no secrets changes; no production data mutation.
- P3-A2 not started.
