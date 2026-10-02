# P1C-A1: Impact store category mapping foundation and preview

This checkpoint creates mapping schema and a read-only administrator preview. It
does not assign categories. Stop here: category persistence, backfill, scheduling,
deployment and production invocation require a separate task.

## Isolation and ownership

Base: `p1-provider-managed-refresh` at
`199498695fd7edbd05fb10b875f0a0a7aaad023c` (`feat: wire ads-2 provider refresh execution`).
Implementation branch: `p1-store-category-auto-mapping` in the isolated Codex
worktree. Existing Ads-1, Ads-2, provider refresh, coupon persistence, contract
versions, fingerprints, import runs and ledgers are unchanged.

Pure category helpers live in
`supabase/functions/_shared/affiliate-store-category-v1/`. Store identity requires
exactly one store with `provider = 'impact'`, namespace `campaign` and the exact
CampaignId. Opaque string IDs are never trimmed or case-folded. Positive safe
integer IDs are represented as their exact decimal string. Names, AdvertiserId,
domains, slugs and URLs are never identity fallbacks. Missing identity is held;
multiple matching stores are `ambiguous_store`.

Any non-null store category is editorial and yields `noop_existing_category`,
including when the provider taxonomy disappears or becomes malformed. Only a
null category is considered by the pure planner. This rule never becomes part
of the Ads-2 ownership contract.

## Mapping schema

Forward-only migration:
`supabase/migrations/20261002120000_affiliate_store_category_mappings.sql`.

`public.affiliate_store_category_mappings` has a UUID primary key, explicit
provider, original provider label, normalized key, category foreign key,
integer priority, enabled flag and timestamps. Its partial unique index prevents
multiple enabled rows for the same provider/key. Disabled historical rows may
coexist. The category foreign key uses `ON DELETE RESTRICT`; deleting a category
requires explicitly removing its mappings. There are no seeds or guessed UUIDs.

RLS permits authenticated administrators through `public.is_admin(auth.uid())`.
Anonymous/public access is revoked. The service role has SELECT privileges only
on this new table. Timestamp maintenance is a trigger on the mapping table only;
there is no trigger or mutation on stores. The single `stores.category_id`
architecture and existing manual admin UI remain unchanged.

Mapping authors must use `normalizeCategoryLabel` to obtain the external key.
The schema rejects noncanonical lowercase/whitespace keys. The descriptive label
does not drive matching: the explicit normalized key does.

## Extraction and planning

Supported Campaign fields: `Categories`, `Category`, `Vertical`, `Verticals`.
Each accepts a string or a string array. Absent/null/blank fields and empty arrays
mean no evidence. Objects, numbers, booleans, nested/mixed arrays, control/bidi
characters and oversized labels/collections hold the whole Campaign. Limits:
160 UTF-16 code units per input label, 32 entries per field, 32 distinct labels
per Campaign. Original trimmed labels are retained; equivalent keys are
deduplicated with a stable representative independent of array order.

Normalization trims surrounding whitespace, lowercases and collapses internal
whitespace to one space. Punctuation/separators remain significant. There is no
fuzzy matching, merchant inference, AI, embedding or taxonomy guessing.

Lower numeric priority is stronger, including negative priorities. Only enabled
Impact mappings participate. At the strongest priority, one distinct available
category is assignable even if several labels map to it. Different target IDs
at that priority yield `ambiguous_mapping`. No match yields `unmapped`. Invalid
mapping IDs/priorities or unavailable target categories yield `invalid_source`.
Duplicate Campaign identities are held for uncategorized stores rather than
arbitrarily choosing conflicting provider evidence.

Planner actions are `assign`, `noop_existing_category`, `unmapped`,
`ambiguous_mapping`, `unknown_store`, `ambiguous_store`, `invalid_source`.
The `assign` value is evidence only: it contains store, Campaign and category IDs,
has no writer, and is not returned in the public preview.

## Preview contract

New function: `affiliate-store-category-preview-v1`. Config delegates JWT
verification to the handler, which verifies the Bearer JWT with Supabase Auth
and checks administrator membership before privileged reads. Exact CORS rules
follow the existing configured site/local origin conventions. POST accepts only
`{"integrationId":"<uuid>","preview":true}` and streams at most 1,024 request
bytes. OPTIONS performs no trusted work.

Only safe existing Impact configuration, URL, bounded collection and transport
helpers are imported. Existing Ads handlers/parsers/persistence are unchanged.
The runtime fetches Campaigns only, through GET with credential-origin enforcement
and redirect rejection. Limits are 100 Campaigns/page, 10 pages/requests, 1,000
records, 2,000,000 bytes/response, one attempt/page and 15 seconds/request.
Server-controlled continuations are validated by the existing URL safety helper.
Incomplete, oversized, cancelled or malformed page streams return a fixed error
without partial assignable counts.

The database adapter reads exact Impact Campaign stores, available categories and
enabled Impact mappings. Stable UUID keysets continue until an empty page,
including when a server caps rows below the requested size. Each collection has
a 10,000-row cap with an overflow sentinel; malformed, overflowing or failed
reads block preview before credential decryption. These are bounded observations,
not a transactionally locked catalog or executable persistence plan.

Success shape:

```json
{
  "host": {
    "version": "p1c-a1-v1",
    "readOnly": true,
    "integrationId": "<requested integration UUID>"
  },
  "result": {
    "complete": true,
    "summary": {
      "campaignsEvaluated": 0,
      "exactStoresMatched": 0,
      "assignable": 0,
      "alreadyCategorized": 0,
      "unmapped": 0,
      "ambiguous": 0,
      "ambiguousMapping": 0,
      "ambiguousStore": 0,
      "unknownStore": 0,
      "invalidSource": 0,
      "distinctUnmappedLabels": 0
    }
  }
}
```

Counts describe Campaign observations, not distinct stores. `ambiguous` is the
sum of mapping and store ambiguity. `distinctUnmappedLabels` counts normalized
labels across decisions classified `unmapped`; empty taxonomy contributes zero.
No provider labels, Campaign/store/category IDs, credentials, configuration,
provider pages, URLs or exception details are returned. Errors expose only the
fixed `host` marker and `error: {code, message}`.

There is no category apply endpoint/RPC, store update, coupon update, import run,
ledger write, integration update, scheduler or automatic backfill. The legacy
`public.import_apply(jsonb)` remains retired.

## Verification commands

From the implementation worktree, with existing dependencies linked locally:

```sh
node --test supabase/functions/_shared/affiliate-store-category-v1/tests/category.test.ts supabase/functions/affiliate-store-category-preview-v1/tests/*.test.ts
node --test $(rg --files supabase/functions -g '*.test.ts' | sort)
node --test $(rg --files supabase/functions src -g '*.test.ts' | sort)
deno check --no-lock supabase/functions/affiliate-store-category-preview-v1/index.ts
deno check --no-lock supabase/functions/_shared/affiliate-store-category-v1/tests/category.test.ts supabase/functions/affiliate-store-category-preview-v1/tests/*.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint supabase/functions/_shared/affiliate-store-category-v1 supabase/functions/affiliate-store-category-preview-v1
./node_modules/.bin/prettier --check supabase/functions/_shared/affiliate-store-category-v1 supabase/functions/affiliate-store-category-preview-v1 docs/checkpoints/p1c-a1-store-category-preview.md
npm run lint
git diff --check
git status --short
git diff --stat
git diff --name-only
git diff
```

The boundary suite resolves the entire runtime dependency closure, prohibits
writes/RPC/legacy persistence and verifies byte equality against the exact base
for existing Ads source and every historical migration. All provider tests use
fixture transports; no live Impact call occurs.

Final results: focused tests **41 passed, 0 failed**; complete Edge suite **584
tests, 582 passed, 0 failed, 2 skipped**; raw repository-wide Node run **625 tests,
619 passed, 4 failed, 2 skipped**. Application TypeScript, Edge runtime and new
test TypeScript, focused lint, formatting and `git diff --check` pass. Repository
lint matches the exact base at **11,074 errors, 20 warnings**, with no new issues.

The raw Node repository-wide command has four existing module-resolution
failures: `affiliate-sync-ads-apply-v2.client.test.ts` cannot resolve the `@/`
alias; `catalog-visibility.test.ts`, `http-client.server.test.ts` and
`logo-sync.server.test.ts` encounter extensionless imports. The same four failures
were reproduced in `/private/tmp/p1c-a1-base`, extracted with `git archive` from
the exact base. Repository-wide lint also fails at the base (11,074 errors and
20 warnings); existing formatting/type rules are left untouched. New code has
its own focused lint/format/type verification.

Baseline reproduction commands, from `/private/tmp/p1c-a1-base`:

```sh
node --test src/lib/affiliate-sync-ads-apply-v2.client.test.ts src/lib/catalog-visibility.test.ts src/lib/integration-engine/http-client.server.test.ts src/lib/presentation/logo-sync.server.test.ts
npm run lint
```

No migration SQL was executed, no production data or configuration was changed,
and no function was deployed or invoked against production. No merge or push
was performed.
