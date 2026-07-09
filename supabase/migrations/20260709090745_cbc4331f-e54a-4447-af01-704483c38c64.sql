
-- Generic activity logger
CREATE OR REPLACE FUNCTION public.log_admin_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  entity_label text;
  entity_name text;
  entity_pk text;
  action_label text;
  actor uuid := auth.uid();
  descr text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
    action_label := 'delete';
  ELSIF TG_OP = 'INSERT' THEN
    rec := to_jsonb(NEW);
    action_label := 'create';
  ELSE
    rec := to_jsonb(NEW);
    action_label := 'update';
  END IF;

  entity_label := TG_TABLE_NAME;

  -- Entity primary key (user_roles keyed by user_id + role)
  IF entity_label = 'user_roles' THEN
    entity_pk := COALESCE(rec->>'user_id', '');
    entity_name := COALESCE(rec->>'role', '');
  ELSIF entity_label = 'site_settings' THEN
    entity_pk := COALESCE(rec->>'key', rec->>'id', '');
    entity_name := COALESCE(rec->>'key', '');
  ELSE
    entity_pk := COALESCE(rec->>'id', '');
    entity_name := COALESCE(
      rec->>'name',
      rec->>'title',
      rec->>'display_name',
      rec->>'slug',
      rec->>'key',
      ''
    );
  END IF;

  descr := initcap(action_label) || ' ' || entity_label ||
    CASE WHEN entity_name <> '' THEN ': ' || entity_name ELSE '' END;

  INSERT INTO public.admin_activity_log (actor_id, action, entity, entity_id, meta)
  VALUES (
    actor,
    action_label,
    entity_label,
    NULLIF(entity_pk, ''),
    jsonb_build_object(
      'name', entity_name,
      'description', descr,
      'op', TG_OP
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach triggers to each audited table
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'stores','categories','subcategories','coupons',
    'posts','pages','profiles','user_roles','site_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_activity ON public.%I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_log_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_admin_activity();',
      t
    );
  END LOOP;
END $$;

-- Make activity log tamper-proof: no updates, no deletes
DROP POLICY IF EXISTS "No updates on activity log" ON public.admin_activity_log;
DROP POLICY IF EXISTS "No deletes on activity log" ON public.admin_activity_log;
CREATE POLICY "No updates on activity log" ON public.admin_activity_log FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY "No deletes on activity log" ON public.admin_activity_log FOR DELETE USING (false);

-- Allow trigger inserts (SECURITY DEFINER runs as function owner; also relax the strict actor check
-- so writes made outside an admin session (webhooks, service role) still get logged)
DROP POLICY IF EXISTS "Admins insert activity log" ON public.admin_activity_log;
CREATE POLICY "System and admins insert activity log" ON public.admin_activity_log
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NULL
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );
