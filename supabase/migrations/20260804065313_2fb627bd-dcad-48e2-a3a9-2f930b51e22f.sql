GRANT SELECT ON public.head_entries TO anon;
CREATE POLICY "Public can read enabled head entries" ON public.head_entries FOR SELECT TO anon, authenticated USING (enabled = true);