# P3-A3 — Secondary Admin Reliability Hardening (preview only, no publish)

## Preflight findings (read-only)
- Workspace HEAD is `26c0d016…`, not the expected `38df1c77…` (platform commit drift).
- Approved commit `db59edd7…` (gauravmehra8917/Getyourcodes) has the single parent `aa807037…` and changes exactly the 8 approved files.
- All five existing route files are byte-identical to parent `aa807037…` (subscribers 4df63b7, posts.index d0600f8, blog-categories b84c1a6, reports a73f8bd, activity 926e82e).
- `src/routeTree.gen.ts` already matches approved bytes (35f4463…).
- Dependency drift, which contradicts the preflight claim: `package.json` now pins **2.25.3** (blob 675c60b…). `bun.lock` is still 2.23.1 and matches approved (439d013…).

## Steps
1. Download the 8 approved files from `db59edd7…` and confirm each blob SHA before overwriting:
   - admin-secondary-actions.ts 6e24ebf, admin.subscribers.tsx afa1ab9, admin.posts.index.tsx 182ea47, admin.blog-categories.tsx f189549, admin.reports.tsx f7576e7, admin.activity.tsx 525ccb2, admin-secondary-actions.test.ts 6efa7a3, admin-secondary-pages.test.ts 53a689e
2. Dependency guard: restore **both** `package.json` (8f629c6…) and `bun.lock` (439d013…) as whole files from `db59edd7…`, never by hand-editing. This is the restore your guard calls for, since package.json has already drifted.
3. Run the focused tests (admin-secondary-actions, admin-secondary-pages) and the regression tests (admin.functions, admin-entity-ownership, admin-catalog-delete, admin-lists, sidebar, public-search).
4. Run tsgo, then check that the build log says "build OK".
5. After the rebuild, check the hashes again for the 8 files, package.json, bun.lock and routeTree.gen.ts. If the platform rewrote anything, restore it from `db59edd7…` and verify again.
6. Confirm `git diff` against the starting HEAD touches only the 8 files plus package.json. No protected file should change.

## Out of scope
No publish, Edge deploys, SQL, RLS/migrations, Impact or affiliate runs, newsletters, secrets/policy changes, data mutation, or held-Ads work. Then stop at preview-ready.
