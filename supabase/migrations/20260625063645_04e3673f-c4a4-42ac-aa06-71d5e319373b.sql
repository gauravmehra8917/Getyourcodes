
DROP POLICY IF EXISTS "Signed-in users can read aggregate searches" ON public.search_queries;

CREATE POLICY "Users can read their own search queries"
ON public.search_queries
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_top_searches(_limit int DEFAULT 10)
RETURNS TABLE(query text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(btrim(query)) AS query, count(*)::bigint AS count
  FROM public.search_queries
  WHERE source = 'search' AND length(btrim(query)) > 0
  GROUP BY lower(btrim(query))
  ORDER BY count(*) DESC
  LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.get_top_ai_searches(_limit int DEFAULT 8)
RETURNS TABLE(query text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(btrim(query)) AS query, count(*)::bigint AS count
  FROM public.search_queries
  WHERE source = 'ai' AND length(btrim(query)) > 0
  GROUP BY lower(btrim(query))
  ORDER BY count(*) DESC
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.get_top_searches(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_top_ai_searches(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_searches(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_ai_searches(int) TO authenticated;
