
CREATE TABLE IF NOT EXISTS public.newsletter_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at timestamptz NOT NULL DEFAULT now(),
  subscribers_count integer NOT NULL DEFAULT 0,
  coupons_sent integer NOT NULL DEFAULT 0,
  successful integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  execution_time integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_logs TO authenticated;
GRANT ALL ON public.newsletter_logs TO service_role;

ALTER TABLE public.newsletter_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read newsletter logs" ON public.newsletter_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert newsletter logs" ON public.newsletter_logs FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update newsletter logs" ON public.newsletter_logs FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete newsletter logs" ON public.newsletter_logs FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS newsletter_logs_sent_at_idx ON public.newsletter_logs (sent_at DESC);
