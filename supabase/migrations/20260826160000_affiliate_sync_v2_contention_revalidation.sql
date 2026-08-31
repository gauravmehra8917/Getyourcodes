-- A9C-R1 forward-only contention repair.
-- Replaces only the settled V2 persistence RPC; schema, data, and ACLs are unchanged.

CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2(
  _integration_id uuid,
  _provider text,
  _persistence_contract_version text,
  _plan_fingerprint_algorithm text,
  _plan_fingerprint text,
  _evaluation_timestamp timestamptz,
  _triggered_by uuid,
  _expected_counts jsonb,
  _store_instructions jsonb,
  _offer_instructions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_stage text := 'request_validation';
  v_reason text := 'invalid_request';
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_run_id uuid;
  v_replay_evaluated_at timestamptz;
  v_replay_counts jsonb;
  v_integration_enabled boolean;
  v_integration_provider text;
  v_instruction jsonb;
  v_projection jsonb;
  v_evidence jsonb;
  v_array_ordinal bigint;
  v_instruction_ordinal integer;
  v_action text;
  v_provider_entity_id text;
  v_parent_provider_entity_id text;
  v_kind text;
  v_slug text;
  v_unique_constraint_name text;
  v_expected_id uuid;
  v_expected_parent_id uuid;
  v_projection_timestamp timestamptz;
  v_existing_store_id uuid;
  v_existing_store_origin text;
  v_existing_store_managed boolean;
  v_existing_store_hidden boolean;
  v_existing_store_qualification text;
  v_conflicting_store_id uuid;
  v_parent_store_id uuid;
  v_existing_offer_id uuid;
  v_existing_offer_kind text;
  v_existing_offer_parent uuid;
  v_entity_id uuid;
  v_outcome text;
  v_store_specs jsonb := '{}'::jsonb;
  v_store_map jsonb := '{}'::jsonb;
  v_seen_store_ids jsonb := '{}'::jsonb;
  v_seen_store_slugs jsonb := '{}'::jsonb;
  v_seen_offer_ids jsonb := '{}'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_result_ledger jsonb := '[]'::jsonb;
  v_created_stores jsonb := '[]'::jsonb;
  v_created_offers jsonb := '[]'::jsonb;
  v_persistence_counts jsonb;
  v_store_create_expected integer;
  v_store_existing_expected integer;
  v_store_unmatched_expected integer;
  v_offer_create_expected integer;
  v_offer_existing_expected integer;
  v_offer_held_expected integer;
  v_offer_unresolved_expected integer;
  v_store_create_seen integer := 0;
  v_store_existing_seen integer := 0;
  v_offer_create_seen integer := 0;
  v_offer_existing_seen integer := 0;
  v_stores_created integer := 0;
  v_stores_noop integer := 0;
  v_offers_created integer := 0;
  v_offers_noop integer := 0;
  v_ledger_count integer := 0;
  v_records_processed integer;
  v_records_created integer;
  v_records_skipped integer;
  v_records_published integer;
  v_records_held integer;
  v_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
BEGIN
  -- Every database-changing statement in this function is inside this block.
  -- The exception handler therefore rolls all catalog/run/ledger changes back
  -- before returning either a bounded blocked or failed result.
  BEGIN
    IF _integration_id IS NULL
      OR _provider IS DISTINCT FROM 'impact'
      OR _persistence_contract_version IS DISTINCT FROM 'v2-a9b-1'
      OR _plan_fingerprint_algorithm IS DISTINCT FROM 'sha256-canonical-plan-v1'
      OR _plan_fingerprint IS NULL
      OR _plan_fingerprint !~ '^[0-9a-f]{64}$'
      OR _evaluation_timestamp IS NULL
      OR _triggered_by IS NULL
      OR jsonb_typeof(_store_instructions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(_offer_instructions) IS DISTINCT FROM 'array'
      OR NOT public.affiliate_sync_v2_valid_expected_counts(_expected_counts)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    v_store_create_expected := (_expected_counts#>>'{stores,create}')::integer;
    v_store_existing_expected := (_expected_counts#>>'{stores,noopExisting}')::integer;
    v_store_unmatched_expected := (_expected_counts#>>'{stores,noopUnmatched}')::integer;
    v_offer_create_expected := (_expected_counts#>>'{offers,create}')::integer;
    v_offer_existing_expected := (_expected_counts#>>'{offers,noopExisting}')::integer;
    v_offer_held_expected := (_expected_counts#>>'{offers,noopHeld}')::integer;
    v_offer_unresolved_expected := (_expected_counts#>>'{offers,noopUnresolved}')::integer;

    IF jsonb_array_length(_store_instructions) <>
        v_store_create_expected + v_store_existing_expected
      OR jsonb_array_length(_offer_instructions) <>
        v_offer_create_expected + v_offer_existing_expected
    THEN
      v_reason := 'instruction_count_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    -- Structural validation is deliberately repeated before database access.
    FOR v_instruction, v_array_ordinal IN
      SELECT value, ordinality - 1
      FROM jsonb_array_elements(_store_instructions) WITH ORDINALITY
    LOOP
      IF NOT public.affiliate_sync_v2_has_exact_keys(
        v_instruction,
        ARRAY[
          'instructionOrdinal', 'action', 'provider', 'providerEntityId',
          'expectedExistingStoreId', 'qualified', 'projection'
        ]
      )
        OR NOT public.affiliate_sync_v2_is_nonnegative_integer(v_instruction->'instructionOrdinal')
        OR (v_instruction->>'instructionOrdinal')::integer <> v_array_ordinal::integer
        OR v_instruction->>'provider' IS DISTINCT FROM 'impact'
        OR jsonb_typeof(v_instruction->'providerEntityId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_instruction->'qualified') IS DISTINCT FROM 'boolean'
      THEN
        v_reason := 'invalid_store_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      v_action := v_instruction->>'action';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      IF v_action NOT IN ('create', 'noop_existing')
        OR NOT public.affiliate_sync_v2_is_canonical_provider_id(v_provider_entity_id)
        OR v_seen_store_ids ? v_provider_entity_id
      THEN
        v_reason := 'invalid_store_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      v_seen_store_ids := v_seen_store_ids || jsonb_build_object(v_provider_entity_id, true);

      IF v_action = 'create' THEN
        v_store_create_seen := v_store_create_seen + 1;
        v_projection := v_instruction->'projection';
        IF v_instruction->'expectedExistingStoreId' <> 'null'::jsonb
          OR v_instruction->>'qualified' <> 'true'
          OR NOT public.affiliate_sync_v2_has_exact_keys(
            v_projection,
            ARRAY[
              'name', 'slugCandidate', 'description', 'affiliateUrl',
              'destinationUrl', 'country', 'shippingRegions', 'logoSourceUrl',
              'metadata', 'importOrigin', 'lifecycleManaged',
              'lifecycleHidden', 'lastQualificationResult', 'lastQualifiedAt'
            ]
          )
          OR jsonb_typeof(v_projection->'name') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'name', '')) = ''
          OR v_projection->>'name' <> btrim(v_projection->>'name')
          OR jsonb_typeof(v_projection->'slugCandidate') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'slugCandidate', '')) = ''
          OR length(v_projection->>'slugCandidate') > 80
          OR v_projection->>'slugCandidate' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          OR v_projection->'description' <> 'null'::jsonb
          OR v_projection->'country' <> 'null'::jsonb
          OR v_projection->'shippingRegions' <> '[]'::jsonb
          OR v_projection->'logoSourceUrl' <> 'null'::jsonb
          OR v_projection->>'importOrigin' IS DISTINCT FROM 'provider'
          OR jsonb_typeof(v_projection->'lifecycleManaged') IS DISTINCT FROM 'boolean'
          OR v_projection->>'lifecycleManaged' IS DISTINCT FROM 'true'
          OR jsonb_typeof(v_projection->'lifecycleHidden') IS DISTINCT FROM 'boolean'
          OR v_projection->>'lifecycleHidden' IS DISTINCT FROM 'false'
          OR v_projection->>'lastQualificationResult' IS DISTINCT FROM 'qualified'
          OR NOT public.affiliate_sync_v2_has_exact_keys(
            v_projection->'metadata',
            ARRAY['advertiserId', 'campaignId']
          )
          OR jsonb_typeof(v_projection#>'{metadata,campaignId}') IS DISTINCT FROM 'string'
          OR v_projection#>>'{metadata,campaignId}' IS DISTINCT FROM v_provider_entity_id
          OR (
            v_projection#>'{metadata,advertiserId}' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection#>'{metadata,advertiserId}') IS DISTINCT FROM 'string'
              OR btrim(v_projection#>>'{metadata,advertiserId}') = ''
              OR v_projection#>>'{metadata,advertiserId}' <>
                btrim(v_projection#>>'{metadata,advertiserId}')
            )
          )
          OR (
            v_projection->'affiliateUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'affiliateUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'affiliateUrl') = ''
              OR v_projection->>'affiliateUrl' <> btrim(v_projection->>'affiliateUrl')
            )
          )
          OR (
            v_projection->'destinationUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'destinationUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'destinationUrl') = ''
              OR v_projection->>'destinationUrl' <> btrim(v_projection->>'destinationUrl')
            )
          )
          OR jsonb_typeof(v_projection->'lastQualifiedAt') IS DISTINCT FROM 'string'
        THEN
          v_reason := 'invalid_store_projection';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;

        BEGIN
          v_projection_timestamp := (v_projection->>'lastQualifiedAt')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          v_projection_timestamp := NULL;
        END;
        IF v_projection_timestamp IS DISTINCT FROM _evaluation_timestamp THEN
          v_reason := 'invalid_store_projection';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;

        v_slug := v_projection->>'slugCandidate';
        IF v_seen_store_slugs ? v_slug THEN
          v_reason := 'store_slug_collision';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        v_seen_store_slugs := v_seen_store_slugs || jsonb_build_object(v_slug, true);
      ELSE
        v_store_existing_seen := v_store_existing_seen + 1;
        IF jsonb_typeof(v_instruction->'expectedExistingStoreId') IS DISTINCT FROM 'string'
          OR (v_instruction->>'expectedExistingStoreId') !~ v_uuid_pattern
          OR v_instruction->'projection' <> 'null'::jsonb
        THEN
          v_reason := 'invalid_store_instruction';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      END IF;

      v_store_specs := v_store_specs || jsonb_build_object(
        v_provider_entity_id,
        jsonb_build_object(
          'action', v_action,
          'expectedExistingStoreId', v_instruction->'expectedExistingStoreId',
          'qualified', v_instruction->'qualified'
        )
      );
    END LOOP;

    IF v_store_create_seen <> v_store_create_expected
      OR v_store_existing_seen <> v_store_existing_expected
    THEN
      v_reason := 'instruction_count_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    FOR v_instruction, v_array_ordinal IN
      SELECT value, ordinality - 1
      FROM jsonb_array_elements(_offer_instructions) WITH ORDINALITY
    LOOP
      IF NOT public.affiliate_sync_v2_has_exact_keys(
        v_instruction,
        ARRAY[
          'instructionOrdinal', 'action', 'provider', 'providerEntityId',
          'kind', 'existingOfferId', 'parentProviderEntityId',
          'expectedParentStoreId', 'projection'
        ]
      )
        OR NOT public.affiliate_sync_v2_is_nonnegative_integer(v_instruction->'instructionOrdinal')
        OR (v_instruction->>'instructionOrdinal')::integer <>
          jsonb_array_length(_store_instructions) + v_array_ordinal::integer
        OR v_instruction->>'provider' IS DISTINCT FROM 'impact'
        OR jsonb_typeof(v_instruction->'providerEntityId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_instruction->'parentProviderEntityId') IS DISTINCT FROM 'string'
      THEN
        v_reason := 'invalid_offer_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      v_action := v_instruction->>'action';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      v_parent_provider_entity_id := v_instruction->>'parentProviderEntityId';
      v_kind := v_instruction->>'kind';
      IF v_action NOT IN ('create', 'noop_existing')
        OR v_kind NOT IN ('coupon', 'deal')
        OR NOT public.affiliate_sync_v2_is_canonical_provider_id(v_provider_entity_id)
        OR v_seen_offer_ids ? v_provider_entity_id
        OR NOT public.affiliate_sync_v2_is_canonical_provider_id(v_parent_provider_entity_id)
        OR NOT (v_store_specs ? v_parent_provider_entity_id)
      THEN
        v_reason := 'invalid_offer_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      v_seen_offer_ids := v_seen_offer_ids || jsonb_build_object(v_provider_entity_id, true);

      IF v_store_specs#>>ARRAY[v_parent_provider_entity_id, 'action'] = 'create' THEN
        IF v_instruction->'expectedParentStoreId' <> 'null'::jsonb THEN
          v_reason := 'parent_store_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      ELSIF jsonb_typeof(v_instruction->'expectedParentStoreId') IS DISTINCT FROM 'string'
        OR (v_instruction->>'expectedParentStoreId') !~ v_uuid_pattern
        OR v_instruction->>'expectedParentStoreId' IS DISTINCT FROM
          v_store_specs#>>ARRAY[v_parent_provider_entity_id, 'expectedExistingStoreId']
      THEN
        v_reason := 'parent_store_mismatch';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      IF v_store_specs#>>ARRAY[v_parent_provider_entity_id, 'qualified'] IS DISTINCT FROM 'true' THEN
        v_reason := 'unqualified_parent_store';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      IF v_action = 'create' THEN
        v_offer_create_seen := v_offer_create_seen + 1;
        v_projection := v_instruction->'projection';
        IF v_instruction->'existingOfferId' <> 'null'::jsonb
          OR NOT public.affiliate_sync_v2_has_exact_keys(
            v_projection,
            ARRAY[
              'title', 'description', 'couponCode', 'couponType',
              'affiliateUrl', 'landingPageUrl', 'startDate', 'expiryDate',
              'status', 'terms', 'discountType', 'discountValue', 'metadata'
            ]
          )
          OR jsonb_typeof(v_projection->'title') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'title', '')) = ''
          OR v_projection->>'title' <> btrim(v_projection->>'title')
          OR v_projection->>'couponType' IS DISTINCT FROM
            (CASE WHEN v_kind = 'coupon' THEN 'code' ELSE 'deal' END)
          OR v_projection->>'status' IS DISTINCT FROM 'active'
          OR v_projection->'landingPageUrl' <> 'null'::jsonb
          OR NOT public.affiliate_sync_v2_has_exact_keys(
            v_projection->'metadata',
            ARRAY['advertiserId', 'campaignId', 'programId', 'resolvedCampaignId']
          )
          OR jsonb_typeof(v_projection#>'{metadata,resolvedCampaignId}') IS DISTINCT FROM 'string'
          OR v_projection#>>'{metadata,resolvedCampaignId}' IS DISTINCT FROM
            v_parent_provider_entity_id
          OR (
            v_kind = 'coupon'
            AND (
              jsonb_typeof(v_projection->'couponCode') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'couponCode') = ''
              OR v_projection->>'couponCode' <> btrim(v_projection->>'couponCode')
            )
          )
          OR (v_kind = 'deal' AND v_projection->'couponCode' <> 'null'::jsonb)
          OR (v_kind = 'deal' AND v_projection->'terms' <> 'null'::jsonb)
          OR (
            v_projection->'description' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'description') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'description') = ''
              OR v_projection->>'description' <> btrim(v_projection->>'description')
            )
          )
          OR (
            v_projection->'affiliateUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'affiliateUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'affiliateUrl') = ''
              OR v_projection->>'affiliateUrl' <> btrim(v_projection->>'affiliateUrl')
            )
          )
          OR (
            v_projection->'terms' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'terms') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'terms') = ''
              OR v_projection->>'terms' <> btrim(v_projection->>'terms')
            )
          )
          OR (
            v_projection->'discountType' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'discountType') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'discountType') = ''
              OR v_projection->>'discountType' <> btrim(v_projection->>'discountType')
            )
          )
          OR (
            v_projection->'discountValue' <> 'null'::jsonb
            AND jsonb_typeof(v_projection->'discountValue') IS DISTINCT FROM 'number'
          )
          OR (
            v_projection->'startDate' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'startDate') IS DISTINCT FROM 'string'
              OR NOT public.affiliate_sync_v2_is_iso_date(v_projection->>'startDate')
            )
          )
          OR (
            v_projection->'expiryDate' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'expiryDate') IS DISTINCT FROM 'string'
              OR NOT public.affiliate_sync_v2_is_iso_date(v_projection->>'expiryDate')
            )
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(jsonb_build_array(
              v_projection#>'{metadata,advertiserId}',
              v_projection#>'{metadata,campaignId}',
              v_projection#>'{metadata,programId}'
            )) AS metadata_values(metadata_value)
            WHERE metadata_value <> 'null'::jsonb
              AND (
                jsonb_typeof(metadata_value) IS DISTINCT FROM 'string'
                OR btrim(metadata_value #>> '{}') = ''
                OR metadata_value #>> '{}' <> btrim(metadata_value #>> '{}')
              )
          )
        THEN
          v_reason := 'invalid_offer_projection';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      ELSE
        v_offer_existing_seen := v_offer_existing_seen + 1;
        IF jsonb_typeof(v_instruction->'existingOfferId') IS DISTINCT FROM 'string'
          OR (v_instruction->>'existingOfferId') !~ v_uuid_pattern
          OR v_instruction->'projection' <> 'null'::jsonb
        THEN
          v_reason := 'invalid_offer_instruction';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      END IF;
    END LOOP;

    IF v_offer_create_seen <> v_offer_create_expected
      OR v_offer_existing_seen <> v_offer_existing_expected
    THEN
      v_reason := 'instruction_count_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    v_stage := 'replay_resolution';
    v_reason := 'integration_not_found';
    SELECT integration.is_enabled, integration.provider_name
      INTO v_integration_enabled, v_integration_provider
    FROM public.affiliate_integrations AS integration
    WHERE integration.id = _integration_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;
    IF v_integration_enabled IS DISTINCT FROM true THEN
      v_reason := 'integration_disabled';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;
    IF lower(btrim(v_integration_provider)) NOT IN ('impact', 'impact.com', 'impact radius') THEN
      v_reason := 'integration_provider_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    SELECT run.id, run.plan_evaluated_at, run.persistence_counts
      INTO v_run_id, v_replay_evaluated_at, v_replay_counts
    FROM public.affiliate_import_runs AS run
    WHERE run.provider = _provider
      AND run.integration_id = _integration_id
      AND run.persistence_contract_version = _persistence_contract_version
      AND run.plan_fingerprint_algorithm = _plan_fingerprint_algorithm
      AND run.plan_fingerprint = _plan_fingerprint
      AND run.preview = false
      AND run.persistence_execution_status = 'committed';

    IF FOUND THEN
      IF v_replay_evaluated_at IS DISTINCT FROM _evaluation_timestamp
        OR v_replay_counts->'expected' IS DISTINCT FROM _expected_counts
      THEN
        v_reason := 'replay_metadata_mismatch';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'instructionOrdinal', mutation.instruction_ordinal,
          'entityKind', mutation.entity_kind,
          'plannedAction', mutation.planned_action,
          'outcome', mutation.outcome,
          'provider', mutation.provider,
          'providerEntityId', mutation.provider_entity_id,
          'entityId', mutation.entity_id,
          'expectedEntityId', mutation.expected_entity_id,
          'parentProviderEntityId', mutation.parent_provider_entity_id,
          'parentEntityId', mutation.parent_entity_id,
          'offerKind', mutation.offer_kind
        ) ORDER BY mutation.instruction_ordinal
      ), '[]'::jsonb)
      INTO v_result_ledger
      FROM public.affiliate_import_run_mutations_v2 AS mutation
      WHERE mutation.run_id = v_run_id;

      SELECT
        count(*),
        count(*) FILTER (WHERE mutation.entity_kind = 'store' AND mutation.outcome = 'created'),
        count(*) FILTER (WHERE mutation.entity_kind = 'store' AND mutation.outcome = 'noop_existing'),
        count(*) FILTER (WHERE mutation.entity_kind = 'offer' AND mutation.outcome = 'created'),
        count(*) FILTER (WHERE mutation.entity_kind = 'offer' AND mutation.outcome = 'noop_existing')
      INTO
        v_ledger_count,
        v_stores_created,
        v_stores_noop,
        v_offers_created,
        v_offers_noop
      FROM public.affiliate_import_run_mutations_v2 AS mutation
      WHERE mutation.run_id = v_run_id;

      IF v_ledger_count <> (v_replay_counts#>>'{actual,ledgerRows}')::integer
        OR v_stores_created <> (v_replay_counts#>>'{actual,storesCreated}')::integer
        OR v_stores_noop <> (v_replay_counts#>>'{actual,storesNoopExisting}')::integer
        OR v_offers_created <> (v_replay_counts#>>'{actual,offersCreated}')::integer
        OR v_offers_noop <> (v_replay_counts#>>'{actual,offersNoopExisting}')::integer
      THEN
        v_reason := 'replay_evidence_mismatch';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'entityId', mutation.entity_id,
          'providerEntityId', mutation.provider_entity_id
        ) ORDER BY mutation.instruction_ordinal
      ), '[]'::jsonb)
      INTO v_created_stores
      FROM public.affiliate_import_run_mutations_v2 AS mutation
      WHERE mutation.run_id = v_run_id
        AND mutation.entity_kind = 'store'
        AND mutation.outcome = 'created';

      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'entityId', mutation.entity_id,
          'providerEntityId', mutation.provider_entity_id
        ) ORDER BY mutation.instruction_ordinal
      ), '[]'::jsonb)
      INTO v_created_offers
      FROM public.affiliate_import_run_mutations_v2 AS mutation
      WHERE mutation.run_id = v_run_id
        AND mutation.entity_kind = 'offer'
        AND mutation.outcome = 'created';

      RETURN jsonb_build_object(
        'status', 'replayed_existing',
        'runId', v_run_id,
        'provider', _provider,
        'integrationId', _integration_id,
        'persistenceContractVersion', _persistence_contract_version,
        'planFingerprintAlgorithm', _plan_fingerprint_algorithm,
        'planFingerprint', _plan_fingerprint,
        'evaluationTimestamp', v_replay_evaluated_at,
        'counts', v_replay_counts,
        'createdStores', v_created_stores,
        'createdOffers', v_created_offers,
        'noops', jsonb_build_object(
          'stores', (v_replay_counts#>>'{actual,storesNoopExisting}')::integer,
          'offers', (v_replay_counts#>>'{actual,offersNoopExisting}')::integer
        ),
        'ledger', v_result_ledger
      );
    END IF;

    -- Stores are resolved only by exact provider identity. Slug is queried
    -- solely as a collision blocker and is never an adoption mechanism.
    v_stage := 'store_revalidation';
    FOR v_instruction IN
      SELECT value FROM jsonb_array_elements(_store_instructions) WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      v_instruction_ordinal := (v_instruction->>'instructionOrdinal')::integer;
      v_action := v_instruction->>'action';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      v_projection := v_instruction->'projection';
      v_entity_id := NULL;
      v_existing_store_id := NULL;
      v_conflicting_store_id := NULL;

      SELECT store.id, store.import_origin, store.lifecycle_managed,
             store.lifecycle_hidden, store.last_qualification_result
        INTO v_existing_store_id, v_existing_store_origin,
             v_existing_store_managed, v_existing_store_hidden,
             v_existing_store_qualification
      FROM public.stores AS store
      WHERE store.provider = 'impact'
        AND store.provider_entity_id = v_provider_entity_id
      FOR SHARE;

      IF v_action = 'create' THEN
        v_slug := v_projection->>'slugCandidate';
        SELECT store.id INTO v_conflicting_store_id
        FROM public.stores AS store
        WHERE store.slug = v_slug
        FOR SHARE;

        IF v_conflicting_store_id IS NOT NULL
          AND v_conflicting_store_id IS DISTINCT FROM v_existing_store_id
        THEN
          v_reason := 'store_slug_collision';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;

        IF v_existing_store_id IS NULL THEN
          v_stage := 'store_insert';
          BEGIN
            INSERT INTO public.stores (
              name,
              slug,
              description,
              logo_url,
              logo_source_url,
              affiliate_url,
              category_id,
              country,
              shipping_regions,
              metadata,
              provider,
              provider_entity_id,
              imported_at,
              import_origin,
              lifecycle_managed,
              lifecycle_hidden,
              last_qualification_result,
              last_qualified_at
            ) VALUES (
              v_projection->>'name',
              v_slug,
              NULL,
              NULL,
              NULL,
              v_projection->>'affiliateUrl',
              NULL,
              NULL,
              '{}'::text[],
              (v_projection->'metadata') ||
                jsonb_build_object('destinationUrl', v_projection->'destinationUrl'),
              'impact',
              v_provider_entity_id,
              clock_timestamp(),
              'provider',
              true,
              false,
              'qualified',
              _evaluation_timestamp
            )
            ON CONFLICT (provider, provider_entity_id)
              WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL
              DO NOTHING
            RETURNING id INTO v_entity_id;
          EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS
              v_unique_constraint_name = CONSTRAINT_NAME;
            IF v_unique_constraint_name IS DISTINCT FROM 'stores_slug_key' THEN
              RAISE;
            END IF;
            v_entity_id := NULL;
          END;

          v_stage := 'store_revalidation';
          IF v_entity_id IS NULL THEN
            v_existing_store_id := NULL;
            v_existing_store_origin := NULL;
            v_existing_store_managed := NULL;
            v_existing_store_hidden := NULL;
            v_existing_store_qualification := NULL;
            v_conflicting_store_id := NULL;

            SELECT store.id, store.import_origin, store.lifecycle_managed,
                   store.lifecycle_hidden, store.last_qualification_result
              INTO v_existing_store_id, v_existing_store_origin,
                   v_existing_store_managed, v_existing_store_hidden,
                   v_existing_store_qualification
            FROM public.stores AS store
            WHERE store.provider = 'impact'
              AND store.provider_entity_id = v_provider_entity_id
            FOR SHARE;

            SELECT store.id INTO v_conflicting_store_id
            FROM public.stores AS store
            WHERE store.slug = v_slug
            FOR SHARE;

            IF v_conflicting_store_id IS NOT NULL
              AND v_conflicting_store_id IS DISTINCT FROM v_existing_store_id
            THEN
              v_reason := 'store_slug_collision';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
          END IF;
        END IF;

        IF v_entity_id IS NOT NULL THEN
          v_outcome := 'created';
          v_stores_created := v_stores_created + 1;
        ELSE
          IF v_existing_store_id IS NULL THEN
            RAISE EXCEPTION 'v2_persistence_store_conflict_unresolved';
          END IF;
          IF v_existing_store_origin IS DISTINCT FROM 'provider'
            OR v_existing_store_managed IS DISTINCT FROM true
            OR v_existing_store_hidden IS DISTINCT FROM false
            OR v_existing_store_qualification = 'unqualified'
          THEN
            v_reason := 'incompatible_store';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_entity_id := v_existing_store_id;
          v_outcome := 'noop_existing';
          v_stores_noop := v_stores_noop + 1;
        END IF;
        v_expected_id := NULL;
      ELSE
        v_expected_id := (v_instruction->>'expectedExistingStoreId')::uuid;
        IF v_existing_store_id IS NULL
          OR v_existing_store_id IS DISTINCT FROM v_expected_id
          OR v_existing_store_origin IS DISTINCT FROM 'provider'
          OR v_existing_store_managed IS DISTINCT FROM true
          OR v_existing_store_hidden IS DISTINCT FROM false
          OR v_existing_store_qualification = 'unqualified'
        THEN
          v_reason := 'store_identity_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        v_entity_id := v_existing_store_id;
        v_outcome := 'noop_existing';
        v_stores_noop := v_stores_noop + 1;
      END IF;

      v_store_map := v_store_map || jsonb_build_object(
        v_provider_entity_id,
        v_entity_id::text
      );
      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'instructionOrdinal', v_instruction_ordinal,
        'entityKind', 'store',
        'plannedAction', v_action,
        'outcome', v_outcome,
        'provider', 'impact',
        'providerEntityId', v_provider_entity_id,
        'entityId', v_entity_id,
        'expectedEntityId', v_expected_id,
        'parentProviderEntityId', NULL,
        'parentEntityId', NULL,
        'offerKind', NULL
      ));
    END LOOP;

    v_stage := 'offer_revalidation';
    FOR v_instruction IN
      SELECT value FROM jsonb_array_elements(_offer_instructions) WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      v_instruction_ordinal := (v_instruction->>'instructionOrdinal')::integer;
      v_action := v_instruction->>'action';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      v_parent_provider_entity_id := v_instruction->>'parentProviderEntityId';
      v_kind := v_instruction->>'kind';
      v_projection := v_instruction->'projection';
      v_entity_id := NULL;
      v_parent_store_id := nullif(v_store_map->>v_parent_provider_entity_id, '')::uuid;

      IF v_parent_store_id IS NULL THEN
        v_reason := 'parent_store_mismatch';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      IF v_instruction->'expectedParentStoreId' <> 'null'::jsonb THEN
        v_expected_parent_id := (v_instruction->>'expectedParentStoreId')::uuid;
        IF v_expected_parent_id IS DISTINCT FROM v_parent_store_id THEN
          v_reason := 'parent_store_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      ELSE
        v_expected_parent_id := NULL;
      END IF;

      v_existing_offer_id := NULL;
      SELECT offer.id, offer.coupon_type::text, offer.store_id
        INTO v_existing_offer_id, v_existing_offer_kind, v_existing_offer_parent
      FROM public.coupons AS offer
      WHERE offer.provider = 'impact'
        AND offer.provider_entity_id = v_provider_entity_id
      FOR SHARE;

      IF v_action = 'create' THEN
        IF v_existing_offer_id IS NULL THEN
          v_stage := 'offer_insert';
          INSERT INTO public.coupons (
            store_id,
            title,
            description,
            coupon_code,
            coupon_type,
            affiliate_url,
            expiry_date,
            start_date,
            status,
            terms,
            discount_type,
            discount_value,
            landing_page_url,
            structured_terms,
            metadata,
            provider,
            provider_entity_id,
            imported_at
          ) VALUES (
            v_parent_store_id,
            v_projection->>'title',
            v_projection->>'description',
            v_projection->>'couponCode',
            (v_projection->>'couponType')::public.coupon_type,
            v_projection->>'affiliateUrl',
            nullif(v_projection->>'expiryDate', '')::date,
            nullif(v_projection->>'startDate', '')::date,
            'active'::public.coupon_status,
            v_projection->>'terms',
            v_projection->>'discountType',
            nullif(v_projection->>'discountValue', '')::numeric,
            NULL,
            NULL,
            v_projection->'metadata',
            'impact',
            v_provider_entity_id,
            clock_timestamp()
          )
          ON CONFLICT (provider, provider_entity_id)
            WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL
            DO NOTHING
          RETURNING id INTO v_entity_id;

          v_stage := 'offer_revalidation';
          IF v_entity_id IS NULL THEN
            v_existing_offer_id := NULL;
            v_existing_offer_kind := NULL;
            v_existing_offer_parent := NULL;
            SELECT offer.id, offer.coupon_type::text, offer.store_id
              INTO v_existing_offer_id, v_existing_offer_kind,
                   v_existing_offer_parent
            FROM public.coupons AS offer
            WHERE offer.provider = 'impact'
              AND offer.provider_entity_id = v_provider_entity_id
            FOR SHARE;
          END IF;
        END IF;

        IF v_entity_id IS NOT NULL THEN
          v_outcome := 'created';
          v_offers_created := v_offers_created + 1;
        ELSE
          IF v_existing_offer_id IS NULL THEN
            RAISE EXCEPTION 'v2_persistence_offer_conflict_unresolved';
          END IF;
          IF v_existing_offer_kind IS DISTINCT FROM
              (CASE WHEN v_kind = 'coupon' THEN 'code' ELSE 'deal' END)
          THEN
            v_reason := 'offer_kind_conflict';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF v_existing_offer_parent IS DISTINCT FROM v_parent_store_id THEN
            v_reason := 'parent_store_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_entity_id := v_existing_offer_id;
          v_outcome := 'noop_existing';
          v_offers_noop := v_offers_noop + 1;
        END IF;
        v_expected_id := NULL;
      ELSE
        v_expected_id := (v_instruction->>'existingOfferId')::uuid;
        IF v_existing_offer_id IS NULL OR v_existing_offer_id IS DISTINCT FROM v_expected_id THEN
          v_reason := 'offer_identity_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        IF v_existing_offer_kind IS DISTINCT FROM
            (CASE WHEN v_kind = 'coupon' THEN 'code' ELSE 'deal' END)
        THEN
          v_reason := 'offer_kind_conflict';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        IF v_existing_offer_parent IS DISTINCT FROM v_parent_store_id THEN
          v_reason := 'parent_store_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        v_entity_id := v_existing_offer_id;
        v_outcome := 'noop_existing';
        v_offers_noop := v_offers_noop + 1;
      END IF;

      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'instructionOrdinal', v_instruction_ordinal,
        'entityKind', 'offer',
        'plannedAction', v_action,
        'outcome', v_outcome,
        'provider', 'impact',
        'providerEntityId', v_provider_entity_id,
        'entityId', v_entity_id,
        'expectedEntityId', v_expected_id,
        'parentProviderEntityId', v_parent_provider_entity_id,
        'parentEntityId', v_parent_store_id,
        'offerKind', v_kind
      ));
    END LOOP;

    v_stage := 'reconciliation';
    v_reason := 'count_mismatch';
    v_ledger_count := jsonb_array_length(v_ledger);
    IF v_stores_created + v_stores_noop <>
        v_store_create_expected + v_store_existing_expected
      OR v_offers_created + v_offers_noop <>
        v_offer_create_expected + v_offer_existing_expected
      OR v_ledger_count <>
        jsonb_array_length(_store_instructions) + jsonb_array_length(_offer_instructions)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    v_persistence_counts := jsonb_build_object(
      'expected', _expected_counts,
      'actual', jsonb_build_object(
        'storesCreated', v_stores_created,
        'storesNoopExisting', v_stores_noop,
        'offersCreated', v_offers_created,
        'offersNoopExisting', v_offers_noop,
        'ledgerRows', v_ledger_count
      )
    );
    IF NOT public.affiliate_sync_v2_valid_persistence_counts(v_persistence_counts) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    -- Legacy-compatible run counters describe execution truth as follows:
    -- processed/fetched = all unique offer actions; created = actual entity
    -- inserts; skipped = exact no-ops plus non-writable aggregate actions;
    -- published = selected offers resolved as created or existing; held = held
    -- offers only; provider identity counts use actual execution outcomes.
    v_records_processed := v_offer_create_expected + v_offer_existing_expected
      + v_offer_held_expected + v_offer_unresolved_expected;
    v_records_created := v_stores_created + v_offers_created;
    v_records_skipped := v_stores_noop + v_offers_noop
      + v_store_unmatched_expected + v_offer_held_expected + v_offer_unresolved_expected;
    v_records_published := v_offers_created + v_offers_noop;
    v_records_held := v_offer_held_expected;
    v_finished_at := clock_timestamp();
    v_run_id := gen_random_uuid();

    v_stage := 'audit_persistence';
    INSERT INTO public.affiliate_import_runs (
      id,
      integration_id,
      provider,
      preview,
      started_at,
      finished_at,
      duration_ms,
      success,
      records_processed,
      records_created,
      records_updated,
      records_skipped,
      validation_errors,
      warnings,
      error_message,
      statistics,
      triggered_by,
      records_published,
      records_held,
      records_fetched,
      new_provider_identities,
      existing_provider_identities,
      stop_reason,
      persistence_contract_version,
      plan_fingerprint_algorithm,
      plan_fingerprint,
      plan_evaluated_at,
      persistence_execution_status,
      persistence_counts
    ) VALUES (
      v_run_id,
      _integration_id,
      'impact',
      false,
      v_started_at,
      v_finished_at,
      greatest(0, floor(extract(epoch FROM (v_finished_at - v_started_at)) * 1000))::integer,
      true,
      v_records_processed,
      v_records_created,
      0,
      v_records_skipped,
      0,
      0,
      NULL,
      '{}'::jsonb,
      _triggered_by,
      v_records_published,
      v_records_held,
      v_records_processed,
      v_records_created,
      v_stores_noop + v_offers_noop,
      'completed',
      'v2-a9b-1',
      'sha256-canonical-plan-v1',
      _plan_fingerprint,
      _evaluation_timestamp,
      'committed',
      v_persistence_counts
    );

    FOR v_evidence IN SELECT value FROM jsonb_array_elements(v_ledger)
    LOOP
      INSERT INTO public.affiliate_import_run_mutations_v2 (
        run_id,
        instruction_ordinal,
        entity_kind,
        planned_action,
        outcome,
        provider,
        provider_entity_id,
        entity_id,
        expected_entity_id,
        parent_provider_entity_id,
        parent_entity_id,
        offer_kind
      ) VALUES (
        v_run_id,
        (v_evidence->>'instructionOrdinal')::integer,
        v_evidence->>'entityKind',
        v_evidence->>'plannedAction',
        v_evidence->>'outcome',
        v_evidence->>'provider',
        v_evidence->>'providerEntityId',
        (v_evidence->>'entityId')::uuid,
        nullif(v_evidence->>'expectedEntityId', '')::uuid,
        v_evidence->>'parentProviderEntityId',
        nullif(v_evidence->>'parentEntityId', '')::uuid,
        v_evidence->>'offerKind'
      );
    END LOOP;

    SELECT count(*) INTO v_ledger_count
    FROM public.affiliate_import_run_mutations_v2 AS mutation
    WHERE mutation.run_id = v_run_id;
    IF v_ledger_count <> (v_persistence_counts#>>'{actual,ledgerRows}')::integer THEN
      v_reason := 'ledger_count_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'entityId', evidence->>'entityId',
        'providerEntityId', evidence->>'providerEntityId'
      ) ORDER BY (evidence->>'instructionOrdinal')::integer
    ), '[]'::jsonb)
    INTO v_created_stores
    FROM jsonb_array_elements(v_ledger) AS ledger_entries(evidence)
    WHERE evidence->>'entityKind' = 'store'
      AND evidence->>'outcome' = 'created';

    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'entityId', evidence->>'entityId',
        'providerEntityId', evidence->>'providerEntityId'
      ) ORDER BY (evidence->>'instructionOrdinal')::integer
    ), '[]'::jsonb)
    INTO v_created_offers
    FROM jsonb_array_elements(v_ledger) AS ledger_entries(evidence)
    WHERE evidence->>'entityKind' = 'offer'
      AND evidence->>'outcome' = 'created';

    RETURN jsonb_build_object(
      'status', 'committed',
      'runId', v_run_id,
      'provider', _provider,
      'integrationId', _integration_id,
      'persistenceContractVersion', _persistence_contract_version,
      'planFingerprintAlgorithm', _plan_fingerprint_algorithm,
      'planFingerprint', _plan_fingerprint,
      'evaluationTimestamp', _evaluation_timestamp,
      'counts', v_persistence_counts,
      'createdStores', v_created_stores,
      'createdOffers', v_created_offers,
      'noops', jsonb_build_object(
        'stores', v_stores_noop,
        'offers', v_offers_noop
      ),
      'ledger', v_ledger
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'v2_persistence_blocked' THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'stage', v_stage,
        'reason', v_reason
      );
    END IF;
    RETURN jsonb_build_object(
      'status', 'failed',
      'stage', v_stage,
      'reason', 'internal_failure'
    );
  END;
END;
$function$;
