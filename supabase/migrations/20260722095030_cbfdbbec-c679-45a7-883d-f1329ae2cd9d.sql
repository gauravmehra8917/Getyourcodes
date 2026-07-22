
-- Add test/status columns to affiliate_integrations
ALTER TABLE public.affiliate_integrations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'never_tested',
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS last_test_result jsonb;

-- Case-insensitive unique names
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_integrations_name_unique
  ON public.affiliate_integrations (lower(integration_name));
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_integrations_provider_baseurl_unique
  ON public.affiliate_integrations (lower(provider_name), lower(base_url));

-- Connection test history
CREATE TABLE IF NOT EXISTS public.affiliate_integration_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.affiliate_integrations(id) ON DELETE CASCADE,
  status text NOT NULL,
  http_status int,
  latency_ms int,
  auth_status text,
  message text,
  environment text,
  tested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.affiliate_integration_tests TO authenticated;
GRANT ALL ON public.affiliate_integration_tests TO service_role;

ALTER TABLE public.affiliate_integration_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tests" ON public.affiliate_integration_tests
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins insert tests" ON public.affiliate_integration_tests
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS affiliate_integration_tests_by_integration
  ON public.affiliate_integration_tests (integration_id, created_at DESC);
