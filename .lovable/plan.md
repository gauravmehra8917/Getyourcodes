# Deploy the affiliate sync preflight check

## Inspection results (already verified, nothing changed)

Commit `93470e8 — feat: add affiliate sync edge preflight` is the current workspace HEAD and is contained in `feature/import-orchestration`.

All Phase 1 files present:

- `supabase/functions/affiliate-sync-preflight/index.ts`
- `supabase/functions/_shared/edge-supabase.ts`
- `supabase/functions/_shared/edge-credentials.ts`
- `supabase/functions/_shared/integration-crypto.ts`
- `supabase/config.toml` (contains only the `[functions.affiliate-sync-preflight] verify_jwt = false` block; the function verifies the bearer token itself)

Safety review of the handler:

- POST-only: `OPTIONS` returns 204, every other method returns 405.
- No provider API calls, no `SyncEngine`, no `ImportPipeline`, no `import_apply` — those modules are not imported at all.
- Reads only: `auth.getUser`, one `user_roles` select, one `affiliate_integrations` select, one `affiliate_integration_credentials` select. No insert/update/delete/RPC.
- Response body is only six booleans (`authenticated`, `admin`, `privilegedClient`, `integrationFound`, `credentialsReadable`, `credentialsDecryptable`). No keys, ciphertext, plaintext, or database error detail. CORS origin is restricted to the configured site URL.

Cloud secrets: `INTEGRATION_CREDENTIAL_SECRET` and `SITE_URL` are both configured (values not read or displayed).

## What I will do on approval

1. Deploy exactly one function: `affiliate-sync-preflight`. Nothing else is deployed, and no full affiliate sync function is created.
2. Leave Preview Import, Run Import, the Admin Integrations UI, the database, RLS, and migrations untouched.
3. Report deployment status.

## How the preflight gets invoked afterwards

The safest invocation is a single `POST` with an empty body to the function endpoint, carrying your existing signed-in admin session token. I can run this through the edge-function test tool, which reuses your current preview session automatically, so no credential is ever pasted into chat. The call performs no writes and triggers no import; it returns only the six boolean flags, which tell us whether auth, the admin role, the privileged client, the Impact integration row, the stored credentials, and credential decryption all resolve inside the Edge runtime.

If you would rather not invoke it at all in this step, say so and I will stop after the deployment report.
