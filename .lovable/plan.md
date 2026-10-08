# P4-A2 — Import Impact Deals Admin Control (preview only, no publish, no provider invocation)

## Preflight findings (read-only)
- Workspace HEAD is `6656bce5…`, not the expected `89c2ad7e…` (platform commit drift).
- Approved commit `88f78c3e…` has the single parent `62179453…` and changes exactly the 4 approved files.
- `src/routes/admin.integrations.tsx` is byte-identical to the parent (1ee745f).
- Two files already match approved bytes and stay untouched:
  - `routeTree.gen.ts` (35f4463)
  - `bun.lock` (439d013, 2.23.1)
- Dependency drift, which contradicts the preflight claim: `package.json` pins **2.25.3** (blob 675c60b…, approved is 8f629c6…).

## Steps
1. Download the 4 approved files from `88f78c3e…` and confirm each blob before overwriting:
   - admin.integrations.tsx 855c6de
   - affiliate-sync-deals.client.ts 2e2cb8d (new)
   - affiliate-sync-deals.client.test.ts 7cfb7f2 (new)
   - admin-integrations-deals.test.ts 4820f58 (new)
2. Dependency guard: restore both `package.json` and `bun.lock` as whole files from `88f78c3e…`, never by hand-editing.
3. Run the new tests: the Deals client test and the Admin Integrations Deals test.
4. Run the regression tests:
   - Coupon/Ads client: affiliate-sync-ads-apply-v2.client test
   - P3-A1: admin.functions, admin-entity-ownership, admin-catalog-delete, admin-lists
   - P3-A2: sidebar
   - P3-A3: admin-secondary-actions, admin-secondary-pages
   - P3-A4: the Head Manager tests. Two of them can't pass in this workspace for environmental reasons (they need a commit that isn't stored locally), so I'll verify those two files against GitHub instead.
   - Public navigation: public-search
5. Run tsgo, then check that the build log says "build OK".
6. After the rebuild, check the hashes again for the 4 files, package.json, bun.lock and routeTree.gen.ts. If the platform rewrote anything, restore it from `88f78c3e…` and verify again.
7. Confirm the diff from the starting HEAD touches only the 4 files plus package.json (and plan notes). Also grep the new client code to confirm there is no `canary` call.

## Out of scope
- No clicking either Import button and no Edge Function invocation, so no Impact call.
- No Edge deploys, SQL, data mutation, publish, newsletters, or secrets/policy changes.
- Then stop at preview-ready.
