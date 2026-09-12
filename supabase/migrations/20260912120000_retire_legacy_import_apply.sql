-- I4: Physical retirement of the legacy V1 affiliate import RPC.
--
-- Source runtime callers were removed and verified before this migration.
-- Production preflight confirmed:
--   - exactly one public.import_apply overload
--   - exact signature public.import_apply(jsonb)
--   - zero PostgreSQL dependent objects
--
-- Intentionally no CASCADE:
-- if an unexpected dependency exists at deployment time, fail closed.

DROP FUNCTION public.import_apply(jsonb);
