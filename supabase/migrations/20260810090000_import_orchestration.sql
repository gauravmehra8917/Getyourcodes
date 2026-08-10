-- Provider-neutral import orchestration settings and durable run reporting.
ALTER TABLE public.affiliate_integrations
  ADD COLUMN IF NOT EXISTS orchestration_strategy text NOT NULL DEFAULT 'incremental'
    CHECK (orchestration_strategy IN ('incremental', 'discover_new_offers', 'refresh_existing_only', 'full_sync')),
  ADD COLUMN IF NOT EXISTS orchestration_page_size integer NOT NULL DEFAULT 100 CHECK (orchestration_page_size BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS orchestration_max_pages integer NOT NULL DEFAULT 2 CHECK (orchestration_max_pages BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS orchestration_max_api_calls integer NOT NULL DEFAULT 8 CHECK (orchestration_max_api_calls BETWEEN 1 AND 2000),
  ADD COLUMN IF NOT EXISTS orchestration_no_new_pages integer NOT NULL DEFAULT 2 CHECK (orchestration_no_new_pages BETWEEN 1 AND 100);

ALTER TABLE public.affiliate_import_runs
  ADD COLUMN IF NOT EXISTS import_strategy text NOT NULL DEFAULT 'incremental',
  ADD COLUMN IF NOT EXISTS pages_crawled integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_calls_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_fetched integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_provider_identities integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS existing_provider_identities integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_reason text;

CREATE INDEX IF NOT EXISTS affiliate_import_runs_integration_started_idx
  ON public.affiliate_import_runs (integration_id, started_at DESC);
