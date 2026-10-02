# P1C-A2: guarded Impact store category canary apply

Source-only checkpoint. No migration or Edge Function deployment, SQL execution,
live Impact request, production invocation, merge, scheduling or backfill.

## Git checkpoint and isolation

Implementation branch: `p1-store-category-canary-apply`, created in the isolated
Codex worktree from exactly `da43e96cbc4275e519458b205414004ddc766339`.
Its approved parent is `fd6bb87715184c043868b1d340ac9bcd853e9b8c`, whose
parent is the original base `199498695fd7edbd05fb10b875f0a0a7aaad023c`.
The source branch `p1-store-category-auto-mapping` is unchanged.

The A1.1 planner, normalization, Campaign identity and entire preview runtime
remain byte-identical to the approved source. The only preview test change is
two additional changed-path allowlist entries, explicitly authorized by the user.
All original read-only, forbidden-dependency, protected-Ads, historical-migration
and A1 mapping-migration equality checks remain intact. New A2 tests also verify
that the A1 test change is limited to those two entries.

## Persistence contract

New forward-only migration:
`supabase/migrations/20261002130000_affiliate_store_category_canary_apply.sql`.

New private typed RPC:

```text
public.apply_affiliate_store_category_canary_v1(
  p_store_id uuid,
  p_campaign_id text,
  p_category_id uuid,
  p_provider_category_keys text[]
) returns jsonb
```

`SECURITY DEFINER`, fixed `search_path = pg_catalog, public`. PUBLIC, anon and
authenticated privileges are revoked. EXECUTE is granted only to service_role.
No new direct table write privileges are granted. The signature accepts one
store/category UUID pair and one exact server-derived canonical CampaignId.
Campaign evidence is bounded to 1,024 characters / 4,096 bytes. Keys must be a
one-dimensional, one-based array of 1–32 distinct non-null keys, each at most
320 characters / 1,280 bytes. Validation mirrors the existing mapping schema's
key constraints; the RPC does not transform keys or infer categories.

The transaction locks the one primary-key store row with `SELECT ... FOR UPDATE`.
Missing identity or a mismatch in Impact provider, campaign namespace or exact
case-sensitive CampaignId produces `blocked/store_identity_mismatch`. Campaign
identity continues to come from `toOpaqueAdProviderIdV2` through the existing
category helper; there is no AdvertiserId or merchant fallback.

After the lock, any non-null category immediately produces
`noop_existing_category/noop_existing_category` with zero updates. It is preserved
regardless of mapping changes or category preference. NULL is the only ownership
state automation may write.

For an uncategorized store, a SHARE lock stabilizes the mapping table until
transaction completion, including inserts/enables that row locks would miss.
This briefly serializes mapping maintenance with the canary transaction; it
introduces no mapping mutation. A KEY SHARE lock verifies the requested category
exists and prevents its deletion during persistence.

SQL re-resolves all supplied keys against enabled Impact mappings. The minimum
integer priority wins. No match returns `mapping_unmapped`. More than one distinct
category at that priority returns `mapping_ambiguous`. One strongest category
that differs from the requested target returns `mapping_stale`. Only a single
strongest matching target can proceed.

Exactly one UPDATE site sets only `stores.category_id`, with all identity predicates
and `category_id IS NULL` repeated in its WHERE clause. The primary-key predicate
bounds the update to **at most one store**. One affected row returns assigned;
zero rows triggers a safe recheck and bounded noop/failure without retry. Any
unexpected exception rolls back the function's subtransaction and returns
`blocked/internal_failure`. Results have only `status` and `outcome`; exception
text, SQL, raw rows and identifiers are never returned.

No coupon/Ads persistence, provider-managed state, import run, ledger or fingerprint
is read or written by this RPC. `public.import_apply(jsonb)` remains retired.

## Canary host

New Edge Function: `affiliate-store-category-apply-v1`.

Exact POST body, capped at 1,024 streamed bytes:

```json
{ "integrationId": "<uuid>", "apply": true, "mode": "canary" }
```

No client-supplied store, category, Campaign, mapping, priority or normalized keys
are accepted. Only canary mode exists. Allowed origin and POST gates precede
Supabase Auth verification of the Bearer JWT. Administrator membership is required
before integration, catalog or credential reads. Credential decryption follows
successful catalog preconditions.

The existing bounded catalog adapter reads only affiliate_integrations,
affiliate_integration_credentials, user_roles, stores, categories and
affiliate_store_category_mappings. It continues UUID keyset pagination to an
empty page with a 10,000-row cap and rejects malformed/truncated facts. The new
adapter exposes these reads and only one named private category RPC; no database
client reaches the planner or selection helper.

Every invocation fetches fresh Campaign evidence through the existing read-only
category Campaign client and safe transport/configuration helpers. Bounds remain
100 records/page, 10 pages/physical requests, 1,000 records, 2,000,000 bytes/response,
15 seconds/request and no provider retries. Incomplete evidence cannot persist.

The authoritative pure planner is unchanged. Assignable decisions sort by canonical
CampaignId using `<`/`>` code-unit comparisons, and only the first is selected.
All unique normalized keys from that Campaign's original evidence are passed to
SQL, including currently unmapped or weaker keys. A newly stronger mapping for
any observed key can therefore block a stale target. No assignment means zero
RPC calls. Otherwise there is **at most one RPC call**, without retry or a fallback
second canary on blocked/noop/failure.

Bounded success/noop/blocked response:

```json
{
  "host": { "version": "p1c-a2-v1", "mode": "canary" },
  "result": {
    "status": "assigned|noop|blocked",
    "assigned": 0,
    "alreadyCategorized": 0,
    "remainingAssignable": 0
  }
}
```

`assigned` and `alreadyCategorized` are 0/1 confirmations for the selected canary;
with no selected assignment both are zero. `remainingAssignable` is a bounded
fresh-plan count (at most 1,000), reduced by one for assigned/manual-noop outcomes.
It is not a post-transaction bulk catalog snapshot. Early host failures return
only the fixed host marker and allowlisted error code/message. RPC transport or
malformed-result failures return bounded blocked counts with HTTP 502. A lost
transport response can have an unknown commit outcome: zero means no assignment
was confirmed, not proof of transaction rollback. The host never retries it.

No Campaign/store/category IDs, credentials, raw payload, mapping keys, URLs or
SQL details are exposed. There is no bulk/full/scheduled mode, background batch,
cron, store trigger, Ads execution hook or category backfill.

## Verification

All provider/database operations are fixture mocks. SQL contract tests inspect
the migration source; the transaction-race tests use a clearly labeled fixture
model and do not execute SQL. This checkpoint has no database integration test
or assertion that the migration was installed.

- Foundation + A1.1 preview + A2: **105 passed, 0 failed** (53 existing + 52 A2).
- Complete Edge suite: **648 tests, 646 passed, 0 failed, 2 existing skips**.
- Raw repository Node run: **689 tests, 683 passed, 4 known failures, 2 skips**.
- Application TypeScript: passed.
- Deno runtime checks for apply/preview and focused test checks: passed.
- Focused ESLint, Prettier and `git diff --check`: passed.
- Protected Ads source and all historical migrations: byte-identical to original
  base `199498695fd7edbd05fb10b875f0a0a7aaad023c`.
- A1 mapping migration: byte-identical to reviewed checkpoint
  `fd6bb87715184c043868b1d340ac9bcd853e9b8c`.
- A1.1 pure foundation and preview runtime: byte-identical to approved source
  `da43e96cbc4275e519458b205414004ddc766339`.

Raw Node failures are the existing unresolved `@/` alias in
`affiliate-sync-ads-apply-v2.client.test.ts` and extensionless imports in
`catalog-visibility.test.ts`, `http-client.server.test.ts` and
`logo-sync.server.test.ts`. All four were reproduced from a `git archive` of the
exact approved source in `/private/tmp/p1c-a2-approved-baseline`.
Repository-wide lint fails at **11,074 errors, 20 warnings**, identical to that
approved-source baseline. No unrelated fixes were made.

Commands from the implementation worktree (existing local dependencies linked):

```sh
node --test supabase/functions/_shared/affiliate-store-category-v1/tests/category.test.ts supabase/functions/affiliate-store-category-preview-v1/tests/*.test.ts supabase/functions/affiliate-store-category-apply-v1/tests/*.test.ts
node --test $(rg --files supabase/functions -g '*.test.ts' | sort)
node --test $(rg --files supabase/functions src -g '*.test.ts' | sort)
deno check --no-lock supabase/functions/affiliate-store-category-apply-v1/index.ts supabase/functions/affiliate-store-category-preview-v1/index.ts
deno check --no-lock supabase/functions/_shared/affiliate-store-category-v1/tests/category.test.ts supabase/functions/affiliate-store-category-preview-v1/tests/*.test.ts supabase/functions/affiliate-store-category-apply-v1/tests/*.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint supabase/functions/_shared/affiliate-store-category-v1 supabase/functions/affiliate-store-category-preview-v1 supabase/functions/affiliate-store-category-apply-v1
./node_modules/.bin/prettier --check supabase/functions/_shared/affiliate-store-category-v1 supabase/functions/affiliate-store-category-preview-v1 supabase/functions/affiliate-store-category-apply-v1 docs/checkpoints/p1c-a2-category-canary-apply.md
npm run lint
git diff --check
```

Stop after one reviewed commit pushed only to `p1-store-category-canary-apply`.
Further category bulk automation requires the separate P1C-A3 approval.
