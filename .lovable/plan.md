# I3 Admin Impact Coupon Import Cutover

## Scope
Replace the retired import and preview controls on Admin Integrations with one confirmed, production-mode Impact coupon import action. Source changes only; no function invocation, deployment, publication, provider request, migration, secret change, or database write.

## Implementation
- Add a neutral browser client for `affiliate-sync-ads-apply-v2` that accepts only `integrationId`, sends exactly `{ integrationId, execute: true, mode: "full" }`, and strictly parses the five bounded statuses.
- Fail closed on malformed success payloads and strip all non-approved response data.
- Add an exact normalized Impact-provider predicate for `impact`, `impact.com`, and `impact radius`.
- Replace Legacy Import and V2 Preview actions/modals with one enabled-Impact-only “Import Impact Coupons” action.
- Add confirmation, in-progress submission locking, no retries, required safe error messages, and the bounded success summary.
- Move the read-only import-history query and type into a neutral authenticated module, including `records_published` and optional persistence fields.
- Refresh the existing import-history query only after committed or replayed success.

## Verification
- Add focused tests for function slug/body, response-state parsing, malformed-response rejection, provider matching, retry policy, and removal of active legacy/preview route references.
- Run the focused tests. The platform will also perform its normal type and build checks.
- Confirm the workspace changes only; do not exercise any live import or production operation.
