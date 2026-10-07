# P3-A2 Admin Navigation Cleanup (preview only, no publish)

## Verified preflight
- Approved commit `aa80703702dd40add4afd76e1b6a712b973e5cd3` is reachable and has direct parent `63b68ec56ed1b8750c284f907c09c142625d7604`.
- The approved commit changes exactly `src/components/admin/sidebar.tsx` and adds `src/components/admin/sidebar.test.ts`.
- Current `src/components/admin/sidebar.tsx` matches the approved parent exactly; the test file is currently absent.
- The approved files have Git blobs `09eb71560b0a9bb11c34c0aec37572474a66b1aa` and `a428da81a7442ef7d5ed42f4c4c3580ea257d67a`.
- The approved navigation contains exactly five groups and 14 items, in the requested order. Its tests cover both desktop and mobile use of shared `AdminNavContent`, active/accessibility behavior, mobile closing, and the homepage logo link.
- All 11 hidden destination route files currently remain present.
- Current workspace HEAD is `fa91ec675aec2c43308dc2ed5726912eec90f6de`, not the supplied `29d449a05292b31804c45ca312f8a939737392c2`.
- Dependency preflight has drifted: `package.json` currently says 2.25.2 while `bun.lock` remains at 2.23.1. The approved commit contains matching 2.23.1 dependency files (blobs `8f629c667a5d43cdb36e247727bfa557c5947922` and `439d01316814190c78a62c44639e665111092da9`).

## Implementation
1. Transplant the two approved sidebar files exactly from commit `aa807037…` and verify their Git blob hashes before and after placement.
2. Because the required final dependency state is already violated, restore **both** `package.json` and `bun.lock` as whole approved files from the same commit. This is the dependency-guard exception, not an intentional dependency upgrade or hand edit.
3. Confirm the resulting diff is limited to the two approved sidebar files plus only the dependency-guard files required by the detected drift.
4. Run the focused sidebar navigation test, then TypeScript checking.
5. Check the platform build result. If either dependency file is rewritten, restore both approved files again and re-verify their blobs and 2.23.1 values.
6. Verify in the preview that desktop and mobile show the same 14 items across five groups and that all 11 hidden labels are absent. Confirm the hidden route files still exist and direct URLs were not changed.

## Final report
- Resulting Lovable source SHA and exact changed files.
- Blob/hash verification for every transplanted or dependency-guard file.
- Focused test, TypeScript, and build results.
- Confirmation of exactly 14 visible items in five groups on desktop and mobile.
- Confirmation that all 11 hidden items are absent from navigation while their route files remain intact.
- Confirmation that both dependency files finish at 2.23.1.
- Confirmation that nothing was published and no production data, functions, SQL, schema, secrets, integrations, or pipelines were touched.

## Scope boundary
No route deletion, redirect, `routeTree.gen.ts` change, P3-A1/public-header change, API Integrations or Publishing Policies change, Edge deployment, SQL, migration/RLS/database work, provider/newsletter invocation, production mutation, or P3-A3 work.
