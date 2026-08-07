GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishing_policies TO authenticated;
GRANT ALL ON public.publishing_policies TO service_role;
GRANT SELECT ON public.publishing_rotation_state TO authenticated;
GRANT ALL ON public.publishing_rotation_state TO service_role;

ALTER TABLE public.affiliate_import_runs
  ADD COLUMN IF NOT EXISTS policy_id uuid,
  ADD COLUMN IF NOT EXISTS policy_name text;