# P4-A2 (Amended) — Import Impact Deals Admin Control + Dependency Drift Restore

Preview only. No publish.

## Current state (verified this turn)
- Workspace HEAD: `a06d4c9c…` (platform commits moved past the cited `89c2ad7e…`).
- `package.json`: `@lovable.dev/vite-tanstack-config` = **2.25.3** (drifted).
- `bun.lock`: currently 2.23.1, but will be restored to approved bytes regardless, per the amendment.

## Approved source
- Branch: `p4-impact-deals-admin-control`
- Commit: `88f78c3e9bc951415a7eeabbf1cb6a487957048c` (parent `62179453…`)
- Approved source pins both dependency files at 2.23.1.

## Scope — exactly 6 files, restored as whole approved bytes from 88f78c3
1. `src/routes/admin.integrations.tsx`
2. `src/lib/affiliate-sync-deals.client.ts`
3. `src/lib/affiliate-sync-deals.client.test.ts`
4. `src/lib/admin-integrations-deals.test.ts`
5. `package.json` (whole-file restore, 2.23.1 — no hand-edited version strings)
6. `bun.lock` (whole-file restore, 2.23.1)

## Steps
1. Download all 6 files from GitHub commit `88f78c3`; verify each blob hash against the GitHub tree before overwriting.
2. Copy into workspace.
3. Run focused tests: deals client tests, admin integrations deals tests, coupon client regression tests.
4. Run TypeScript check (tsgo) and confirm build OK.
5. After rebuild, re-verify:
   - all 4 P4-A2 files match `88f78c3` blobs
   - `package.json` and `bun.lock` both equal the approved 2.23.1 bytes (restore both again if the platform rewrote either)
   - `src/routeTree.gen.ts` unchanged / matching approved source
6. Report resulting SHA, changed files, hash confirmations, test/type/build results.

## Strict prohibitions
- No publish
- No live `affiliate-sync-preview-v2` invocation
- No `affiliate-sync-apply-v2` invocation
- No Coupon import invocation
- No Impact API call
- No Edge deploy
- No SQL / migrations / RLS changes
- No production data mutation
- No protected P3/backend file changes
- No changes to public navigation, styles.css, routeTree.gen.ts, or any file outside the 6-file scope
