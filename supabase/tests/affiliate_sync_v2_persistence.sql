-- A9C-S2 disposable-database regression suite.
--
-- Run only after applying repository migrations to a disposable local
-- Supabase/PostgreSQL database. This script wraps every fixture and mutation in
-- one transaction and always rolls it back. It contains no project reference,
-- remote URL, token, provider credential, or production identifier.

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

CREATE FUNCTION pg_temp.expected_counts(
  _store_create integer DEFAULT 0,
  _store_existing integer DEFAULT 0,
  _store_unmatched integer DEFAULT 0,
  _offer_create integer DEFAULT 0,
  _offer_existing integer DEFAULT 0,
  _offer_held integer DEFAULT 0,
  _offer_unresolved integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'stores', jsonb_build_object(
      'create', _store_create,
      'noopExisting', _store_existing,
      'blockedAmbiguous', 0,
      'noopUnmatched', _store_unmatched
    ),
    'offers', jsonb_build_object(
      'create', _offer_create,
      'noopExisting', _offer_existing,
      'noopHeld', _offer_held,
      'noopUnresolved', _offer_unresolved
    ),
    'writableStores', _store_create,
    'writableOffers', _offer_create,
    'writableEntities', _store_create + _offer_create
  );
$function$;

CREATE FUNCTION pg_temp.store_create(
  _ordinal integer,
  _campaign_id text,
  _slug text,
  _evaluated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'create',
    'provider', 'impact',
    'providerEntityId', _campaign_id,
    'expectedExistingStoreId', NULL,
    'qualified', true,
    'projection', jsonb_build_object(
      'name', 'Fixture ' || _campaign_id,
      'slugCandidate', _slug,
      'description', NULL,
      'affiliateUrl', 'https://tracking.invalid/' || _campaign_id,
      'destinationUrl', 'https://destination.invalid/' || _campaign_id,
      'country', NULL,
      'shippingRegions', '[]'::jsonb,
      'logoSourceUrl', NULL,
      'metadata', jsonb_build_object(
        'advertiserId', NULL,
        'campaignId', _campaign_id
      ),
      'importOrigin', 'provider',
      'lifecycleManaged', true,
      'lifecycleHidden', false,
      'lastQualificationResult', 'qualified',
      'lastQualifiedAt', _evaluated_at
    )
  );
$function$;

CREATE FUNCTION pg_temp.store_existing(
  _ordinal integer,
  _campaign_id text,
  _store_id uuid
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'noop_existing',
    'provider', 'impact',
    'providerEntityId', _campaign_id,
    'expectedExistingStoreId', _store_id,
    'qualified', true,
    'projection', NULL
  );
$function$;

CREATE FUNCTION pg_temp.offer_create(
  _ordinal integer,
  _promotion_id text,
  _kind text,
  _campaign_id text,
  _expected_store_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'create',
    'provider', 'impact',
    'providerEntityId', _promotion_id,
    'kind', _kind,
    'existingOfferId', NULL,
    'parentProviderEntityId', _campaign_id,
    'expectedParentStoreId', _expected_store_id,
    'projection', jsonb_build_object(
      'title', 'Fixture ' || _promotion_id,
      'description', NULL,
      'couponCode', CASE WHEN _kind = 'coupon' THEN 'FIXTURE' ELSE NULL END,
      'couponType', CASE WHEN _kind = 'coupon' THEN 'code' ELSE 'deal' END,
      'affiliateUrl', 'https://tracking.invalid/' || _promotion_id,
      'landingPageUrl', NULL,
      'startDate', '2026-08-01',
      'expiryDate', '2026-12-31',
      'status', 'active',
      'terms', CASE WHEN _kind = 'coupon' THEN 'Fixture terms' ELSE NULL END,
      'discountType', NULL,
      'discountValue', NULL,
      'metadata', jsonb_build_object(
        'advertiserId', NULL,
        'campaignId', _campaign_id,
        'programId', NULL,
        'resolvedCampaignId', _campaign_id
      )
    )
  );
$function$;

CREATE FUNCTION pg_temp.offer_existing(
  _ordinal integer,
  _promotion_id text,
  _kind text,
  _offer_id uuid,
  _campaign_id text,
  _store_id uuid
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'noop_existing',
    'provider', 'impact',
    'providerEntityId', _promotion_id,
    'kind', _kind,
    'existingOfferId', _offer_id,
    'parentProviderEntityId', _campaign_id,
    'expectedParentStoreId', _store_id,
    'projection', NULL
  );
$function$;

CREATE FUNCTION pg_temp.fail_selected_v2_run()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.plan_fingerprint = repeat('1', 64) THEN
    RAISE EXCEPTION 'forced_run_failure';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION pg_temp.fail_selected_v2_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.provider_entity_id = 'campaign-ledger-failure' THEN
    RAISE EXCEPTION 'forced_ledger_failure';
  END IF;
  RETURN NEW;
END;
$function$;

DO $test$
DECLARE
  integration_a constant uuid := '10000000-0000-4000-8000-000000000001';
  integration_b constant uuid := '10000000-0000-4000-8000-000000000002';
  actor_id constant uuid := '20000000-0000-4000-8000-000000000001';
  evaluated_at constant timestamptz := '2026-08-19T00:00:00Z';
  result_one jsonb;
  result_two jsonb;
  counts jsonb;
  stores jsonb;
  offers jsonb;
  store_id uuid;
  other_store_id uuid;
  offer_id uuid;
  before_store jsonb;
  after_store jsonb;
  before_offer jsonb;
  after_offer jsonb;
  valid_persistence_counts jsonb;
  legacy_run_id uuid;
  complete_v2_run_id uuid;
  null_field text;
  invalid_identity text;
  valid_identity text;
  invalid_lifecycle_value jsonb;
  ledger_offer_kind text;
  function_definition text;
  function_search_path text[];
  row_count integer;
BEGIN
  INSERT INTO public.affiliate_integrations (
    id, integration_name, provider_name, provider_type,
    authentication_type, base_url, is_enabled
  ) VALUES
    (
      integration_a, 'A9C-S2 Fixture A', 'Impact', 'affiliate',
      'basic', 'https://fixture-a.invalid', true
    ),
    (
      integration_b, 'A9C-S2 Fixture B', 'impact.com', 'affiliate',
      'basic', 'https://fixture-b.invalid', true
    );

  -- A: a legacy-style row remains valid with every V2 field null.
  INSERT INTO public.affiliate_import_runs (
    integration_id, provider, preview, success, statistics
  ) VALUES (
    integration_a, 'impact', false, false, '{}'::jsonb
  ) RETURNING id INTO legacy_run_id;
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.affiliate_import_runs
    WHERE integration_id = integration_a
      AND persistence_contract_version IS NULL
      AND plan_fingerprint_algorithm IS NULL
      AND plan_fingerprint IS NULL
      AND plan_evaluated_at IS NULL
      AND persistence_execution_status IS NULL
      AND persistence_counts IS NULL
  ), 'A legacy row remains all-null for V2 fields');
  valid_persistence_counts := jsonb_build_object(
    'expected', pg_temp.expected_counts(),
    'actual', jsonb_build_object(
      'storesCreated', 0,
      'storesNoopExisting', 0,
      'offersCreated', 0,
      'offersNoopExisting', 0,
      'ledgerRows', 0
    )
  );

  -- A-R2: each of the six nullable V2 fields is independently required in the
  -- complete branch. A rejected partial cannot reserve the replay fingerprint.
  FOREACH null_field IN ARRAY ARRAY[
    'persistence_contract_version',
    'plan_fingerprint_algorithm',
    'plan_fingerprint',
    'plan_evaluated_at',
    'persistence_execution_status',
    'persistence_counts'
  ]
  LOOP
    BEGIN
      INSERT INTO public.affiliate_import_runs (
        integration_id, provider, preview, finished_at, success,
        records_updated, error_message, statistics, triggered_by,
        persistence_contract_version, plan_fingerprint_algorithm,
        plan_fingerprint, plan_evaluated_at, persistence_execution_status,
        persistence_counts
      ) VALUES (
        integration_a, 'impact', false, evaluated_at, true,
        0, NULL, '{}'::jsonb, actor_id,
        CASE WHEN null_field = 'persistence_contract_version' THEN NULL ELSE 'v2-a9b-1' END,
        CASE WHEN null_field = 'plan_fingerprint_algorithm' THEN NULL ELSE 'sha256-canonical-plan-v1' END,
        CASE WHEN null_field = 'plan_fingerprint' THEN NULL ELSE repeat('ef', 32) END,
        CASE WHEN null_field = 'plan_evaluated_at' THEN NULL ELSE evaluated_at END,
        CASE WHEN null_field = 'persistence_execution_status' THEN NULL ELSE 'committed' END,
        CASE WHEN null_field = 'persistence_counts' THEN NULL ELSE valid_persistence_counts END
      );
      RAISE EXCEPTION 'assertion_failed: partial V2 run accepted with null %', null_field;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.affiliate_import_runs
    WHERE integration_id = integration_a
      AND plan_fingerprint = repeat('ef', 32)
  ), 'A malformed partial cannot occupy the replay namespace');

  INSERT INTO public.affiliate_import_runs (
    integration_id, provider, preview, finished_at, success,
    records_updated, error_message, statistics, triggered_by,
    persistence_contract_version, plan_fingerprint_algorithm,
    plan_fingerprint, plan_evaluated_at, persistence_execution_status,
    persistence_counts
  ) VALUES (
    integration_a, 'impact', false, evaluated_at, true,
    0, NULL, '{}'::jsonb, actor_id,
    'v2-a9b-1', 'sha256-canonical-plan-v1', repeat('ef', 32),
    evaluated_at, 'committed', valid_persistence_counts
  ) RETURNING id INTO complete_v2_run_id;
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.affiliate_import_runs
    WHERE id = complete_v2_run_id
      AND persistence_execution_status = 'committed'
  ), 'A complete V2 row succeeds after rejected partials');

  -- A-R2 ledger shape: offer rows require a concrete closed kind; store rows
  -- require NULL. Valid rows retain exact provider identity bytes.
  BEGIN
    INSERT INTO public.affiliate_import_run_mutations_v2 (
      run_id, instruction_ordinal, entity_kind, planned_action, outcome,
      provider, provider_entity_id, entity_id, parent_provider_entity_id,
      parent_entity_id, offer_kind
    ) VALUES (
      legacy_run_id, 100, 'offer', 'create', 'created',
      'impact', 'offer-null-kind', gen_random_uuid(), 'ABC',
      gen_random_uuid(), NULL
    );
    RAISE EXCEPTION 'assertion_failed: offer ledger accepted NULL offer_kind';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO public.affiliate_import_run_mutations_v2 (
    run_id, instruction_ordinal, entity_kind, planned_action, outcome,
    provider, provider_entity_id, entity_id, parent_provider_entity_id,
    parent_entity_id, offer_kind
  ) VALUES
    (
      legacy_run_id, 101, 'offer', 'create', 'created',
      'impact', '00123', gen_random_uuid(), 'abc-DEF_123',
      gen_random_uuid(), 'coupon'
    ),
    (
      legacy_run_id, 102, 'offer', 'create', 'created',
      'impact', 'A.B:C/9', gen_random_uuid(), 'ABC',
      gen_random_uuid(), 'deal'
    ),
    (
      legacy_run_id, 103, 'store', 'create', 'created',
      'impact', 'ABC', gen_random_uuid(), NULL,
      NULL, NULL
    );
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.affiliate_import_run_mutations_v2
    WHERE run_id = legacy_run_id
      AND provider_entity_id = '00123'
      AND parent_provider_entity_id = 'abc-DEF_123'
      AND offer_kind = 'coupon'
  ), 'A coupon ledger row and exact identities are accepted unchanged');
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.affiliate_import_run_mutations_v2
    WHERE run_id = legacy_run_id
      AND provider_entity_id = 'A.B:C/9'
      AND offer_kind = 'deal'
  ), 'A deal ledger row and punctuation identity are accepted unchanged');
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.affiliate_import_run_mutations_v2
    WHERE run_id = legacy_run_id
      AND entity_kind = 'store'
      AND provider_entity_id = 'ABC'
      AND offer_kind IS NULL
  ), 'A store ledger row with NULL offer_kind remains valid');
  FOREACH ledger_offer_kind IN ARRAY ARRAY['coupon', 'deal']
  LOOP
    BEGIN
      INSERT INTO public.affiliate_import_run_mutations_v2 (
        run_id, instruction_ordinal, entity_kind, planned_action, outcome,
        provider, provider_entity_id, entity_id, offer_kind
      ) VALUES (
        legacy_run_id,
        CASE WHEN ledger_offer_kind = 'coupon' THEN 104 ELSE 105 END,
        'store', 'create', 'created', 'impact',
        'store-invalid-' || ledger_offer_kind, gen_random_uuid(), ledger_offer_kind
      );
      RAISE EXCEPTION 'assertion_failed: store ledger accepted % offer_kind', ledger_offer_kind;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  FOREACH invalid_identity IN ARRAY ARRAY[
    '', ' ', '   ', E'\t', E'\n', E'\r', E'\r\n',
    ' ABC', 'ABC ', E'\tABC', E'ABC\t', E'\nABC', E'ABC\n',
    E'\rABC', E'ABC\r', U&'\00A0ABC', U&'ABC\FEFF'
  ]
  LOOP
    PERFORM pg_temp.assert_true(
      NOT public.affiliate_sync_v2_is_canonical_provider_id(invalid_identity),
      'A malformed boundary-whitespace identity is rejected by the canonical predicate'
    );
    BEGIN
      INSERT INTO public.affiliate_import_run_mutations_v2 (
        run_id, instruction_ordinal, entity_kind, planned_action, outcome,
        provider, provider_entity_id, entity_id
      ) VALUES (
        legacy_run_id, 106, 'store', 'create', 'created',
        'impact', invalid_identity, gen_random_uuid()
      );
      RAISE EXCEPTION 'assertion_failed: ledger accepted malformed provider identity';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    BEGIN
      INSERT INTO public.affiliate_import_run_mutations_v2 (
        run_id, instruction_ordinal, entity_kind, planned_action, outcome,
        provider, provider_entity_id, entity_id, parent_provider_entity_id,
        parent_entity_id, offer_kind
      ) VALUES (
        legacy_run_id, 107, 'offer', 'create', 'created',
        'impact', 'valid-ledger-offer', gen_random_uuid(), invalid_identity,
        gen_random_uuid(), 'coupon'
      );
      RAISE EXCEPTION 'assertion_failed: ledger accepted malformed parent identity';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
  FOREACH valid_identity IN ARRAY ARRAY[
    'ABC', '00123', 'abc-DEF_123', 'A.B:C/9', E'A\tB', E'A\nB'
  ]
  LOOP
    PERFORM pg_temp.assert_true(
      public.affiliate_sync_v2_is_canonical_provider_id(valid_identity),
      'A valid exact provider identity is accepted without normalization'
    );
  END LOOP;

  -- B/AA: exact replay creates one logical run and returns the same run ID.
  counts := pg_temp.expected_counts();
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('a', 64), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('a', 64), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed', 'B first request commits');
  PERFORM pg_temp.assert_true(result_two->>'status' = 'replayed_existing', 'B second request replays');
  PERFORM pg_temp.assert_true(result_one->>'runId' = result_two->>'runId', 'AA replay returns same run');
  SELECT count(*) INTO row_count FROM public.affiliate_import_runs
  WHERE integration_id = integration_a AND plan_fingerprint = repeat('a', 64);
  PERFORM pg_temp.assert_true(row_count = 1, 'B replay creates one run');

  -- C: structural concurrency prerequisites. True concurrent sessions are
  -- exercised by the external harness when one is available.
  SELECT pg_get_functiondef('public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)'::regprocedure)
    INTO function_definition;
  PERFORM pg_temp.assert_true(
    position('FOR UPDATE' IN function_definition) > 0
      AND position('FOR UPDATE' IN function_definition) <
        position('FROM public.affiliate_import_runs AS run' IN function_definition),
    'C integration row lock precedes replay lookup'
  );
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'affiliate_import_runs_v2_replay_uidx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ), 'C replay uniqueness backstop exists');

  -- D: two create plans for one CampaignId resolve to one store.
  counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_create(0, 'campaign-one', 'campaign-one', evaluated_at));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('b', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('c', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed', 'D first store commits');
  PERFORM pg_temp.assert_true(result_two#>>'{counts,actual,storesNoopExisting}' = '1', 'D second create becomes no-op');
  SELECT count(*) INTO row_count FROM public.stores
  WHERE provider = 'impact' AND provider_entity_id = 'campaign-one';
  SELECT id INTO store_id FROM public.stores
  WHERE provider = 'impact' AND provider_entity_id = 'campaign-one';
  PERFORM pg_temp.assert_true(row_count = 1, 'D CampaignId has one store');

  -- E: two create plans for one PromotionId resolve to one offer.
  counts := pg_temp.expected_counts(0, 1, 0, 1, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_existing(0, 'campaign-one', store_id));
  offers := jsonb_build_array(pg_temp.offer_create(1, 'promotion-one', 'coupon', 'campaign-one', store_id));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('d', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('e', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_two;
  SELECT count(*) INTO row_count FROM public.coupons
  WHERE provider = 'impact' AND provider_entity_id = 'promotion-one';
  SELECT id INTO offer_id FROM public.coupons
  WHERE provider = 'impact' AND provider_entity_id = 'promotion-one';
  PERFORM pg_temp.assert_true(row_count = 1, 'E PromotionId has one offer');
  PERFORM pg_temp.assert_true(result_two#>>'{counts,actual,offersNoopExisting}' = '1', 'E second create becomes no-op');

  -- R2 exact-identity RPC matrix: every settled boundary-invalid value is
  -- rejected independently as CampaignId, PromotionId, and parent CampaignId.
  FOREACH invalid_identity IN ARRAY ARRAY[
    '', ' ', '   ', E'\t', E'\n', E'\r', E'\r\n',
    ' ABC', 'ABC ', E'\tABC', E'ABC\t', E'\nABC', E'ABC\n',
    E'\rABC', E'ABC\r', U&'\00A0ABC', U&'ABC\FEFF'
  ]
  LOOP
    counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
    stores := jsonb_build_array(
      pg_temp.store_create(0, invalid_identity, 'invalid-campaign-probe', evaluated_at)
    );
    SELECT public.apply_affiliate_persistence_plan_v2(
      integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
      repeat('a2', 32), evaluated_at, actor_id, counts, stores, '[]'::jsonb
    ) INTO result_one;
    PERFORM pg_temp.assert_true(
      result_one->>'status' = 'blocked'
        AND result_one->>'reason' = 'invalid_store_instruction',
      'R2 malformed CampaignId is rejected by the RPC'
    );

    counts := pg_temp.expected_counts(0, 1, 0, 1, 0, 0, 0);
    stores := jsonb_build_array(pg_temp.store_existing(0, 'campaign-one', store_id));
    offers := jsonb_build_array(
      pg_temp.offer_create(1, invalid_identity, 'coupon', 'campaign-one', store_id)
    );
    SELECT public.apply_affiliate_persistence_plan_v2(
      integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
      repeat('a2', 32), evaluated_at, actor_id, counts, stores, offers
    ) INTO result_one;
    PERFORM pg_temp.assert_true(
      result_one->>'status' = 'blocked'
        AND result_one->>'reason' = 'invalid_offer_instruction',
      'R2 malformed PromotionId is rejected by the RPC'
    );

    offers := jsonb_build_array(
      pg_temp.offer_create(1, 'valid-parent-probe-offer', 'coupon', invalid_identity, store_id)
    );
    SELECT public.apply_affiliate_persistence_plan_v2(
      integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
      repeat('a2', 32), evaluated_at, actor_id, counts, stores, offers
    ) INTO result_one;
    PERFORM pg_temp.assert_true(
      result_one->>'status' = 'blocked'
        AND result_one->>'reason' = 'invalid_offer_instruction',
      'R2 malformed parent CampaignId is rejected by the RPC'
    );
    PERFORM pg_temp.assert_true(
      NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact' AND provider_entity_id = invalid_identity
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.coupons
        WHERE provider = 'impact' AND provider_entity_id = invalid_identity
      ),
      'R2 no malformed identity commits to the catalog'
    );
  END LOOP;
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.affiliate_import_runs
    WHERE integration_id = integration_a AND plan_fingerprint = repeat('a2', 32)
  ), 'R2 rejected identity plans create no run');

  -- Valid case, leading zeroes, case, underscores and punctuation remain exact.
  counts := pg_temp.expected_counts(4, 0, 0, 4, 0, 0, 0);
  stores := jsonb_build_array(
    pg_temp.store_create(0, 'ABC', 'exact-id-abc', evaluated_at),
    pg_temp.store_create(1, '00123', 'exact-id-leading-zero', evaluated_at),
    pg_temp.store_create(2, 'abc-DEF_123', 'exact-id-case-symbols', evaluated_at),
    pg_temp.store_create(3, 'A.B:C/9', 'exact-id-punctuation', evaluated_at)
  );
  offers := jsonb_build_array(
    pg_temp.offer_create(4, 'ABC', 'coupon', 'ABC'),
    pg_temp.offer_create(5, '00123', 'coupon', '00123'),
    pg_temp.offer_create(6, 'abc-DEF_123', 'deal', 'abc-DEF_123'),
    pg_temp.offer_create(7, 'A.B:C/9', 'deal', 'A.B:C/9')
  );
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('a4', 32), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed', 'R2 exact valid identity plan commits');
  SELECT count(*) INTO row_count
  FROM public.stores
  WHERE provider = 'impact'
    AND provider_entity_id = ANY (ARRAY['ABC', '00123', 'abc-DEF_123', 'A.B:C/9']);
  PERFORM pg_temp.assert_true(row_count = 4, 'R2 CampaignIds retain exact submitted code units');
  SELECT count(*) INTO row_count
  FROM public.coupons
  WHERE provider = 'impact'
    AND provider_entity_id = ANY (ARRAY['ABC', '00123', 'abc-DEF_123', 'A.B:C/9'])
    AND metadata->>'resolvedCampaignId' = provider_entity_id;
  PERFORM pg_temp.assert_true(row_count = 4, 'R2 PromotionIds and parent CampaignIds remain exact');

  -- R2 lifecycle flags are closed JSON booleans. The settled true/false pair
  -- was accepted by D and is stored with the same semantics.
  PERFORM pg_temp.assert_true((
    SELECT lifecycle_managed = true AND lifecycle_hidden = false
    FROM public.stores WHERE id = store_id
  ), 'R2 actual lifecycle JSON booleans are accepted');
  FOR invalid_lifecycle_value IN
    SELECT value FROM jsonb_array_elements(
      '["true", "false", 1, 0, null, {}, []]'::jsonb
    )
  LOOP
    counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
    stores := jsonb_build_array(jsonb_set(
      pg_temp.store_create(0, 'campaign-invalid-managed', 'invalid-managed', evaluated_at),
      '{projection,lifecycleManaged}', invalid_lifecycle_value
    ));
    SELECT public.apply_affiliate_persistence_plan_v2(
      integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
      repeat('a3', 32), evaluated_at, actor_id, counts, stores, '[]'::jsonb
    ) INTO result_one;
    PERFORM pg_temp.assert_true(
      result_one->>'status' = 'blocked'
        AND result_one->>'reason' = 'invalid_store_projection',
      'R2 malformed lifecycleManaged JSON type/value is rejected'
    );

    stores := jsonb_build_array(jsonb_set(
      pg_temp.store_create(0, 'campaign-invalid-hidden', 'invalid-hidden', evaluated_at),
      '{projection,lifecycleHidden}', invalid_lifecycle_value
    ));
    SELECT public.apply_affiliate_persistence_plan_v2(
      integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
      repeat('a3', 32), evaluated_at, actor_id, counts, stores, '[]'::jsonb
    ) INTO result_one;
    PERFORM pg_temp.assert_true(
      result_one->>'status' = 'blocked'
        AND result_one->>'reason' = 'invalid_store_projection',
      'R2 malformed lifecycleHidden JSON type/value is rejected'
    );
  END LOOP;
  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1 FROM public.stores
      WHERE provider = 'impact'
        AND provider_entity_id IN ('campaign-invalid-managed', 'campaign-invalid-hidden')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.affiliate_import_runs
      WHERE integration_id = integration_a AND plan_fingerprint = repeat('a3', 32)
    ),
    'R2 malformed lifecycle projections create no catalog or run row'
  );

  -- F: slug collision blocks without adoption or catalog/run writes.
  INSERT INTO public.stores (name, slug) VALUES ('Manual collision', 'occupied-slug');
  counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_create(0, 'campaign-collision', 'occupied-slug', evaluated_at));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('f', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked' AND result_one->>'reason' = 'store_slug_collision', 'F slug collision blocks');
  PERFORM pg_temp.assert_true(
    public.affiliate_sync_v2_has_exact_keys(result_one, ARRAY['status', 'stage', 'reason']),
    'F blocked output has only bounded fields'
  );
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.stores WHERE provider = 'impact' AND provider_entity_id = 'campaign-collision'
  ), 'F collision adopts nothing');

  -- G: wrong exact store UUID blocks.
  counts := pg_temp.expected_counts(0, 1, 0, 0, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_existing(
    0, 'campaign-one', '30000000-0000-4000-8000-000000000001'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('0', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked' AND result_one->>'reason' = 'store_identity_mismatch', 'G wrong store UUID blocks');

  -- H: wrong exact offer UUID blocks.
  counts := pg_temp.expected_counts(0, 1, 0, 0, 1, 0, 0);
  stores := jsonb_build_array(pg_temp.store_existing(0, 'campaign-one', store_id));
  offers := jsonb_build_array(pg_temp.offer_existing(
    1, 'promotion-one', 'coupon',
    '30000000-0000-4000-8000-000000000002', 'campaign-one', store_id
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('2', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked' AND result_one->>'reason' = 'offer_identity_mismatch', 'H wrong offer UUID blocks');

  -- I: coupon/deal kind conflict blocks without reclassification.
  counts := pg_temp.expected_counts(0, 1, 0, 1, 0, 0, 0);
  offers := jsonb_build_array(pg_temp.offer_create(1, 'promotion-one', 'deal', 'campaign-one', store_id));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('3', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked' AND result_one->>'reason' = 'offer_kind_conflict', 'I kind conflict blocks');
  PERFORM pg_temp.assert_true((SELECT coupon_type::text FROM public.coupons WHERE id = offer_id) = 'code', 'I kind remains unchanged');

  -- J: an exact offer attached to another parent blocks.
  INSERT INTO public.stores (
    name, slug, provider, provider_entity_id, import_origin,
    lifecycle_managed, lifecycle_hidden, last_qualification_result
  ) VALUES (
    'Other parent', 'other-parent', 'impact', 'campaign-other',
    'provider', true, false, 'qualified'
  ) RETURNING id INTO other_store_id;
  INSERT INTO public.coupons (
    store_id, title, coupon_type, status, provider, provider_entity_id
  ) VALUES (
    other_store_id, 'Wrong parent', 'code', 'active', 'impact', 'promotion-parent-mismatch'
  );
  offers := jsonb_build_array(pg_temp.offer_create(
    1, 'promotion-parent-mismatch', 'coupon', 'campaign-one', store_id
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('4', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked' AND result_one->>'reason' = 'parent_store_mismatch', 'J parent mismatch blocks');

  -- K: a store inserted before a later offer conflict is rolled back.
  counts := pg_temp.expected_counts(1, 0, 0, 1, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_create(0, 'campaign-rollback-store', 'rollback-store', evaluated_at));
  offers := jsonb_build_array(pg_temp.offer_create(
    1, 'promotion-one', 'deal', 'campaign-rollback-store', NULL
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('5', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked', 'K later offer conflict blocks');
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.stores WHERE provider = 'impact' AND provider_entity_id = 'campaign-rollback-store'
  ), 'K earlier store insert rolls back');

  -- L: an earlier offer insert rolls back when a later offer conflicts.
  counts := pg_temp.expected_counts(0, 1, 0, 2, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_existing(0, 'campaign-one', store_id));
  offers := jsonb_build_array(
    pg_temp.offer_create(1, 'promotion-rollback-early', 'coupon', 'campaign-one', store_id),
    pg_temp.offer_create(2, 'promotion-one', 'deal', 'campaign-one', store_id)
  );
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('6', 64), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked', 'L later offer conflict blocks');
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.coupons WHERE provider = 'impact' AND provider_entity_id = 'promotion-rollback-early'
  ), 'L earlier offer insert rolls back');

  -- M: run-row failure rolls catalog work back.
  CREATE TRIGGER a9c_s2_force_run_failure
    BEFORE INSERT ON public.affiliate_import_runs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_selected_v2_run();
  counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.store_create(0, 'campaign-run-failure', 'run-failure', evaluated_at));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('1', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  DROP TRIGGER a9c_s2_force_run_failure ON public.affiliate_import_runs;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'failed'
      AND result_one->>'stage' = 'audit_persistence'
      AND result_one->>'reason' = 'internal_failure'
      AND public.affiliate_sync_v2_has_exact_keys(
        result_one,
        ARRAY['status', 'stage', 'reason']
      ),
    'M run failure is bounded without SQL diagnostics'
  );
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.stores WHERE provider = 'impact' AND provider_entity_id = 'campaign-run-failure'
  ), 'M run failure rolls store back');

  -- N: ledger failure rolls run and catalog work back.
  CREATE TRIGGER a9c_s2_force_ledger_failure
    BEFORE INSERT ON public.affiliate_import_run_mutations_v2
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_selected_v2_ledger();
  stores := jsonb_build_array(pg_temp.store_create(
    0, 'campaign-ledger-failure', 'ledger-failure', evaluated_at
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('7', 64), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  DROP TRIGGER a9c_s2_force_ledger_failure ON public.affiliate_import_run_mutations_v2;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'failed'
      AND result_one->>'stage' = 'audit_persistence'
      AND result_one->>'reason' = 'internal_failure'
      AND public.affiliate_sync_v2_has_exact_keys(
        result_one,
        ARRAY['status', 'stage', 'reason']
      ),
    'N ledger failure is bounded without SQL diagnostics'
  );
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.stores WHERE provider = 'impact' AND provider_entity_id = 'campaign-ledger-failure'
  ), 'N ledger failure rolls store back');
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM public.affiliate_import_runs WHERE plan_fingerprint = repeat('7', 64)
  ), 'N ledger failure rolls run back');

  -- O: committed evidence retains exact created IDs and identities.
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1
    FROM public.affiliate_import_run_mutations_v2 AS mutation
    JOIN public.affiliate_import_runs AS run ON run.id = mutation.run_id
    WHERE run.plan_fingerprint = repeat('b', 64)
      AND mutation.entity_kind = 'store'
      AND mutation.provider_entity_id = 'campaign-one'
      AND mutation.entity_id = store_id
      AND mutation.outcome = 'created'
  ), 'O exact created store evidence exists');
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1
    FROM public.affiliate_import_run_mutations_v2 AS mutation
    JOIN public.affiliate_import_runs AS run ON run.id = mutation.run_id
    WHERE run.plan_fingerprint = repeat('d', 64)
      AND mutation.entity_kind = 'offer'
      AND mutation.provider_entity_id = 'promotion-one'
      AND mutation.entity_id = offer_id
      AND mutation.parent_entity_id = store_id
      AND mutation.offer_kind = 'coupon'
  ), 'O exact created offer evidence exists');

  -- P/Q: held and unresolved aggregate counts never create ledger/offers.
  counts := pg_temp.expected_counts(0, 0, 0, 0, 0, 1, 0);
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('8', 64), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed' AND result_one#>>'{counts,actual,ledgerRows}' = '0', 'P held aggregate creates no ledger');
  counts := pg_temp.expected_counts(0, 0, 0, 0, 0, 0, 1);
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('9', 64), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(result_two->>'status' = 'committed' AND result_two#>>'{counts,actual,ledgerRows}' = '0', 'Q unresolved aggregate creates no ledger');

  -- R: exact no-op leaves an existing catalog row byte-for-byte unchanged.
  SELECT to_jsonb(store) INTO before_store FROM public.stores AS store WHERE store.id = store_id;
  SELECT to_jsonb(offer) INTO before_offer FROM public.coupons AS offer WHERE offer.id = offer_id;
  counts := pg_temp.expected_counts(0, 1, 0, 0, 1, 0, 0);
  stores := jsonb_build_array(pg_temp.store_existing(0, 'campaign-one', store_id));
  offers := jsonb_build_array(pg_temp.offer_existing(
    1, 'promotion-one', 'coupon', offer_id, 'campaign-one', store_id
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('b0', 32), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  SELECT to_jsonb(store) INTO after_store FROM public.stores AS store WHERE store.id = store_id;
  SELECT to_jsonb(offer) INTO after_offer FROM public.coupons AS offer WHERE offer.id = offer_id;
  PERFORM pg_temp.assert_true(before_store = after_store, 'R store no-op changes no bytes');
  PERFORM pg_temp.assert_true(before_offer = after_offer, 'R offer no-op changes no bytes');

  -- S-X: privilege, owner, definer, search path and PUBLIC denial.
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege('authenticated', 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
    'S authenticated cannot execute'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege('anon', 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
    'T anon cannot execute'
  );
  PERFORM pg_temp.assert_true(
    has_function_privilege('service_role', 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
    'U service_role can execute'
  );
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM pg_proc AS procedure
    JOIN pg_roles AS owner ON owner.oid = procedure.proowner
    WHERE procedure.oid = 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)'::regprocedure
      AND procedure.prosecdef = true
      AND owner.rolname = 'postgres'
  ), 'V function is postgres-owned SECURITY DEFINER');
  SELECT procedure.proconfig INTO function_search_path
  FROM pg_proc AS procedure
  WHERE procedure.oid = 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)'::regprocedure;
  PERFORM pg_temp.assert_true(
    function_search_path @> ARRAY['search_path=pg_catalog, public'],
    'W fixed search_path is present'
  );
  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure,
           aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
      WHERE procedure.oid = 'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)'::regprocedure
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ),
    'X PUBLIC cannot execute'
  );

  -- Y: the same fingerprint under a different integration is independent.
  counts := pg_temp.expected_counts();
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_b, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('a', 64), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed', 'Y integration scopes replay identity');

  -- Z: unsupported contract/algorithm are blocked; another valid fingerprint
  -- is a distinct execution.
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-future', 'sha256-canonical-plan-v1',
    repeat('c0', 32), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked', 'Z future contract is rejected by first RPC');
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-future',
    repeat('c1', 32), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'blocked', 'Z future algorithm is rejected by first RPC');
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('c2', 32), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(result_one->>'status' = 'committed', 'Z different valid fingerprint is distinct');

  -- AC: JSON numbers/objects are never coerced into provider identity text.
  counts := pg_temp.expected_counts(1, 0, 0, 0, 0, 0, 0);
  stores := jsonb_build_array(jsonb_set(
    pg_temp.store_create(0, 'campaign-scalar-shape', 'scalar-shape', evaluated_at),
    '{providerEntityId}',
    '42'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('d0', 32), evaluated_at, actor_id, counts, stores, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'blocked'
      AND result_one->>'reason' = 'invalid_store_instruction',
    'AC non-string provider identity is rejected'
  );

  -- AD: bounded counters cannot overflow legacy integer run counters.
  counts := pg_temp.expected_counts(0, 0, 2147483647, 0, 0, 0, 1);
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a9b-1', 'sha256-canonical-plan-v1',
    repeat('d1', 32), evaluated_at, actor_id, counts, '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'blocked' AND result_one->>'reason' = 'invalid_request',
    'AD aggregate counters remain within the legacy integer domain'
  );

  -- AB: V1 remains present, postgres-owned, SECURITY DEFINER, and retains its
  -- established authenticated/service-role execute privileges.
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM pg_proc AS procedure
    JOIN pg_roles AS owner ON owner.oid = procedure.proowner
    WHERE procedure.oid = 'public.import_apply(jsonb)'::regprocedure
      AND procedure.prosecdef = true
      AND owner.rolname = 'postgres'
  ), 'AB V1 function remains intact');
  PERFORM pg_temp.assert_true(
    has_function_privilege('authenticated', 'public.import_apply(jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.import_apply(jsonb)', 'EXECUTE'),
    'AB V1 privileges remain intact'
  );
END;
$test$;

SELECT extensions.pass('A9C-S2 database assertion matrix completed');
SELECT * FROM extensions.finish();

ROLLBACK;
