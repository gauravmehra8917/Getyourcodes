DROP POLICY IF EXISTS "Anyone can insert a non-empty search query" ON public.search_queries;
CREATE POLICY "Anyone can insert a non-empty search query" ON public.search_queries
FOR INSERT TO anon, authenticated
WITH CHECK (
  length(btrim(query)) BETWEEN 1 AND 200
  AND source = ANY (ARRAY['search'::text, 'ai'::text])
  AND (user_id IS NULL OR user_id = auth.uid())
);