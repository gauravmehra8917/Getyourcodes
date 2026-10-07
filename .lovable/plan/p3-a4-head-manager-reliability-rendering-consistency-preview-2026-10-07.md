# P3-A4 — Head Manager Reliability & Rendering Consistency (preview only, no publish)

## Preflight findings (read-only)
- Workspace HEAD is `360122e6…`, not the expected `883691e2…` (platform commit drift).
- Approved commit `62179453…` has the single parent `db59edd7…` and changes exactly the 9 approved files.
- All five existing production files are byte-identical to the parent:
  - admin.head-manager 4f8e620
  - import-snippet-dialog c982f6e
  - render.ts de104d1
  - import-snippet.ts 61b5530
  - head.functions 720177f
- Three files already match approved bytes and stay untouched:
  - `routeTree.gen.ts` (35f4463)
  - `__root.tsx` (9480a42)
  - `bun.lock` (439d013, 2.23.1)
- Dependency drift, which contradicts the preflight claim: `package.json` now pins **2.26.0** (blob 279e2c6…, approved is 8f629c6…).

## Steps
1. Download the 9 approved files from `62179453…` and confirm each blob before overwriting:
   - admin.head-manager.tsx 75fe29a
   - import-snippet-dialog.tsx 4190810
   - render.ts 960427d
   - import-snippet.ts e788b24
   - head.functions.ts dd211b5
   - validation.ts df39041 (new)
   - render.test.ts 097ac07 (new)
   - validation.test.ts c172bde (new)
   - workflows.test.ts 4e80fcd (new)
2. Dependency guard: restore both `package.json` and `bun.lock` as whole files from `62179453…`, never by hand-editing. This is required because package.json has already drifted.
3. Run the new Head Manager tests: render, validation, workflows.
4. Run the regression tests:
   - P3-A1: admin.functions, admin-entity-ownership, admin-catalog-delete, admin-lists
   - P3-A2: sidebar
   - P3-A3: admin-secondary-actions, admin-secondary-pages
   - Public navigation: public-search
5. Run tsgo, then check that the build log says "build OK".
6. After the rebuild, check the hashes again for the 9 files, package.json, bun.lock, routeTree.gen.ts and __root.tsx. If the platform rewrote anything, restore it from `62179453…` and verify again.
7. Confirm the diff from the starting HEAD touches only the 9 files plus package.json (and plan notes).

## Out of scope
No publish, Edge deploys, SQL, migrations/RLS, head_entries changes, data mutation, Impact or affiliate runs, newsletters, or secrets/policy changes. Then stop at preview-ready.
