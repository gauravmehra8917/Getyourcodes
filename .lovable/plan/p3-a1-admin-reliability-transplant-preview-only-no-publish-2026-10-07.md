# P3-A1 Admin Reliability Transplant (preview only, no publish)

## Verified before this plan
- Current workspace HEAD is `c2bdf544c2355922b5ada7ba880554da31adb095` and the working tree is clean.
- GitHub commit `586caf660048030b64a16bde6afebd54673223fc` (gauravmehra8917/Getyourcodes) is reachable.
- Its only parent is `4976f130db87bf1fa4d513c7a6ead258cf028d16`.
- It changes exactly the 11 approved files and nothing else.

## Steps
1. Download the 11 files exactly as they are at commit `586caf6…`:
   - Production:
     - `src/lib/admin.functions.ts`
     - `src/lib/admin-entity-ownership.ts` (new)
     - `src/lib/admin-catalog-delete.ts` (new)
     - `src/routes/admin.users.tsx`
     - `src/routes/admin.coupons.index.tsx`
     - `src/routes/admin.stores.index.tsx`
     - `src/routes/admin.categories.tsx`
   - Tests:
     - `src/lib/admin.functions.test.ts`
     - `src/lib/admin-entity-ownership.test.ts`
     - `src/lib/admin-catalog-delete.test.ts`
     - `src/lib/admin-lists.test.ts`
2. Download `package.json` and `bun.lock` exactly from the same commit. This removes the 2.25.2 drift and restores 2.23.1. Nothing is installed or upgraded.
3. Check each of the 13 files against GitHub using the git blob SHA. Any file that doesn't match stops the work there.
4. Before the platform build, confirm that `git diff --stat` against the current HEAD lists exactly these 13 paths.
5. Checks:
   - TypeScript check (`tsgo`).
   - Focused tests (`bunx vitest run` on the 4 test files).
   - The build log.
6. If the platform rewrites `bun.lock` during reinstall, restore it to the GitHub bytes and re-verify.
7. Report:
   - the resulting commit SHA
   - the exact list of changed files
   - hash-match confirmation
   - check and test results

## Not done
- No publish.
- No Edge Function deploys or changes.
- No SQL, migration, RLS or schema changes.
- No Impact, affiliate sync or newsletter calls.
- No changes to secrets or Publishing Policies.
- No other routes touched; `routeTree.gen.ts` stays as it is.

## Technical note
Files are fetched read-only from raw.githubusercontent.com at the pinned SHA. The approved branch is not on the workspace's git remote, so `git checkout` can't be used.
