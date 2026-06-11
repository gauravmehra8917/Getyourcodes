
-- Ensure private schema and has_role exist (RLS policies reference private.has_role)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

-- Lock down user_roles writes: only service role may modify; admins via SECURITY DEFINER could also be added later if needed.
DROP POLICY IF EXISTS "user_roles no client insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles no client update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles no client delete" ON public.user_roles;

CREATE POLICY "user_roles no client insert"
  ON public.user_roles AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "user_roles no client update"
  ON public.user_roles AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "user_roles no client delete"
  ON public.user_roles AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);

-- Allow public (anon + authenticated) SELECT on store-logos bucket so authenticated clients can also list/read via storage API, matching the public bucket intent.
DROP POLICY IF EXISTS "logos public read" ON storage.objects;
CREATE POLICY "logos public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'store-logos');
