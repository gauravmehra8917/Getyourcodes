
DROP POLICY IF EXISTS "Anyone can insert a search query" ON public.search_queries;
CREATE POLICY "Anyone can insert a non-empty search query"
  ON public.search_queries FOR INSERT
  TO anon, authenticated
  WITH CHECK (length(btrim(query)) BETWEEN 1 AND 200 AND source IN ('search','ai'));
