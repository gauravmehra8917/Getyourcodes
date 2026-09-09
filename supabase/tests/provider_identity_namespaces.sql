-- A11-S4-I1 namespace-cutover regression matrix.
-- Run only against a disposable database after all repository migrations.
-- Every fixture and mutation is rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

CREATE FUNCTION pg_temp.assert_true(_condition boolean, _label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF _condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion_failed: %', _label;
  END IF;
END;
$function$;

DO $test$
DECLARE
  fixture_integration_id constant uuid :=
    'a1100000-0000-4000-8000-000000000001';
  parent_store_id uuid;
  campaign_store_id uuid;
  fixture_run_id uuid;
  row_count integer;
BEGIN
  INSERT INTO public.affiliate_integrations (
    id, integration_name, provider_name, provider_type,
    authentication_type, base_url, is_enabled
  ) VALUES (
    fixture_integration_id, 'A11 namespace fixture', 'impact', 'affiliate',
    'basic', 'https://a11-namespace.invalid', true
  );

  -- Schema: the all-null branch remains valid for manual catalog rows.
  INSERT INTO public.stores (name, slug)
  VALUES ('A11 namespace manual parent', 'a11-namespace-manual-parent')
  RETURNING id INTO parent_store_id;
  INSERT INTO public.coupons (store_id, title)
  VALUES (parent_store_id, 'A11 namespace manual coupon');
  PERFORM pg_temp.assert_true(
    (SELECT provider IS NULL
       AND provider_entity_namespace IS NULL
       AND provider_entity_id IS NULL
     FROM public.stores WHERE id = parent_store_id)
    AND
    (SELECT provider IS NULL
       AND provider_entity_namespace IS NULL
       AND provider_entity_id IS NULL
     FROM public.coupons
     WHERE title = 'A11 namespace manual coupon'),
    'manual rows retain an all-null identity triple'
  );

  -- Schema: every partial, blank, padded, or unsupported triple fails closed.
  BEGIN
    INSERT INTO public.stores (name, slug, provider)
    VALUES ('Partial store', 'a11-partial-store', 'impact');
    RAISE EXCEPTION 'assertion_failed: partial store triple accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace
    ) VALUES (parent_store_id, 'Partial offer', 'impact', 'promotion');
    RAISE EXCEPTION 'assertion_failed: partial offer triple accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.stores (
      name, slug, provider, provider_entity_namespace, provider_entity_id
    ) VALUES ('Blank namespace', 'a11-blank-namespace', 'impact', '', 'A');
    RAISE EXCEPTION 'assertion_failed: blank store namespace accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.stores (
      name, slug, provider, provider_entity_namespace, provider_entity_id
    ) VALUES ('Padded id', 'a11-padded-id', 'impact', 'campaign', ' A');
    RAISE EXCEPTION 'assertion_failed: padded store identity accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (parent_store_id, 'Padded namespace', 'impact', ' promotion', 'A');
    RAISE EXCEPTION 'assertion_failed: padded offer namespace accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.stores (
      name, slug, provider, provider_entity_namespace, provider_entity_id
    ) VALUES ('Unsupported store', 'a11-unsupported-store', 'impact', 'ad', 'A');
    RAISE EXCEPTION 'assertion_failed: unsupported Impact store namespace accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (parent_store_id, 'Unsupported offer', 'impact', 'campaign', 'A');
    RAISE EXCEPTION 'assertion_failed: unsupported Impact offer namespace accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Schema: every approved namespace is accepted exactly.
  INSERT INTO public.stores (
    name, slug, provider, provider_entity_namespace, provider_entity_id
  ) VALUES
    ('Campaign store', 'a11-campaign-store', 'impact', 'campaign', 'SCHEMA-CAMPAIGN'),
    ('Legacy store', 'a11-legacy-store', 'impact', 'legacy', 'SCHEMA-LEGACY');
  SELECT id INTO STRICT campaign_store_id
  FROM public.stores
  WHERE provider = 'impact'
    AND provider_entity_namespace = 'campaign'
    AND provider_entity_id = 'SCHEMA-CAMPAIGN';
  INSERT INTO public.coupons (
    store_id, title, provider, provider_entity_namespace, provider_entity_id
  ) VALUES
    (parent_store_id, 'Promotion identity', 'impact', 'promotion', 'SHARED-ID'),
    (parent_store_id, 'Ad identity', 'impact', 'ad', 'SHARED-ID'),
    (parent_store_id, 'Legacy identity', 'impact', 'legacy', 'LEGACY-ID');
  PERFORM pg_temp.assert_true(
    (SELECT count(*) = 2 FROM public.coupons
     WHERE provider = 'impact'
       AND provider_entity_id = 'SHARED-ID'
       AND provider_entity_namespace IN ('promotion', 'ad')),
    'Promotion and Ad IDs with identical text coexist in separate namespaces'
  );

  BEGIN
    INSERT INTO public.stores (
      name, slug, provider, provider_entity_namespace, provider_entity_id
    ) VALUES ('Duplicate campaign', 'a11-duplicate-campaign', 'impact', 'campaign', 'SCHEMA-CAMPAIGN');
    RAISE EXCEPTION 'assertion_failed: duplicate campaign triple accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (parent_store_id, 'Duplicate Promotion', 'impact', 'promotion', 'SHARED-ID');
    RAISE EXCEPTION 'assertion_failed: duplicate Promotion triple accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Ledger identity is namespace-aware; the same text may identify a future
  -- Ad without colliding with a Promotion, while an exact triple is unique.
  INSERT INTO public.affiliate_import_runs (
    integration_id, provider, preview, success, statistics
  ) VALUES (fixture_integration_id, 'impact', false, false, '{}'::jsonb)
  RETURNING id INTO fixture_run_id;
  INSERT INTO public.affiliate_import_run_mutations_v2 (
    run_id, instruction_ordinal, entity_kind, planned_action, outcome,
    provider, provider_entity_namespace, provider_entity_id, entity_id,
    parent_provider_entity_namespace, parent_provider_entity_id,
    parent_entity_id, offer_kind
  ) VALUES
    (fixture_run_id, 0, 'offer', 'create', 'created', 'impact', 'promotion',
     'LEDGER-SHARED', gen_random_uuid(), 'campaign', 'LEDGER-PARENT',
     campaign_store_id, 'coupon'),
    (fixture_run_id, 1, 'offer', 'create', 'created', 'impact', 'ad',
     'LEDGER-SHARED', gen_random_uuid(), 'campaign', 'LEDGER-PARENT',
     campaign_store_id, 'coupon');
  BEGIN
    INSERT INTO public.affiliate_import_run_mutations_v2 (
      run_id, instruction_ordinal, entity_kind, planned_action, outcome,
      provider, provider_entity_namespace, provider_entity_id, entity_id,
      parent_provider_entity_namespace, parent_provider_entity_id,
      parent_entity_id, offer_kind
    ) VALUES (
      fixture_run_id, 2, 'offer', 'create', 'created', 'impact', 'promotion',
      'LEDGER-SHARED', gen_random_uuid(), 'campaign', 'LEDGER-PARENT',
      campaign_store_id, 'coupon'
    );
    RAISE EXCEPTION 'assertion_failed: duplicate ledger namespace triple accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT count(*) INTO row_count
  FROM public.affiliate_import_run_mutations_v2 AS mutation
  WHERE mutation.run_id = fixture_run_id;
  PERFORM pg_temp.assert_true(
    row_count = 2,
    'ledger run identity includes the provider namespace'
  );
END;
$test$;

SELECT extensions.pass('A11-S4-I1 namespace assertion matrix completed');
SELECT * FROM extensions.finish();

ROLLBACK;
