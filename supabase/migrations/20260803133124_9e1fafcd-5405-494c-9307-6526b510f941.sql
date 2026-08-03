CREATE TABLE public.head_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN ('verification','analytics','structured_data','custom_html')),
  provider text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  value text,
  content text,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.head_entries TO authenticated;
GRANT ALL ON public.head_entries TO service_role;

ALTER TABLE public.head_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage head entries"
ON public.head_entries FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_head_entries_section ON public.head_entries (section);
CREATE INDEX idx_head_entries_provider ON public.head_entries (lower(provider));

CREATE TRIGGER trg_head_entries_updated
BEFORE UPDATE ON public.head_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_log_activity
AFTER INSERT OR UPDATE OR DELETE ON public.head_entries
FOR EACH ROW EXECUTE FUNCTION public.log_admin_activity();