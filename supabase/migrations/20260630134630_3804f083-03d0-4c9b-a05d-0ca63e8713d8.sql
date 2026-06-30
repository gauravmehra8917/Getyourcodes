
-- 1) site_settings: remove public read; admins-only
DROP POLICY IF EXISTS "Public can read site settings" ON public.site_settings;

-- 2) subscribers: prevent email enumeration via unique-violation probing.
-- Drop direct insert policies and route signups through a SECURITY DEFINER RPC
-- that always returns success regardless of pre-existing email.
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.subscribers;
DROP POLICY IF EXISTS "Authed can subscribe" ON public.subscribers;
REVOKE INSERT ON public.subscribers FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.subscribe_email(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e text := lower(btrim(coalesce(_email, '')));
BEGIN
  IF length(e) < 6 OR length(e) > 254
     OR e !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.subscribers (email) VALUES (e)
  ON CONFLICT (email) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_email(text) TO anon, authenticated;
