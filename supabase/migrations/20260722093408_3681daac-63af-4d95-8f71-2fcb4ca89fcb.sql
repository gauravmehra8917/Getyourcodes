
-- Helper: check whether current user is admin (matches existing pattern)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- Metadata table
CREATE TABLE public.affiliate_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  description TEXT,
  authentication_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_version TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  retry_attempts INTEGER NOT NULL DEFAULT 3,
  custom_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  endpoint_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_reference UUID,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_integrations TO authenticated;
GRANT ALL ON public.affiliate_integrations TO service_role;

ALTER TABLE public.affiliate_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view integrations"
  ON public.affiliate_integrations FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert integrations"
  ON public.affiliate_integrations FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update integrations"
  ON public.affiliate_integrations FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete integrations"
  ON public.affiliate_integrations FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_affiliate_integrations_updated_at
  BEFORE UPDATE ON public.affiliate_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER log_affiliate_integrations_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.affiliate_integrations
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_activity();

-- Credentials table (server-only)
CREATE TABLE public.affiliate_integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES public.affiliate_integrations(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only service_role may touch this table; RLS blocks all authenticated/anon access.
GRANT ALL ON public.affiliate_integration_credentials TO service_role;

ALTER TABLE public.affiliate_integration_credentials ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon → denied by default.

CREATE TRIGGER update_affiliate_integration_credentials_updated_at
  BEFORE UPDATE ON public.affiliate_integration_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX affiliate_integrations_created_at_idx ON public.affiliate_integrations (created_at DESC);
