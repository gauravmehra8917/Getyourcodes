# P2-D2 — transplant deal affiliate-URL fallback into affiliate-sync-apply-v2

## Preflight results (read-only, nothing changed)

- Workspace HEAD is `6e5b362d0bc4bb49b01775dccb7eff67510141ac` as stated; tree clean.
- GitHub branch `p2-impact-deal-affiliate-fallback` resolves to approved commit `4976f130db87bf1fa4d513c7a6ead258cf028d16`; direct parent is `00805a3a5f04d8f1cd7c7b3bfb28da42418ffbe9` as stated.
- Approved commit changes exactly the four listed files (327 insertions, 3 deletions): PersistencePlannerV2.ts, PersistencePlannerV2.test.ts, deals-only.ts, handler.test.ts. No migrations, no generated types, no `src/**`, no package/lockfile changes.
- Workspace copies of all four files match the approved parent byte-for-byte — clean transplant, no conflicts.
- Diff reviewed: deal `affiliateUrl` resolves to promotion tracking URL, else exact parent Campaign tracking URL, else the projection fails closed as `invalid_offer_projection`. `destinationUrl` is never used. deals-only.ts adds matching fail-closed assertions at plan and execution boundaries.

## What I will do on approval

1. Extract the four files from commit `4976f130db87bf1fa4d513c7a6ead258cf028d16` and copy them into place (git checkout is blocked in this environment; copy + hash verification achieves the same byte-exact result).
2. Verify SHA-256 of each transplanted file against the approved commit.
3. Run `deno check` on `affiliate-sync-apply-v2/index.ts`.
4. Redeploy only `affiliate-sync-apply-v2`.
5. Stop and report: changed files, resulting source commit SHA, check result, deployment confirmation.

## Explicitly not done

- No SQL, no production row changes, no backfill of the 18 existing deals.
- No invocation of Impact, affiliate-sync-apply-v2, or Ads V2.
- No frontend edits, no website publish, no package/lockfile/migration/publishing-policy changes.
