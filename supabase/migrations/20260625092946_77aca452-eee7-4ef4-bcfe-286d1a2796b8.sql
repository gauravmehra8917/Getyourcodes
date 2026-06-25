DROP POLICY IF EXISTS "Anyone can subscribe" ON public.subscribers;
DROP POLICY IF EXISTS "Authed can subscribe" ON public.subscribers;

CREATE POLICY "Anyone can subscribe"
ON public.subscribers FOR INSERT TO anon
WITH CHECK (
  email = lower(btrim(email))
  AND length(email) BETWEEN 6 AND 254
  AND email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);

CREATE POLICY "Authed can subscribe"
ON public.subscribers FOR INSERT TO authenticated
WITH CHECK (
  email = lower(btrim(email))
  AND length(email) BETWEEN 6 AND 254
  AND email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);