-- Catalog Lifecycle Phase 1: provenance and lifecycle state only.
-- This migration is additive and deliberately does not change import behavior.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS import_origin text,
  ADD COLUMN IF NOT EXISTS lifecycle_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lifecycle_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_qualification_result text,
  ADD COLUMN IF NOT EXISTS last_qualified_at timestamptz,
  ADD CONSTRAINT stores_import_origin_check
    CHECK (import_origin IS NULL OR import_origin IN ('provider')),
  ADD CONSTRAINT stores_last_qualification_result_check
    CHECK (last_qualification_result IS NULL OR last_qualification_result IN ('qualified', 'unqualified'));

-- Only rows with a complete immutable provider identity are safely known to
-- originate from an import. Ambiguous/manual rows remain unmanaged.
UPDATE public.stores
SET import_origin = 'provider', lifecycle_managed = true
WHERE provider IS NOT NULL
  AND provider_entity_id IS NOT NULL
  AND import_origin IS NULL
  AND lifecycle_managed = false;
