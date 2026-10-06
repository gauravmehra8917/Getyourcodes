# P2 preflight verified — transplant deals-only mode into affiliate-sync-apply-v2

## Preflight results (all read-only, nothing changed)

- GitHub branch `p2-impact-promotions-deals-only` resolves to approved commit `00805a3a5f04d8f1cd7c7b3bfb28da42418ffbe9`; its direct parent is `a770d0b080feb5e3af271d4510b274c27fd75055` as stated.
- Approved commit changes exactly the five listed files (1098 insertions, 75 deletions): ImpactOfferNormalizer.ts, deals-only.ts (new, 231 lines), handler.ts, types.ts, tests/handler.test.ts. No migration files, no generated DB types, no `src/**` files.
- Workspace copies of the three existing files match the approved parent byte-for-byte, so an exact transplant applies cleanly with no conflicts.
- The new `deals-only.ts` imports `hasImpactPromotionRedemptionCodeV2`, which is exported by the approved ImpactOfferNormalizer change and re-exported through the shared `index.ts` (`export * from "./ImpactOfferNormalizer.ts"`, unchanged). No dependency outside the five files.
- No migration or generated-type change required; no frontend publish needed (Edge Function code only).
- Only `affiliate-sync-apply-v2` needs redeployment — shared code bundles through it.

## One deviation to confirm

Workspace HEAD is `09fb1c6` ("Work in progress"), one commit ahead of the `12a3951` you cited. The extra commit touches only `package.json` and `bun.lock` (the vite-tanstack-config rollback from the previous cleanup) — no overlap with the five transplant files, so it does not block the transplant. Proceeding will carry that commit along.

## What I will do on approval

1. Apply the exact five-file transplant from commit `00805a3a5f04d8f1cd7c7b3bfb28da42418ffbe9` (checkout those paths from the fetched commit; no rewrites).
2. Verify the transplanted files match the approved commit byte-for-byte and run a Deno check on the function.
3. Deploy only `affiliate-sync-apply-v2`. No other Edge Function is touched.
4. Stop and report: deployed status, changed file list, safety confirmations.

## Explicitly not done

- No SQL, migrations, or database changes.
- No frontend publish.
- No invocation of the function (no canary, no full mode, no Impact calls).
- No changes to any other Edge Function, secrets, or configuration.
