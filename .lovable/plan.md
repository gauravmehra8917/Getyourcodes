# Synchronize to reviewed production-readiness source

## Scope
- Start from the user-specified source revision `2a3a237da6c6d6ab8b9365a532c046aa549ad125`.
- Apply the exact four reviewed commits ending at `b943ef901237e0701f17e5f2cd6398f71ede5970` from `gauravmehra8917/Getyourcodes`.
- Keep `supabase/migrations/20261005120000_public_catalog_visibility_rls.sql` in source exactly as reviewed, without executing it.
- Remove the unrelated local package-version drift after the stated starting revision so the resulting source matches the reviewed target exactly.

## Validation
- Confirm the resulting tracked tree is byte-for-byte equivalent to the reviewed target and report any conflicts.
- Confirm the changed-path inventory matches the reviewed four-commit delta.
- Let the preview build complete and inspect its latest build result; fix only synchronization errors attributable to the reviewed source.

## Safety boundaries
- Do not publish or deploy.
- Do not run SQL or migrations.
- Do not invoke affiliate functions or external providers.
- Do not send newsletters or modify production data, secrets, integrations, or schedules.

## Technical details
- GitHub comparison already confirms: `ahead_by: 4`, `behind_by: 0`, merge base `2a3a237da6c6d6ab8b9365a532c046aa549ad125`.
- The four reviewed commits are `f68e956`, `fcf3928`, `460e560`, and `b943ef9`.
- Current extra drift is limited to the Vite TanStack configuration package in `package.json` and its generated lockfile change; neither is part of the reviewed target.
