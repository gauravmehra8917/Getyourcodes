-- P1R-D4D2: private, strict Ads-2 transaction. Static/source checkpoint only.
-- No dispatcher activation. No historical function, constraint or helper changes.
-- CREATE races block; transaction-level fingerprint replay is a separate path.
CREATE OR REPLACE FUNCTION public.affiliate_sync_v2_apply_ads_refresh_plan_internal(
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
  v_status text := 'committed';
  v_run_id uuid;
  v_run public.affiliate_import_runs%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_offer public.coupons%ROWTYPE;
  v_parent public.stores%ROWTYPE;
  v_integration_enabled boolean;
  v_integration_provider text;
  v_instruction jsonb;
  v_projection jsonb;
  v_state jsonb;
  v_state_name text;
  v_key text;
  v_value jsonb;
  v_current_state jsonb;
  v_current_metadata jsonb;
  v_current_terms jsonb;
  v_desired jsonb;
  v_evidence jsonb;
  v_array_ordinal bigint;
  v_instruction_ordinal integer;
  v_action text;
  v_provider_entity_namespace text;
  v_provider_entity_id text;
  v_parent_provider_entity_namespace text;
  v_parent_provider_entity_id text;
  v_kind text;
  v_slug text;
  v_expected_id uuid;
  v_expected_parent_id uuid;
  v_projection_timestamp timestamptz;
  v_entity_id uuid;
  v_parent_store_id uuid;
  v_outcome text;
  v_store_specs jsonb := '{}'::jsonb;
  v_store_map jsonb := '{}'::jsonb;
  v_seen_store_ids jsonb := '{}'::jsonb;
  v_seen_store_slugs jsonb := '{}'::jsonb;
  v_seen_offer_ids jsonb := '{}'::jsonb;
  v_seen_entities jsonb := '{}'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_persisted_ledger jsonb;
  v_created_stores jsonb := '[]'::jsonb;
  v_created_offers jsonb := '[]'::jsonb;
  v_persistence_counts jsonb;
  v_store_create_expected integer;
  v_store_update_expected integer;
  v_store_existing_expected integer;
  v_store_unmatched_expected integer;
  v_offer_create_expected integer;
  v_offer_update_expected integer;
  v_offer_existing_expected integer;
  v_offer_held_expected integer;
  v_offer_unresolved_expected integer;
  v_store_create_seen integer := 0;
  v_store_update_seen integer := 0;
  v_store_existing_seen integer := 0;
  v_offer_create_seen integer := 0;
  v_offer_update_seen integer := 0;
  v_offer_existing_seen integer := 0;
  v_stores_created integer := 0;
  v_stores_updated integer := 0;
  v_stores_noop integer := 0;
  v_offers_created integer := 0;
  v_offers_updated integer := 0;
  v_offers_noop integer := 0;
  v_ledger_count integer := 0;
  v_records_processed integer;
  v_records_created integer;
  v_records_updated integer;
  v_records_skipped integer;
  v_records_published integer;
  v_records_held integer;
  v_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
BEGIN
  -- This exception subtransaction encloses ALL catalog, run and ledger writes.
  -- Any blocker or unexpected exception rolls them all back before responding.
  BEGIN
    IF _integration_id IS NULL
      OR _provider IS DISTINCT FROM 'impact'
      OR _persistence_contract_version IS DISTINCT FROM 'v2-a11-ads-2'
      OR _plan_fingerprint_algorithm IS DISTINCT FROM 'sha256-canonical-plan-v1'
      OR _plan_fingerprint IS NULL
      OR _plan_fingerprint !~ '^[0-9a-f]{64}$'
      OR _evaluation_timestamp IS NULL
      OR NOT isfinite(_evaluation_timestamp)
      OR _triggered_by IS NULL
      OR jsonb_typeof(_store_instructions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(_offer_instructions) IS DISTINCT FROM 'array'
      OR NOT public.affiliate_sync_ads_v2_valid_refresh_expected_counts(_expected_counts)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    v_store_create_expected := (_expected_counts#>>'{stores,create}')::integer;
    v_store_update_expected := (_expected_counts#>>'{stores,updateExisting}')::integer;
    v_store_existing_expected := (_expected_counts#>>'{stores,noopExisting}')::integer;
    v_store_unmatched_expected := (_expected_counts#>>'{stores,noopUnmatched}')::integer;
    v_offer_create_expected := (_expected_counts#>>'{offers,create}')::integer;
    v_offer_update_expected := (_expected_counts#>>'{offers,updateExisting}')::integer;
    v_offer_existing_expected := (_expected_counts#>>'{offers,noopExisting}')::integer;
    v_offer_held_expected := (_expected_counts#>>'{offers,noopHeld}')::integer;
    v_offer_unresolved_expected := (_expected_counts#>>'{offers,noopUnresolved}')::integer;

    IF jsonb_array_length(_store_instructions) <>
        v_store_create_expected + v_store_update_expected + v_store_existing_expected
      OR jsonb_array_length(_offer_instructions) <>
        v_offer_create_expected + v_offer_update_expected + v_offer_existing_expected
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
          'instructionOrdinal', 'action', 'provider',
          'providerEntityNamespace', 'providerEntityId',
          'expectedExistingStoreId', 'qualified'
        ] || CASE WHEN v_instruction->>'action' = 'update_existing'
          THEN ARRAY['expectedCurrentManagedState', 'desiredManagedState']
          ELSE ARRAY['projection'] END
      )
        OR NOT public.affiliate_sync_v2_is_nonnegative_integer(v_instruction->'instructionOrdinal')
        OR (v_instruction->>'instructionOrdinal')::integer <> v_array_ordinal::integer
        OR jsonb_typeof(v_instruction->'action') IS DISTINCT FROM 'string'
        OR v_instruction->>'provider' IS DISTINCT FROM 'impact'
        OR jsonb_typeof(v_instruction->'providerEntityNamespace')
          IS DISTINCT FROM 'string'
        OR v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'campaign'
        OR jsonb_typeof(v_instruction->'providerEntityId') IS DISTINCT FROM 'string'
        OR v_instruction->'qualified' IS DISTINCT FROM 'true'::jsonb
      THEN
        v_reason := 'invalid_store_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      v_action := v_instruction->>'action';
      v_provider_entity_namespace :=
        v_instruction->>'providerEntityNamespace';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      IF v_action NOT IN ('create', 'noop_existing', 'update_existing')
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
              'lifecycleHidden', 'lastQualificationResult', 'lastQualifiedAt',
              'seoTitle', 'seoDescription', 'seoCanonicalUrl'
            ]
          )
          OR jsonb_typeof(v_projection->'name') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'name', '')) = ''
          OR v_projection->>'name' <> btrim(v_projection->>'name')
          OR jsonb_typeof(v_projection->'slugCandidate') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'slugCandidate', '')) = ''
          OR length(v_projection->>'slugCandidate') > 80
          OR v_projection->>'slugCandidate' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          OR (
            v_projection->'description' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'description') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'description') = ''
              OR v_projection->>'description' <> btrim(v_projection->>'description')
            )
          )
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
            ARRAY[
              'advertiserId', 'campaignId', 'campaignName',
              'destinationUrl', 'trackingUrl'
            ]
          )
          OR jsonb_typeof(v_projection#>'{metadata,campaignId}') IS DISTINCT FROM 'string'
          OR v_projection#>>'{metadata,campaignId}' IS DISTINCT FROM v_provider_entity_id
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(jsonb_build_array(
              v_projection#>'{metadata,advertiserId}',
              v_projection#>'{metadata,campaignName}'
            )) AS metadata_values(metadata_value)
            WHERE metadata_value <> 'null'::jsonb
              AND (
                jsonb_typeof(metadata_value) IS DISTINCT FROM 'string'
                OR btrim(metadata_value #>> '{}') = ''
                OR metadata_value #>> '{}' <> btrim(metadata_value #>> '{}')
              )
          )
          OR (
            v_projection->'affiliateUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'affiliateUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'affiliateUrl') = ''
              OR v_projection->>'affiliateUrl' <> btrim(v_projection->>'affiliateUrl')
              OR v_projection->>'affiliateUrl' !~* '^https?://'
            )
          )
          OR (
            v_projection->'destinationUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'destinationUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'destinationUrl') = ''
              OR v_projection->>'destinationUrl' <> btrim(v_projection->>'destinationUrl')
              OR v_projection->>'destinationUrl' !~* '^https?://'
            )
          )
          OR v_projection#>'{metadata,destinationUrl}' IS DISTINCT FROM
            v_projection->'destinationUrl'
          OR v_projection->'affiliateUrl' IS DISTINCT FROM
            v_projection->'destinationUrl'
          OR (
            v_projection#>'{metadata,trackingUrl}' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection#>'{metadata,trackingUrl}')
                IS DISTINCT FROM 'string'
              OR btrim(v_projection#>>'{metadata,trackingUrl}') = ''
              OR v_projection#>>'{metadata,trackingUrl}' <>
                btrim(v_projection#>>'{metadata,trackingUrl}')
              OR v_projection#>>'{metadata,trackingUrl}'
                !~* '^https?://[^[:space:]]+$'
            )
          )
          OR jsonb_typeof(v_projection->'seoTitle') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoTitle') = ''
          OR v_projection->>'seoTitle' <> btrim(v_projection->>'seoTitle')
          OR jsonb_typeof(v_projection->'seoDescription') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoDescription') = ''
          OR v_projection->>'seoDescription' <> btrim(v_projection->>'seoDescription')
          OR jsonb_typeof(v_projection->'seoCanonicalUrl') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoCanonicalUrl') = ''
          OR v_projection->>'seoCanonicalUrl' <>
            btrim(v_projection->>'seoCanonicalUrl')
          OR v_projection->>'seoCanonicalUrl' !~* '^https?://'
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
      ELSIF v_action = 'update_existing' THEN
        v_store_update_seen := v_store_update_seen + 1;
        v_reason := 'invalid_store_instruction';
        IF jsonb_typeof(v_instruction->'expectedExistingStoreId') IS DISTINCT FROM 'string'
          OR (v_instruction->>'expectedExistingStoreId') !~ v_uuid_pattern
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        -- Validate both closed snapshots before any catalog access or mutation.
        FOREACH v_state_name IN ARRAY ARRAY['expectedCurrentManagedState', 'desiredManagedState']
        LOOP
          v_state := v_instruction->v_state_name;
          IF NOT public.affiliate_sync_v2_has_exact_keys(v_state, ARRAY['affiliateUrl', 'metadata'])
            OR NOT public.affiliate_sync_v2_has_exact_keys(v_state->'metadata', ARRAY['advertiserId', 'campaignId', 'campaignName', 'destinationUrl', 'trackingUrl'])
          THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          FOR v_value IN
            SELECT value FROM jsonb_each(v_state - 'metadata' - 'structuredTerms' - 'discountValue')
            UNION ALL SELECT value FROM jsonb_each(v_state->'metadata')
          LOOP
            IF v_value <> 'null'::jsonb AND (
              jsonb_typeof(v_value) IS DISTINCT FROM 'string'
              OR btrim(v_value #>> '{}') = ''
              OR (v_value #>> '{}') <> btrim(v_value #>> '{}')
            ) THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
          END LOOP;
          FOR v_value IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
            v_state->'affiliateUrl', v_state#>'{metadata,destinationUrl}', v_state#>'{metadata,trackingUrl}'
          ))
          LOOP
            IF v_value <> 'null'::jsonb AND (
              (v_value #>> '{}') !~* '^https?://[^[:space:]]+$'
              OR split_part(regexp_replace(v_value #>> '{}', '^https?://', '', 'i'), '/', 1) ~ '@'
            ) THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
          END LOOP;
          IF v_state#>'{metadata,campaignId}' <> 'null'::jsonb
            AND v_state#>>'{metadata,campaignId}' IS DISTINCT FROM v_provider_entity_id
          THEN
            v_reason := 'store_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;

          IF v_state_name = 'desiredManagedState' AND (
            jsonb_typeof(v_state#>'{metadata,campaignId}') IS DISTINCT FROM 'string'
            OR jsonb_typeof(v_state#>'{metadata,campaignName}') IS DISTINCT FROM 'string'
          ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
        END LOOP;
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
      OR v_store_update_seen <> v_store_update_expected
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
          'instructionOrdinal', 'action', 'provider',
          'providerEntityNamespace', 'providerEntityId',
          'kind', 'existingOfferId', 'parentProviderEntityNamespace',
          'parentProviderEntityId', 'expectedParentStoreId'
        ] || CASE WHEN v_instruction->>'action' = 'update_existing'
          THEN ARRAY['expectedCurrentManagedState', 'desiredManagedState']
          ELSE ARRAY['projection'] END
      )
        OR NOT public.affiliate_sync_v2_is_nonnegative_integer(v_instruction->'instructionOrdinal')
        OR (v_instruction->>'instructionOrdinal')::integer <>
          jsonb_array_length(_store_instructions) + v_array_ordinal::integer
        OR jsonb_typeof(v_instruction->'action') IS DISTINCT FROM 'string'
        OR v_instruction->>'provider' IS DISTINCT FROM 'impact'
        OR jsonb_typeof(v_instruction->'providerEntityNamespace')
          IS DISTINCT FROM 'string'
        OR v_instruction->>'providerEntityNamespace' IS DISTINCT FROM 'ad'
        OR jsonb_typeof(v_instruction->'providerEntityId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_instruction->'parentProviderEntityNamespace')
          IS DISTINCT FROM 'string'
        OR v_instruction->>'parentProviderEntityNamespace'
          IS DISTINCT FROM 'campaign'
        OR jsonb_typeof(v_instruction->'parentProviderEntityId') IS DISTINCT FROM 'string'
      THEN
        v_reason := 'invalid_offer_instruction';
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;

      v_action := v_instruction->>'action';
      v_provider_entity_namespace :=
        v_instruction->>'providerEntityNamespace';
      v_provider_entity_id := v_instruction->>'providerEntityId';
      v_parent_provider_entity_namespace :=
        v_instruction->>'parentProviderEntityNamespace';
      v_parent_provider_entity_id := v_instruction->>'parentProviderEntityId';
      v_kind := v_instruction->>'kind';
      IF v_action NOT IN ('create', 'noop_existing', 'update_existing')
        OR v_kind IS DISTINCT FROM 'coupon'
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

      IF v_action <> 'create' AND v_instruction->'expectedParentStoreId' = 'null'::jsonb THEN
        v_reason := 'parent_store_mismatch';
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
              'status', 'terms', 'discountType', 'discountValue',
              'structuredTerms', 'metadata', 'seoTitle', 'seoDescription',
              'seoCanonicalUrl'
            ]
          )
          OR jsonb_typeof(v_projection->'title') IS DISTINCT FROM 'string'
          OR btrim(coalesce(v_projection->>'title', '')) = ''
          OR v_projection->>'title' <> btrim(v_projection->>'title')
          OR v_projection->>'couponType' IS DISTINCT FROM 'code'
          OR jsonb_typeof(v_projection->'status') IS DISTINCT FROM 'string'
          OR v_projection->>'status' NOT IN ('active', 'expired', 'draft')
          OR NOT public.affiliate_sync_v2_has_exact_keys(
            v_projection->'metadata',
            ARRAY[
              'adId', 'campaignId', 'advertiserId', 'dealId',
              'campaignName', 'adName', 'dealStartDate', 'dealEndDate',
              'startDate', 'endDate'
            ]
          )
          OR jsonb_typeof(v_projection#>'{metadata,adId}') IS DISTINCT FROM 'string'
          OR v_projection#>>'{metadata,adId}' IS DISTINCT FROM v_provider_entity_id
          OR jsonb_typeof(v_projection#>'{metadata,campaignId}') IS DISTINCT FROM 'string'
          OR v_projection#>>'{metadata,campaignId}' IS DISTINCT FROM
            v_parent_provider_entity_id
          OR jsonb_typeof(v_projection->'couponCode') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'couponCode') = ''
          OR v_projection->>'couponCode' <> btrim(v_projection->>'couponCode')
          OR lower(v_projection->>'couponCode') IN (
            'n/a', 'none', 'no code', 'null', 'undefined'
          )
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
              OR v_projection->>'affiliateUrl' !~* '^https?://'
            )
          )
          OR (
            v_projection->'landingPageUrl' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'landingPageUrl') IS DISTINCT FROM 'string'
              OR btrim(v_projection->>'landingPageUrl') = ''
              OR v_projection->>'landingPageUrl' <>
                btrim(v_projection->>'landingPageUrl')
              OR v_projection->>'landingPageUrl' !~* '^https?://'
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
              OR v_projection->>'discountType' NOT IN ('percentage', 'fixed')
            )
          )
          OR (
            v_projection->'discountValue' <> 'null'::jsonb
            AND (
              jsonb_typeof(v_projection->'discountValue') IS DISTINCT FROM 'number'
              OR (v_projection->>'discountValue')::numeric < 0
            )
          )
          OR (
            (v_projection->'discountType' = 'null'::jsonb) <>
              (v_projection->'discountValue' = 'null'::jsonb)
          )
          OR (
            v_projection->'structuredTerms' <> 'null'::jsonb
            AND (
              NOT public.affiliate_sync_v2_has_exact_keys(
                v_projection->'structuredTerms',
                ARRAY[
                  'minimumPurchase', 'maximumSavings', 'purchaseLimit',
                  'scope', 'currency', 'text'
                ]
              )
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(jsonb_build_array(
                  v_projection#>'{structuredTerms,minimumPurchase}',
                  v_projection#>'{structuredTerms,maximumSavings}',
                  v_projection#>'{structuredTerms,purchaseLimit}'
                )) AS numeric_terms(term_value)
                WHERE term_value <> 'null'::jsonb
                  AND (
                    jsonb_typeof(term_value) IS DISTINCT FROM 'number'
                    OR (term_value #>> '{}')::numeric < 0
                  )
              )
              OR (
                v_projection#>'{structuredTerms,purchaseLimit}' <> 'null'::jsonb
                AND (v_projection#>>'{structuredTerms,purchaseLimit}')::numeric <= 0
              )
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(jsonb_build_array(
                  v_projection#>'{structuredTerms,scope}',
                  v_projection#>'{structuredTerms,currency}',
                  v_projection#>'{structuredTerms,text}'
                )) AS text_terms(term_value)
                WHERE term_value <> 'null'::jsonb
                  AND (
                    jsonb_typeof(term_value) IS DISTINCT FROM 'string'
                    OR btrim(term_value #>> '{}') = ''
                    OR term_value #>> '{}' <> btrim(term_value #>> '{}')
                  )
              )
            )
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
          OR (
            v_projection->'startDate' <> 'null'::jsonb
            AND v_projection->'expiryDate' <> 'null'::jsonb
            AND (v_projection->>'startDate')::date >
              (v_projection->>'expiryDate')::date
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(jsonb_build_array(
              v_projection#>'{metadata,advertiserId}',
              v_projection#>'{metadata,dealId}',
              v_projection#>'{metadata,campaignName}',
              v_projection#>'{metadata,adName}',
              v_projection#>'{metadata,dealStartDate}',
              v_projection#>'{metadata,dealEndDate}',
              v_projection#>'{metadata,startDate}',
              v_projection#>'{metadata,endDate}'
            )) AS metadata_values(metadata_value)
            WHERE metadata_value <> 'null'::jsonb
              AND (
                jsonb_typeof(metadata_value) IS DISTINCT FROM 'string'
                OR btrim(metadata_value #>> '{}') = ''
                OR metadata_value #>> '{}' <> btrim(metadata_value #>> '{}')
              )
          )
          OR jsonb_typeof(v_projection->'seoTitle') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoTitle') = ''
          OR v_projection->>'seoTitle' <> btrim(v_projection->>'seoTitle')
          OR jsonb_typeof(v_projection->'seoDescription') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoDescription') = ''
          OR v_projection->>'seoDescription' <> btrim(v_projection->>'seoDescription')
          OR jsonb_typeof(v_projection->'seoCanonicalUrl') IS DISTINCT FROM 'string'
          OR btrim(v_projection->>'seoCanonicalUrl') = ''
          OR v_projection->>'seoCanonicalUrl' <>
            btrim(v_projection->>'seoCanonicalUrl')
          OR v_projection->>'seoCanonicalUrl' !~* '^https?://'
        THEN
          v_reason := 'invalid_offer_projection';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
      ELSIF v_action = 'update_existing' THEN
        v_offer_update_seen := v_offer_update_seen + 1;
        v_reason := 'invalid_offer_instruction';
        IF jsonb_typeof(v_instruction->'existingOfferId') IS DISTINCT FROM 'string'
          OR (v_instruction->>'existingOfferId') !~ v_uuid_pattern
          OR jsonb_typeof(v_instruction->'expectedParentStoreId') IS DISTINCT FROM 'string'
          OR (v_instruction->>'expectedParentStoreId') !~ v_uuid_pattern
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        -- Validate both closed snapshots before any catalog access or mutation.
        FOREACH v_state_name IN ARRAY ARRAY['expectedCurrentManagedState', 'desiredManagedState']
        LOOP
          v_state := v_instruction->v_state_name;
          IF NOT public.affiliate_sync_v2_has_exact_keys(v_state, ARRAY['couponCode', 'affiliateUrl', 'landingPageUrl', 'startDate', 'expiryDate', 'status', 'terms', 'discountType', 'discountValue', 'structuredTerms', 'metadata'])
            OR NOT public.affiliate_sync_v2_has_exact_keys(v_state->'metadata', ARRAY['adId', 'campaignId', 'advertiserId', 'dealId', 'campaignName', 'adName', 'dealStartDate', 'dealEndDate', 'startDate', 'endDate'])
          THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          FOR v_value IN
            SELECT value FROM jsonb_each(v_state - 'metadata' - 'structuredTerms' - 'discountValue')
            UNION ALL SELECT value FROM jsonb_each(v_state->'metadata')
          LOOP
            IF v_value <> 'null'::jsonb AND (
              jsonb_typeof(v_value) IS DISTINCT FROM 'string'
              OR btrim(v_value #>> '{}') = ''
              OR (v_value #>> '{}') <> btrim(v_value #>> '{}')
            ) THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
          END LOOP;
          FOR v_value IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
            v_state->'affiliateUrl', v_state->'landingPageUrl'
          ))
          LOOP
            IF v_value <> 'null'::jsonb AND (
              (v_value #>> '{}') !~* '^https?://[^[:space:]]+$'
              OR split_part(regexp_replace(v_value #>> '{}', '^https?://', '', 'i'), '/', 1) ~ '@'
            ) THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
          END LOOP;
          IF v_state#>'{metadata,campaignId}' <> 'null'::jsonb
            AND v_state#>>'{metadata,campaignId}' IS DISTINCT FROM v_parent_provider_entity_id
          THEN
            v_reason := 'parent_store_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF v_state#>'{metadata,adId}' <> 'null'::jsonb
            AND v_state#>>'{metadata,adId}' IS DISTINCT FROM v_provider_entity_id
          THEN
            v_reason := 'offer_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF jsonb_typeof(v_state->'couponCode') IS DISTINCT FROM 'string'
            OR lower(v_state->>'couponCode') IN ('n/a', 'none', 'no code', 'null', 'undefined')
            OR jsonb_typeof(v_state->'status') IS DISTINCT FROM 'string'
            OR v_state->>'status' NOT IN ('active', 'expired', 'draft')
            OR (v_state->'discountType' <> 'null'::jsonb
              AND v_state->>'discountType' NOT IN ('percentage', 'fixed'))
            OR (v_state->'discountValue' <> 'null'::jsonb AND (
              jsonb_typeof(v_state->'discountValue') IS DISTINCT FROM 'number'
              OR (v_state->>'discountValue')::numeric < 0))
            OR ((v_state->'discountType' = 'null'::jsonb) <>
                (v_state->'discountValue' = 'null'::jsonb))
            OR (v_state->'startDate' <> 'null'::jsonb
              AND NOT public.affiliate_sync_v2_is_iso_date(v_state->>'startDate'))
            OR (v_state->'expiryDate' <> 'null'::jsonb
              AND NOT public.affiliate_sync_v2_is_iso_date(v_state->>'expiryDate'))
            OR (v_state->'startDate' <> 'null'::jsonb AND v_state->'expiryDate' <> 'null'::jsonb
              AND (v_state->>'startDate')::date > (v_state->>'expiryDate')::date)
          THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF v_state->'structuredTerms' <> 'null'::jsonb THEN
            IF NOT public.affiliate_sync_v2_has_exact_keys(v_state->'structuredTerms',
              ARRAY['minimumPurchase', 'maximumSavings', 'purchaseLimit', 'scope', 'currency', 'text'])
            THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            FOREACH v_key IN ARRAY ARRAY['minimumPurchase', 'maximumSavings', 'purchaseLimit']
            LOOP
              v_value := v_state->'structuredTerms'->v_key;
              IF v_value <> 'null'::jsonb AND (
                jsonb_typeof(v_value) IS DISTINCT FROM 'number'
                OR (v_value #>> '{}')::numeric < 0
                OR (v_key = 'purchaseLimit' AND (v_value #>> '{}')::numeric <= 0)
              ) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
              END IF;
            END LOOP;
            FOREACH v_key IN ARRAY ARRAY['scope', 'currency', 'text']
            LOOP
              v_value := v_state->'structuredTerms'->v_key;
              IF v_value <> 'null'::jsonb AND (
                jsonb_typeof(v_value) IS DISTINCT FROM 'string'
                OR btrim(v_value #>> '{}') = ''
                OR (v_value #>> '{}') <> btrim(v_value #>> '{}')
                OR (v_key = 'currency' AND (v_value #>> '{}') !~ '^[A-Z]{3}$')
              ) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
              END IF;
            END LOOP;
          END IF;

          IF v_state_name = 'desiredManagedState' AND (
            jsonb_typeof(v_state#>'{metadata,campaignId}') IS DISTINCT FROM 'string'
            OR jsonb_typeof(v_state#>'{metadata,campaignName}') IS DISTINCT FROM 'string'
            OR jsonb_typeof(v_state#>'{metadata,adId}') IS DISTINCT FROM 'string'
            OR jsonb_typeof(v_state#>'{metadata,adName}') IS DISTINCT FROM 'string'
          ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
        END LOOP;
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
      OR v_offer_update_seen <> v_offer_update_expected
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
    IF lower(btrim(v_integration_provider)) IS NULL
      OR lower(btrim(v_integration_provider)) NOT IN ('impact', 'impact.com', 'impact radius')
    THEN
      v_reason := 'integration_provider_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    -- Integration lock serializes identical capabilities; unique durable
    -- fingerprint identity remains the existing database backstop.
    SELECT run.id INTO v_run_id
    FROM public.affiliate_import_runs AS run
    WHERE run.integration_id = _integration_id
      AND run.provider = _provider
      AND run.persistence_contract_version = _persistence_contract_version
      AND run.plan_fingerprint_algorithm = _plan_fingerprint_algorithm
      AND run.plan_fingerprint = _plan_fingerprint
      AND run.preview = false
      AND run.persistence_execution_status = 'committed'
    FOR UPDATE;

    IF v_run_id IS NOT NULL THEN
      v_status := 'replayed_existing';
      -- Skip every catalog write. Durable run/ledger validation is shared below.
    ELSE
      v_stage := 'store_revalidation';
      FOR v_instruction IN
        SELECT value FROM jsonb_array_elements(_store_instructions) WITH ORDINALITY ORDER BY ordinality
      LOOP
        v_stage := 'store_revalidation';
        v_action := v_instruction->>'action';
        v_provider_entity_id := v_instruction->>'providerEntityId';
        v_provider_entity_namespace := 'campaign';
        v_instruction_ordinal := (v_instruction->>'instructionOrdinal')::integer;
        v_projection := v_instruction->'projection';
        v_entity_id := NULL;
        v_expected_id := NULL;
        v_reason := 'legacy_identity_collision';
        IF EXISTS (
          SELECT 1 FROM public.stores
          WHERE provider = 'impact' AND provider_entity_namespace = 'legacy'
            AND provider_entity_id = v_provider_entity_id
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;

        -- Exclusive row lock prevents a concurrent writer from changing the
        -- optimistic snapshot between comparison and explicit UPDATE.
        SELECT store.* INTO v_store FROM public.stores AS store
        WHERE store.provider = 'impact'
          AND store.provider_entity_namespace = 'campaign'
          AND store.provider_entity_id = v_provider_entity_id
        FOR UPDATE;

        IF v_action = 'create' THEN
          IF v_store.id IS NOT NULL THEN
            v_reason := 'store_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_slug := v_projection->>'slugCandidate';
          IF EXISTS (SELECT 1 FROM public.stores WHERE slug = v_slug) THEN
            v_reason := 'store_slug_collision';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
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
              provider_entity_namespace,
              provider_entity_id,
              imported_at,
              import_origin,
              lifecycle_managed,
              lifecycle_hidden,
              last_qualification_result,
              last_qualified_at,
              seo_title,
              seo_description,
              seo_canonical_url
            ) VALUES (
              v_projection->>'name',
              v_slug,
              v_projection->>'description',
              NULL,
              v_projection->>'logoSourceUrl',
              v_projection->>'affiliateUrl',
              NULL,
              v_projection->>'country',
              ARRAY(
                SELECT jsonb_array_elements_text(v_projection->'shippingRegions')
              ),
              v_projection->'metadata',
              'impact',
              v_provider_entity_namespace,
              v_provider_entity_id,
              clock_timestamp(),
              'provider',
              true,
              false,
              'qualified',
              _evaluation_timestamp,
              v_projection->>'seoTitle',
              v_projection->>'seoDescription',
              v_projection->>'seoCanonicalUrl'
            )
            RETURNING id INTO v_entity_id;
          EXCEPTION WHEN unique_violation THEN
            -- Includes an identity/legacy/slug inserted after the absence read.
            -- Never resolve this race as NOOP or UPDATE.
            v_reason := 'store_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END;
          IF v_entity_id IS NULL THEN
            v_reason := 'store_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_outcome := 'created';
          v_stores_created := v_stores_created + 1;
        ELSE
          v_expected_id := (v_instruction->>'expectedExistingStoreId')::uuid;
          IF v_store.id IS NULL OR v_store.id IS DISTINCT FROM v_expected_id THEN
            v_reason := 'store_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_entity_id := v_store.id;
          IF v_action = 'update_existing' THEN
            v_stage := 'store_update';
            IF v_store.import_origin IS DISTINCT FROM 'provider'
              OR v_store.lifecycle_managed IS DISTINCT FROM true
            THEN
              v_reason := 'ownership_not_provider_managed';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            v_current_metadata := '{}'::jsonb;
            FOREACH v_key IN ARRAY ARRAY['advertiserId', 'campaignId', 'campaignName', 'destinationUrl', 'trackingUrl']
            LOOP
              v_current_metadata := v_current_metadata ||
                jsonb_build_object(v_key, coalesce(v_store.metadata->v_key, 'null'::jsonb));
            END LOOP;
            v_current_state := jsonb_build_object(
              'affiliateUrl', v_store.affiliate_url, 'metadata', v_current_metadata
            );
            -- JSONB structural equality is deterministic and null-safe. Missing
            -- historical metadata leaves project to null as in the catalog mapper.
            IF (v_store.metadata IS NOT NULL AND jsonb_typeof(v_store.metadata) NOT IN ('object', 'null'))
              OR v_current_state IS DISTINCT FROM v_instruction->'expectedCurrentManagedState'
            THEN
              v_reason := 'stale_store_state';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            v_desired := v_instruction->'desiredManagedState';
            UPDATE public.stores AS store
            SET affiliate_url = v_desired->>'affiliateUrl',
                metadata = coalesce(nullif(store.metadata, 'null'::jsonb), '{}'::jsonb)
                  || (v_desired->'metadata')
            WHERE store.id = v_expected_id
              AND store.provider = 'impact'
              AND store.provider_entity_namespace = 'campaign'
              AND store.provider_entity_id = v_provider_entity_id
              AND store.import_origin = 'provider'
              AND store.lifecycle_managed = true
            RETURNING store.id INTO v_entity_id;
            IF v_entity_id IS DISTINCT FROM v_expected_id THEN
              v_reason := 'store_identity_mismatch';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            v_outcome := 'updated_existing';
            v_stores_updated := v_stores_updated + 1;
          ELSE
            v_outcome := 'noop_existing';
            v_stores_noop := v_stores_noop + 1;
          END IF;
        END IF;
        v_store_map := v_store_map || jsonb_build_object(v_provider_entity_id, v_entity_id::text);
        v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
          'instructionOrdinal', v_instruction_ordinal, 'entityKind', 'store',
          'plannedAction', v_action, 'outcome', v_outcome, 'provider', 'impact',
          'providerEntityNamespace', 'campaign', 'providerEntityId', v_provider_entity_id,
          'entityId', v_entity_id, 'expectedEntityId', v_expected_id,
          'parentProviderEntityNamespace', NULL, 'parentProviderEntityId', NULL,
          'parentEntityId', NULL, 'offerKind', NULL
        ));
      END LOOP;

      v_stage := 'offer_revalidation';
      FOR v_instruction IN
        SELECT value FROM jsonb_array_elements(_offer_instructions) WITH ORDINALITY ORDER BY ordinality
      LOOP
        v_stage := 'offer_revalidation';
        v_action := v_instruction->>'action';
        v_provider_entity_id := v_instruction->>'providerEntityId';
        v_provider_entity_namespace := 'ad';
        v_parent_provider_entity_id := v_instruction->>'parentProviderEntityId';
        v_instruction_ordinal := (v_instruction->>'instructionOrdinal')::integer;
        v_projection := v_instruction->'projection';
        v_expected_id := NULL;
        v_entity_id := NULL;
        v_parent_store_id := (v_store_map->>v_parent_provider_entity_id)::uuid;
        v_expected_parent_id := (v_instruction->>'expectedParentStoreId')::uuid;
        IF v_parent_store_id IS NULL OR
          (v_expected_parent_id IS NOT NULL AND v_parent_store_id IS DISTINCT FROM v_expected_parent_id)
        THEN
          v_reason := 'parent_store_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        SELECT store.* INTO v_parent FROM public.stores AS store
        WHERE store.id = v_parent_store_id
          AND store.provider = 'impact'
          AND store.provider_entity_namespace = 'campaign'
          AND store.provider_entity_id = v_parent_provider_entity_id
        FOR UPDATE;
        IF NOT FOUND THEN
          v_reason := 'parent_store_mismatch';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        -- Coupons have no separate ownership columns in the settled snapshot;
        -- refresh authority is inherited only from this exact Campaign parent.
        IF v_action = 'update_existing' AND (
          v_parent.import_origin IS DISTINCT FROM 'provider'
          OR v_parent.lifecycle_managed IS DISTINCT FROM true
        ) THEN
          v_reason := 'ownership_not_provider_managed';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.coupons
          WHERE provider = 'impact' AND provider_entity_namespace = 'legacy'
            AND provider_entity_id = v_provider_entity_id
        ) THEN
          v_reason := 'legacy_identity_collision';
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        SELECT offer.* INTO v_offer FROM public.coupons AS offer
        WHERE offer.provider = 'impact'
          AND offer.provider_entity_namespace = 'ad'
          AND offer.provider_entity_id = v_provider_entity_id
        FOR UPDATE;
        IF v_action = 'create' THEN
          IF v_offer.id IS NOT NULL THEN
            v_reason := 'offer_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_stage := 'offer_insert';
          BEGIN
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
              provider_entity_namespace,
              provider_entity_id,
              imported_at,
              seo_title,
              seo_description,
              seo_canonical_url
            ) VALUES (
              v_parent_store_id,
              v_projection->>'title',
              v_projection->>'description',
              v_projection->>'couponCode',
              (v_projection->>'couponType')::public.coupon_type,
              v_projection->>'affiliateUrl',
              nullif(v_projection->>'expiryDate', '')::date,
              nullif(v_projection->>'startDate', '')::date,
              (v_projection->>'status')::public.coupon_status,
              v_projection->>'terms',
              v_projection->>'discountType',
              nullif(v_projection->>'discountValue', '')::numeric,
              v_projection->>'landingPageUrl',
              nullif(v_projection->'structuredTerms', 'null'::jsonb),
              v_projection->'metadata',
              'impact',
              v_provider_entity_namespace,
              v_provider_entity_id,
              clock_timestamp(),
              v_projection->>'seoTitle',
              v_projection->>'seoDescription',
              v_projection->>'seoCanonicalUrl'
            )
            RETURNING id INTO v_entity_id;
          EXCEPTION WHEN unique_violation THEN
            v_reason := 'offer_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END;
          IF v_entity_id IS NULL THEN
            v_reason := 'offer_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_outcome := 'created';
          v_offers_created := v_offers_created + 1;
        ELSE
          v_expected_id := (v_instruction->>'existingOfferId')::uuid;
          IF v_offer.id IS NULL OR v_offer.id IS DISTINCT FROM v_expected_id THEN
            v_reason := 'offer_identity_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF v_offer.coupon_type::text IS DISTINCT FROM 'code' THEN
            v_reason := 'offer_kind_conflict';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          IF v_offer.store_id IS DISTINCT FROM v_expected_parent_id
            OR v_offer.store_id IS DISTINCT FROM v_parent_store_id
          THEN
            v_reason := 'parent_store_mismatch';
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
          END IF;
          v_entity_id := v_offer.id;
          IF v_action = 'update_existing' THEN
            v_stage := 'offer_update';
            v_current_metadata := '{}'::jsonb;
            FOREACH v_key IN ARRAY ARRAY['adId', 'campaignId', 'advertiserId', 'dealId',
              'campaignName', 'adName', 'dealStartDate', 'dealEndDate', 'startDate', 'endDate']
            LOOP
              v_current_metadata := v_current_metadata ||
                jsonb_build_object(v_key, coalesce(v_offer.metadata->v_key, 'null'::jsonb));
            END LOOP;
            v_current_terms := 'null'::jsonb;
            IF v_offer.structured_terms IS NOT NULL AND v_offer.structured_terms <> 'null'::jsonb THEN
              v_current_terms := '{}'::jsonb;
              FOREACH v_key IN ARRAY ARRAY['minimumPurchase', 'maximumSavings', 'purchaseLimit', 'scope', 'currency', 'text']
              LOOP
                v_current_terms := v_current_terms ||
                  jsonb_build_object(v_key, coalesce(v_offer.structured_terms->v_key, 'null'::jsonb));
              END LOOP;
            END IF;
            v_current_state := jsonb_build_object(
              'couponCode', v_offer.coupon_code, 'affiliateUrl', v_offer.affiliate_url,
              'landingPageUrl', v_offer.landing_page_url,
              'startDate', to_char(v_offer.start_date, 'YYYY-MM-DD'),
              'expiryDate', to_char(v_offer.expiry_date, 'YYYY-MM-DD'),
              'status', v_offer.status::text, 'terms', v_offer.terms,
              'discountType', v_offer.discount_type, 'discountValue', v_offer.discount_value,
              'structuredTerms', v_current_terms, 'metadata', v_current_metadata
            );
            IF (v_offer.metadata IS NOT NULL AND jsonb_typeof(v_offer.metadata) NOT IN ('object', 'null'))
              OR (v_offer.structured_terms IS NOT NULL AND jsonb_typeof(v_offer.structured_terms) NOT IN ('object', 'null'))
              OR v_current_state IS DISTINCT FROM v_instruction->'expectedCurrentManagedState'
            THEN
              v_reason := 'stale_offer_state';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            v_desired := v_instruction->'desiredManagedState';
            UPDATE public.coupons AS offer
            SET coupon_code = v_desired->>'couponCode',
                affiliate_url = v_desired->>'affiliateUrl',
                landing_page_url = v_desired->>'landingPageUrl',
                start_date = (v_desired->>'startDate')::date,
                expiry_date = (v_desired->>'expiryDate')::date,
                status = (v_desired->>'status')::public.coupon_status,
                terms = v_desired->>'terms',
                discount_type = v_desired->>'discountType',
                discount_value = (v_desired->>'discountValue')::numeric,
                structured_terms = nullif(v_desired->'structuredTerms', 'null'::jsonb),
                metadata = coalesce(nullif(offer.metadata, 'null'::jsonb), '{}'::jsonb)
                  || (v_desired->'metadata')
            WHERE offer.id = v_expected_id
              AND offer.provider = 'impact'
              AND offer.provider_entity_namespace = 'ad'
              AND offer.provider_entity_id = v_provider_entity_id
              AND offer.coupon_type = 'code'
              AND offer.store_id = v_expected_parent_id
              AND offer.store_id = v_parent_store_id
            RETURNING offer.id INTO v_entity_id;
            IF v_entity_id IS DISTINCT FROM v_expected_id THEN
              v_reason := 'offer_identity_mismatch';
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
            END IF;
            v_outcome := 'updated_existing';
            v_offers_updated := v_offers_updated + 1;
          ELSE
            v_outcome := 'noop_existing';
            v_offers_noop := v_offers_noop + 1;
          END IF;
        END IF;
        v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
          'instructionOrdinal', v_instruction_ordinal, 'entityKind', 'offer',
          'plannedAction', v_action, 'outcome', v_outcome, 'provider', 'impact',
          'providerEntityNamespace', 'ad', 'providerEntityId', v_provider_entity_id,
          'entityId', v_entity_id, 'expectedEntityId', v_expected_id,
          'parentProviderEntityNamespace', 'campaign', 'parentProviderEntityId', v_parent_provider_entity_id,
          'parentEntityId', v_parent_store_id, 'offerKind', 'coupon'
        ));
      END LOOP;

      v_stage := 'reconciliation';
      v_reason := 'count_mismatch';
      v_ledger_count := jsonb_array_length(v_ledger);
      v_persistence_counts := jsonb_build_object(
        'expected', _expected_counts,
        'actual', jsonb_build_object(
          'storesCreated', v_stores_created, 'storesUpdatedExisting', v_stores_updated,
          'storesNoopExisting', v_stores_noop, 'offersCreated', v_offers_created,
          'offersUpdatedExisting', v_offers_updated, 'offersNoopExisting', v_offers_noop,
          'ledgerRows', v_ledger_count
        )
      );
      IF NOT public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(v_persistence_counts) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      v_records_updated := public.affiliate_sync_ads_v2_refresh_records_updated(v_persistence_counts);
      IF v_records_updated IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      v_records_processed := v_offer_create_expected + v_offer_update_expected
        + v_offer_existing_expected + v_offer_held_expected + v_offer_unresolved_expected;
      v_records_created := v_stores_created + v_offers_created;
      v_records_skipped := v_stores_noop + v_offers_noop
        + v_store_unmatched_expected + v_offer_held_expected + v_offer_unresolved_expected;
      -- Historical operational counter: successfully resolved executable offers,
      -- not a claim that their status/publication was changed to active.
      v_records_published := v_offers_created + v_offers_updated + v_offers_noop;
      v_records_held := v_offer_held_expected;
      v_finished_at := clock_timestamp();
      v_run_id := gen_random_uuid();
      v_stage := 'audit_persistence';
      INSERT INTO public.affiliate_import_runs (
        id, integration_id, provider, preview, started_at, finished_at, duration_ms,
        success, records_processed, records_created, records_updated, records_skipped,
        validation_errors, warnings, error_message, statistics, triggered_by,
        records_published, records_held, records_fetched, new_provider_identities,
        existing_provider_identities, stop_reason, persistence_contract_version,
        plan_fingerprint_algorithm, plan_fingerprint, plan_evaluated_at,
        persistence_execution_status, persistence_counts
      ) VALUES (
        v_run_id, _integration_id, 'impact', false, v_started_at, v_finished_at,
        greatest(0, floor(extract(epoch FROM (v_finished_at - v_started_at)) * 1000))::integer,
        true, v_records_processed, v_records_created, v_records_updated, v_records_skipped,
        0, 0, NULL, '{}'::jsonb, _triggered_by, v_records_published, v_records_held,
        v_records_processed, v_records_created,
        v_stores_updated + v_offers_updated + v_stores_noop + v_offers_noop,
        'completed', 'v2-a11-ads-2', 'sha256-canonical-plan-v1', _plan_fingerprint,
        _evaluation_timestamp, 'committed', v_persistence_counts
      );
      FOR v_evidence IN SELECT value FROM jsonb_array_elements(v_ledger)
      LOOP
        INSERT INTO public.affiliate_import_run_mutations_v2 (
          run_id, instruction_ordinal, entity_kind, planned_action, outcome, provider,
          provider_entity_namespace, provider_entity_id, entity_id, expected_entity_id,
          parent_provider_entity_namespace, parent_provider_entity_id, parent_entity_id, offer_kind
        ) VALUES (
          v_run_id, (v_evidence->>'instructionOrdinal')::integer, v_evidence->>'entityKind',
          v_evidence->>'plannedAction', v_evidence->>'outcome', v_evidence->>'provider',
          v_evidence->>'providerEntityNamespace', v_evidence->>'providerEntityId',
          (v_evidence->>'entityId')::uuid, (v_evidence->>'expectedEntityId')::uuid,
          v_evidence->>'parentProviderEntityNamespace', v_evidence->>'parentProviderEntityId',
          (v_evidence->>'parentEntityId')::uuid, v_evidence->>'offerKind'
        );
      END LOOP;
    END IF;

    -- The same durable evidence gate applies to new commits and replays.
    -- Replays never consult mutable current catalog state or remutate it.
    v_stage := 'evidence_validation';
    v_reason := 'replay_metadata_mismatch';
    SELECT run.* INTO v_run FROM public.affiliate_import_runs AS run
    WHERE run.id = v_run_id FOR UPDATE;
    IF NOT FOUND
      OR v_run.integration_id IS DISTINCT FROM _integration_id
      OR v_run.provider IS DISTINCT FROM _provider
      OR v_run.persistence_contract_version IS DISTINCT FROM _persistence_contract_version
      OR v_run.plan_fingerprint_algorithm IS DISTINCT FROM _plan_fingerprint_algorithm
      OR v_run.plan_fingerprint IS DISTINCT FROM _plan_fingerprint
      OR v_run.plan_evaluated_at IS DISTINCT FROM _evaluation_timestamp
      OR v_run.preview IS DISTINCT FROM false
      OR v_run.success IS DISTINCT FROM true
      OR v_run.persistence_execution_status IS DISTINCT FROM 'committed'
      OR v_run.finished_at IS NULL OR v_run.triggered_by IS NULL
      OR v_run.error_message IS NOT NULL
      OR v_run.persistence_counts->'expected' IS DISTINCT FROM _expected_counts
      OR NOT public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(v_run.persistence_counts)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'instructionOrdinal', mutation.instruction_ordinal, 'entityKind', mutation.entity_kind,
      'plannedAction', mutation.planned_action, 'outcome', mutation.outcome,
      'provider', mutation.provider, 'providerEntityNamespace', mutation.provider_entity_namespace,
      'providerEntityId', mutation.provider_entity_id, 'entityId', mutation.entity_id,
      'expectedEntityId', mutation.expected_entity_id,
      'parentProviderEntityNamespace', mutation.parent_provider_entity_namespace,
      'parentProviderEntityId', mutation.parent_provider_entity_id,
      'parentEntityId', mutation.parent_entity_id, 'offerKind', mutation.offer_kind
    ) ORDER BY mutation.instruction_ordinal), '[]'::jsonb)
    INTO v_persisted_ledger
    FROM (
      SELECT * FROM public.affiliate_import_run_mutations_v2
      WHERE run_id = v_run_id ORDER BY instruction_ordinal FOR SHARE
    ) AS mutation;
    v_reason := 'replay_evidence_mismatch';
    IF jsonb_array_length(v_persisted_ledger) <>
      jsonb_array_length(_store_instructions) + jsonb_array_length(_offer_instructions)
      OR (v_status = 'committed' AND v_persisted_ledger IS DISTINCT FROM v_ledger)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;

    v_stores_created := 0; v_stores_updated := 0; v_stores_noop := 0;
    v_offers_created := 0; v_offers_updated := 0; v_offers_noop := 0;
    v_store_map := '{}'::jsonb;
    FOR v_evidence, v_array_ordinal IN
      SELECT value, ordinality - 1 FROM jsonb_array_elements(v_persisted_ledger) WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      IF v_array_ordinal < jsonb_array_length(_store_instructions) THEN
        v_kind := 'store';
        v_instruction := _store_instructions->v_array_ordinal::integer;
        v_expected_id := (v_instruction->>'expectedExistingStoreId')::uuid;
      ELSE
        v_kind := 'offer';
        v_instruction := _offer_instructions->(v_array_ordinal::integer - jsonb_array_length(_store_instructions));
        v_expected_id := (v_instruction->>'existingOfferId')::uuid;
      END IF;
      v_action := v_instruction->>'action';
      v_outcome := CASE v_action WHEN 'create' THEN 'created'
        WHEN 'update_existing' THEN 'updated_existing' ELSE 'noop_existing' END;
      v_entity_id := (v_evidence->>'entityId')::uuid;
      IF (v_evidence->>'instructionOrdinal')::integer IS DISTINCT FROM v_array_ordinal::integer
        OR v_evidence->'instructionOrdinal' IS DISTINCT FROM v_instruction->'instructionOrdinal'
        OR v_evidence->>'entityKind' IS DISTINCT FROM v_kind
        OR v_evidence->>'plannedAction' IS DISTINCT FROM v_action
        OR v_evidence->>'outcome' IS DISTINCT FROM v_outcome
        OR v_evidence->>'provider' IS DISTINCT FROM 'impact'
        OR v_evidence->'providerEntityNamespace' IS DISTINCT FROM v_instruction->'providerEntityNamespace'
        OR v_evidence->'providerEntityId' IS DISTINCT FROM v_instruction->'providerEntityId'
        OR v_entity_id IS NULL
        OR v_entity_id::text !~ v_uuid_pattern
        OR (v_evidence->>'expectedEntityId')::uuid IS DISTINCT FROM v_expected_id
        OR (v_expected_id IS NOT NULL AND v_entity_id IS DISTINCT FROM v_expected_id)
        OR v_seen_entities ? v_entity_id::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
      END IF;
      v_seen_entities := v_seen_entities || jsonb_build_object(v_entity_id::text, true);
      IF v_kind = 'store' THEN
        IF v_evidence->>'providerEntityNamespace' IS DISTINCT FROM 'campaign'
          OR v_evidence->'parentProviderEntityNamespace' IS DISTINCT FROM 'null'::jsonb
          OR v_evidence->'parentProviderEntityId' IS DISTINCT FROM 'null'::jsonb
          OR v_evidence->'parentEntityId' IS DISTINCT FROM 'null'::jsonb
          OR v_evidence->'offerKind' IS DISTINCT FROM 'null'::jsonb
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        v_store_map := v_store_map ||
          jsonb_build_object(v_instruction->>'providerEntityId', v_entity_id::text);
        IF v_outcome = 'created' THEN v_stores_created := v_stores_created + 1;
        ELSIF v_outcome = 'updated_existing' THEN v_stores_updated := v_stores_updated + 1;
        ELSE v_stores_noop := v_stores_noop + 1;
        END IF;
      ELSE
        v_parent_store_id := (v_store_map->>(v_instruction->>'parentProviderEntityId'))::uuid;
        v_expected_parent_id := (v_instruction->>'expectedParentStoreId')::uuid;
        IF v_parent_store_id IS NULL
          OR v_evidence->>'providerEntityNamespace' IS DISTINCT FROM 'ad'
          OR v_evidence->>'offerKind' IS DISTINCT FROM 'coupon'
          OR v_evidence->>'parentProviderEntityNamespace' IS DISTINCT FROM 'campaign'
          OR v_evidence->'parentProviderEntityId' IS DISTINCT FROM v_instruction->'parentProviderEntityId'
          OR (v_evidence->>'parentEntityId')::uuid IS DISTINCT FROM v_parent_store_id
          OR (v_expected_parent_id IS NOT NULL AND v_parent_store_id IS DISTINCT FROM v_expected_parent_id)
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
        END IF;
        IF v_outcome = 'created' THEN v_offers_created := v_offers_created + 1;
        ELSIF v_outcome = 'updated_existing' THEN v_offers_updated := v_offers_updated + 1;
        ELSE v_offers_noop := v_offers_noop + 1;
        END IF;
      END IF;
    END LOOP;
    v_ledger_count := jsonb_array_length(v_persisted_ledger);
    v_persistence_counts := jsonb_build_object(
        'expected', _expected_counts,
        'actual', jsonb_build_object(
          'storesCreated', v_stores_created, 'storesUpdatedExisting', v_stores_updated,
          'storesNoopExisting', v_stores_noop, 'offersCreated', v_offers_created,
          'offersUpdatedExisting', v_offers_updated, 'offersNoopExisting', v_offers_noop,
          'ledgerRows', v_ledger_count
        )
      );
    IF NOT public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(v_persistence_counts)
      OR v_persistence_counts IS DISTINCT FROM v_run.persistence_counts
    THEN
      v_reason := 'count_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;
    v_records_updated := public.affiliate_sync_ads_v2_refresh_records_updated(v_persistence_counts);
    IF v_records_updated IS NULL
      OR v_run.records_updated IS DISTINCT FROM v_records_updated
      OR v_run.records_processed IS DISTINCT FROM
        (v_offer_create_expected + v_offer_update_expected + v_offer_existing_expected + v_offer_held_expected + v_offer_unresolved_expected)
      OR v_run.records_created IS DISTINCT FROM (v_stores_created + v_offers_created)
      OR v_run.records_skipped IS DISTINCT FROM
        (v_stores_noop + v_offers_noop + v_store_unmatched_expected + v_offer_held_expected + v_offer_unresolved_expected)
      OR v_run.records_published IS DISTINCT FROM (v_offers_created + v_offers_updated + v_offers_noop)
      OR v_run.records_held IS DISTINCT FROM v_offer_held_expected
      OR v_run.records_fetched IS DISTINCT FROM v_run.records_processed
      OR v_run.new_provider_identities IS DISTINCT FROM (v_stores_created + v_offers_created)
      OR v_run.existing_provider_identities IS DISTINCT FROM
        (v_stores_updated + v_offers_updated + v_stores_noop + v_offers_noop)
      OR v_run.validation_errors IS DISTINCT FROM 0 OR v_run.warnings IS DISTINCT FROM 0
      OR v_run.stop_reason IS DISTINCT FROM 'completed'
    THEN
      v_reason := 'run_coherence_mismatch';
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'v2_persistence_blocked';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entityId', evidence->>'entityId', 'providerEntityId', evidence->>'providerEntityId'
    ) ORDER BY (evidence->>'instructionOrdinal')::integer), '[]'::jsonb)
    INTO v_created_stores FROM jsonb_array_elements(v_persisted_ledger) AS entries(evidence)
    WHERE evidence->>'entityKind' = 'store' AND evidence->>'outcome' = 'created';
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entityId', evidence->>'entityId', 'providerEntityId', evidence->>'providerEntityId'
    ) ORDER BY (evidence->>'instructionOrdinal')::integer), '[]'::jsonb)
    INTO v_created_offers FROM jsonb_array_elements(v_persisted_ledger) AS entries(evidence)
    WHERE evidence->>'entityKind' = 'offer' AND evidence->>'outcome' = 'created';
    RETURN jsonb_build_object(
      'status', v_status, 'runId', v_run_id,
      'persistenceContractVersion', _persistence_contract_version,
      'planFingerprintAlgorithm', _plan_fingerprint_algorithm, 'planFingerprint', _plan_fingerprint,
      'evaluationTimestamp', v_run.plan_evaluated_at, 'counts', v_persistence_counts,
      'createdStores', v_created_stores, 'createdOffers', v_created_offers,
      'noops', jsonb_build_object('stores', v_stores_noop, 'offers', v_offers_noop),
      'ledger', v_persisted_ledger
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'v2_persistence_blocked' THEN
      RETURN jsonb_build_object('status', 'blocked', 'stage', v_stage, 'reason', v_reason);
    END IF;
    -- Cast failures from malformed JSON numbers, dates or UUIDs are request
    -- blockers, not arbitrary exception text. No catalog work has started here.
    IF v_stage = 'request_validation' AND SQLSTATE LIKE '22%' THEN
      RETURN jsonb_build_object('status', 'blocked', 'stage', v_stage, 'reason', 'invalid_request');
    END IF;
    RETURN jsonb_build_object('status', 'failed', 'stage', v_stage, 'reason', 'internal_failure');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.affiliate_sync_v2_apply_ads_refresh_plan_internal(
  uuid, text, text, text, text, timestamptz, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
