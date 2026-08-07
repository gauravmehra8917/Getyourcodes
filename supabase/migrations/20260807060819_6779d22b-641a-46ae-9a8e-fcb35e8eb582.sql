CREATE TABLE public.publishing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  min_coupons_per_store integer NOT NULL DEFAULT 0,
  max_coupons_per_store integer NOT NULL DEFAULT 0,
  min_deals_per_store integer NOT NULL DEFAULT 0,
  max_deals_per_store integer NOT NULL DEFAULT 0,
  ranking_priority text[] NOT NULL DEFAULT ARRAY['merchant_priority','discount','newest','expiry']::text[],
  fair_distribution boolean NOT NULL DEFAULT true,
  rotation boolean NOT NULL DEFAULT false,
  publish_only_active boolean NOT NULL DEFAULT true,
  skip_expired boolean NOT NULL DEFAULT true,
  skip_duplicate_identities boolean NOT NULL DEFAULT true,
  respect_manual_disable boolean NOT NULL DEFAULT true,
  never_overwrite_admin_edits boolean NOT NULL DEFAULT true,
  preview_before_import boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishing_policies TO authenticated;
GRANT ALL ON public.publishing_policies TO service_role;

ALTER TABLE public.publishing_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage publishing policies"
  ON public.publishing_policies FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE UNIQUE INDEX publishing_policies_single_default
  ON public.publishing_policies (is_default) WHERE is_default;

CREATE TRIGGER trg_publishing_policies_updated
  BEFORE UPDATE ON public.publishing_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.publishing_policies
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_activity();

CREATE TABLE public.publishing_rotation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.publishing_policies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  store_key text NOT NULL,
  cursor integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, provider, store_key)
);

GRANT SELECT ON public.publishing_rotation_state TO authenticated;
GRANT ALL ON public.publishing_rotation_state TO service_role;

ALTER TABLE public.publishing_rotation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read rotation state"
  ON public.publishing_rotation_state FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_publishing_rotation_state_updated
  BEFORE UPDATE ON public.publishing_rotation_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.affiliate_integrations
  ADD COLUMN publishing_policy_id uuid REFERENCES public.publishing_policies(id) ON DELETE SET NULL;

ALTER TABLE public.affiliate_import_runs
  ADD COLUMN publishing_policy_id uuid REFERENCES public.publishing_policies(id) ON DELETE SET NULL,
  ADD COLUMN publishing_policy_name text,
  ADD COLUMN records_published integer NOT NULL DEFAULT 0,
  ADD COLUMN records_held integer NOT NULL DEFAULT 0,
  ADD COLUMN publishing_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.publishing_policies (name, description, enabled, is_default)
VALUES ('Global Default', 'Default publishing rules applied to every integration without a custom policy.', true, true);