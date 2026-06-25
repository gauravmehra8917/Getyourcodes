
-- Add user_id to coupon_clicks for per-user browsing history (nullable for anonymous)
ALTER TABLE public.coupon_clicks ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_coupon_clicks_user_id ON public.coupon_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_clicks_coupon_id ON public.coupon_clicks(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_clicks_clicked_at ON public.coupon_clicks(clicked_at DESC);

-- New search_queries table to power analytics (most searched brands/products)
CREATE TABLE IF NOT EXISTS public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query text NOT NULL,
  source text NOT NULL DEFAULT 'search', -- 'search' | 'ai'
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.search_queries TO anon;
GRANT SELECT, INSERT ON public.search_queries TO authenticated;
GRANT ALL ON public.search_queries TO service_role;

ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert a search query"
  ON public.search_queries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Signed-in users can read aggregate searches"
  ON public.search_queries FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_search_queries_created_at ON public.search_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_query ON public.search_queries(lower(query));
