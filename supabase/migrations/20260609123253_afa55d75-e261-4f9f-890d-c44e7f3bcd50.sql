CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;

ALTER POLICY "stores admin all" ON public.stores
USING (private.has_role(auth.uid(), 'admin'))
WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "logos admin read" ON storage.objects
USING (bucket_id = 'store-logos' AND private.has_role(auth.uid(), 'admin'));

ALTER POLICY "logos admin write" ON storage.objects
WITH CHECK (bucket_id = 'store-logos' AND private.has_role(auth.uid(), 'admin'));

ALTER POLICY "logos admin update" ON storage.objects
USING (bucket_id = 'store-logos' AND private.has_role(auth.uid(), 'admin'));

ALTER POLICY "logos admin delete" ON storage.objects
USING (bucket_id = 'store-logos' AND private.has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupons' AND policyname = 'coupons admin all') THEN
    ALTER POLICY "coupons admin all" ON public.coupons
    USING (private.has_role(auth.uid(), 'admin'))
    WITH CHECK (private.has_role(auth.uid(), 'admin'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'categories' AND policyname = 'categories admin all') THEN
    ALTER POLICY "categories admin all" ON public.categories
    USING (private.has_role(auth.uid(), 'admin'))
    WITH CHECK (private.has_role(auth.uid(), 'admin'));
  END IF;
END $$;